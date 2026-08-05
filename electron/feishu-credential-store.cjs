const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const FORMAT = "olt-manager/feishu-credentials/v1";

function createFeishuCredentialStore({ dataDirectory, safeStorage }) {
  const filePath = path.join(dataDirectory, "feishu-credentials.json");

  async function writeAtomic(value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  async function readEnvelope() {
    try {
      const envelope = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (envelope.format !== FORMAT || !envelope.items || typeof envelope.items !== "object") {
        throw new Error("invalid Feishu credential envelope");
      }
      return envelope;
    } catch (error) {
      if (error.code === "ENOENT") return { format: FORMAT, items: {} };
      throw new Error("Feishu credential store unavailable", { cause: error });
    }
  }

  function ensureEncryption() {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error("Feishu credential OS encryption unavailable");
    }
  }

  return Object.freeze({
    async writeSecret(secret) {
      ensureEncryption();
      const value = String(secret ?? "").trim();
      if (!value) throw new TypeError("Feishu app secret is required.");
      const reference = `feishu-app-secret-${randomBytes(12).toString("hex")}`;
      const envelope = await readEnvelope();
      envelope.items[reference] = safeStorage.encryptString(value).toString("base64");
      await writeAtomic(JSON.stringify(envelope));
      return reference;
    },

    async readSecret(reference) {
      ensureEncryption();
      const key = String(reference ?? "").trim();
      if (!key) return "";
      const envelope = await readEnvelope();
      const ciphertext = envelope.items[key];
      if (typeof ciphertext !== "string" || !ciphertext) throw new Error("Feishu credential unavailable");
      return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    }
  });
}

module.exports = { createFeishuCredentialStore, FORMAT };
