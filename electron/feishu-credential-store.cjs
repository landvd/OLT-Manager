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
        return { format: FORMAT, items: {} };
      }
      return envelope;
    } catch {
      return { format: FORMAT, items: {} };
    }
  }

  function ensureEncryption() {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error("Feishu credential OS encryption unavailable");
    }
  }

  return Object.freeze({
    async writeSecret(secret, prefix = "feishu-app-secret") {
      ensureEncryption();
      const value = String(secret ?? "").trim();
      if (!value) throw new TypeError("Feishu app secret is required.");
      const safePrefix = /^[a-z0-9-]+$/i.test(String(prefix)) ? String(prefix) : "feishu-secret";
      const reference = `${safePrefix}-${randomBytes(12).toString("hex")}`;
      const envelope = await readEnvelope();
      envelope.items[reference] = safeStorage.encryptString(value).toString("base64");
      await writeAtomic(JSON.stringify(envelope));
      return reference;
    },

    async readSecret(reference) {
      const key = String(reference ?? "").trim();
      if (!key) return "";
      try {
        ensureEncryption();
        const envelope = await readEnvelope();
        const ciphertext = envelope.items[key];
        if (typeof ciphertext !== "string" || !ciphertext) return "";
        return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
      } catch {
        return "";
      }
    }
  });
}

module.exports = { createFeishuCredentialStore, FORMAT };
