const fs = require("node:fs/promises");
const path = require("node:path");
const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");

const STATE_FORMAT = "olt-manager/feishu-state-store/v1";
const KEY_FORMAT = "olt-manager/feishu-state-key/v1";

function createFeishuStateStore({ dataDirectory, safeStorage }) {
  const statePath = path.join(dataDirectory, "feishu-state.enc");
  const keyPath = path.join(dataDirectory, "feishu-state-key.json");

  async function writeAtomic(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  async function readKey() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Feishu state OS encryption unavailable");
    }
    try {
      const envelope = JSON.parse(await fs.readFile(keyPath, "utf8"));
      if (envelope.format !== KEY_FORMAT || typeof envelope.ciphertext !== "string") {
        throw new Error("invalid key envelope");
      }
      const key = Buffer.from(safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64")), "base64");
      if (key.length !== 32) throw new Error("invalid key length");
      return key;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Feishu state key unavailable", { cause: error });
      const key = randomBytes(32);
      const encrypted = safeStorage.encryptString(key.toString("base64")).toString("base64");
      await writeAtomic(keyPath, JSON.stringify({ format: KEY_FORMAT, ciphertext: encrypted }));
      return key;
    }
  }

  return Object.freeze({
    async write(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await readKey(), nonce);
      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await writeAtomic(statePath, JSON.stringify({
        format: STATE_FORMAT,
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
      }));
    },

    async read() {
      let serialized;
      try {
        serialized = await fs.readFile(statePath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
      try {
        const envelope = JSON.parse(serialized);
        if (envelope.format !== STATE_FORMAT) throw new Error("invalid state envelope");
        const decipher = createDecipheriv(
          "aes-256-gcm", await readKey(), Buffer.from(envelope.nonce, "base64")
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64")),
          decipher.final()
        ]);
        return JSON.parse(plaintext.toString("utf8"));
      } catch (error) {
        throw new Error("Feishu state authentication failed", { cause: error });
      }
    }
  });
}

module.exports = { createFeishuStateStore, KEY_FORMAT, STATE_FORMAT };
