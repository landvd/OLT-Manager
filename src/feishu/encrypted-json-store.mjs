import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const FEISHU_STATE_ENVELOPE_FORMAT = "olt-manager/feishu-state/aes-256-gcm/v1";

export function createEncryptedJsonStore({ key, readFile, writeFileAtomic, path }) {
  if (typeof key !== "function" || typeof readFile !== "function" ||
      typeof writeFileAtomic !== "function" || !path) {
    throw new TypeError("Encrypted Feishu store requires key, file and path adapters.");
  }

  async function readKey() {
    const value = await key();
    if (!Buffer.isBuffer(value) || value.length !== 32) {
      throw new Error("Feishu state encryption key unavailable");
    }
    return value;
  }

  return Object.freeze({
    async write(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await readKey(), nonce);
      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await writeFileAtomic(path, JSON.stringify({
        format: FEISHU_STATE_ENVELOPE_FORMAT,
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
      }));
    },

    async read() {
      const serialized = await readFile(path);
      if (serialized === undefined) return undefined;
      try {
        const envelope = JSON.parse(serialized);
        if (envelope.format !== FEISHU_STATE_ENVELOPE_FORMAT) throw new Error("format");
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
        if (error?.message === "Feishu state encryption key unavailable") throw error;
        throw new Error("Feishu state authentication failed", { cause: error });
      }
    }
  });
}
