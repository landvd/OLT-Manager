import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./oss-credential-crypto.mjs";

const FORMAT = "olt-manager/secret-envelope/v1";
const OS_BACKEND = "safeStorage";
const MASTER_BACKEND = "masterPassword";

function text(value, label) {
  const result = String(value ?? "");
  if (!result) throw new Error(`${label}不能为空。`);
  return result;
}

function purposeText(value) {
  const purpose = text(value, "密文用途");
  if (!/^[a-z0-9][a-z0-9._/-]{0,95}$/i.test(purpose)) throw new Error("密文用途格式无效。");
  return purpose;
}

function referenceText(value) {
  const reference = String(value ?? "");
  if (reference && !/^[a-z0-9:_./-]{1,200}$/i.test(reference)) throw new Error("凭据引用格式无效。");
  return reference;
}

function isSafeStorageAvailable(safeStorage) {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function decodeCiphertext(value) {
  const encoded = text(value, "系统密文");
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length || decoded.toString("base64") !== encoded) throw new Error("系统密文格式无效。");
  return decoded;
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || envelope.format !== FORMAT) {
    throw new Error("凭据封装格式无效。");
  }
  if (Number(envelope.version) !== 1) throw new Error("凭据封装版本不受支持。");
  if (envelope.backend !== OS_BACKEND && envelope.backend !== MASTER_BACKEND) {
    throw new Error("凭据存储后端不受支持。");
  }
  return envelope;
}

function publicMetadata(envelope) {
  validateEnvelope(envelope);
  return Object.freeze({
    format: FORMAT,
    backend: envelope.backend,
    reference: typeof envelope.reference === "string" ? envelope.reference : "",
    purpose: typeof envelope.purpose === "string" ? envelope.purpose : "generic"
  });
}

/**
 * Unified runtime credential seam.
 * - safeStorage is machine-bound and intended for desktop auto-login.
 * - masterPassword is portable and intended for Web/Node and cross-machine restore.
 * No Electron import is performed here; callers inject Electron's safeStorage.
 */
export function createSecretProvider({ safeStorage, randomBytesImpl = randomBytes } = {}) {
  const osAvailable = () => isSafeStorageAvailable(safeStorage);

  function requireOsStorage() {
    if (!osAvailable()) throw new Error("当前运行环境不支持系统加密存储。");
    if (typeof safeStorage.encryptString !== "function" || typeof safeStorage.decryptString !== "function") {
      throw new Error("系统加密存储接口不可用。");
    }
  }

  function createOsEnvelope(secret, reference, purpose) {
    requireOsStorage();
    const encrypted = safeStorage.encryptString(text(secret, "凭据"));
    if (!encrypted || typeof encrypted.toString !== "function") throw new Error("系统加密存储失败。");
    return {
      format: FORMAT,
      version: 1,
      backend: OS_BACKEND,
      purpose,
      reference,
      ciphertext: Buffer.from(encrypted).toString("base64")
    };
  }

  return Object.freeze({
    format: FORMAT,
    capabilities() {
      return Object.freeze({ osEncryption: osAvailable(), portableMasterPassword: true });
    },
    metadata(envelope) {
      return publicMetadata(envelope);
    },
    async seal(secret, { mode = "auto", masterPassword, purpose = "generic", reference = "" } = {}) {
      const cleanPurpose = purposeText(purpose);
      const cleanReference = referenceText(reference);
      if (mode === "os" || (mode === "auto" && osAvailable() && masterPassword === undefined)) {
        return createOsEnvelope(secret, cleanReference, cleanPurpose);
      }
      if (mode !== "portable" && mode !== "auto") throw new Error("凭据存储模式不受支持。");
      return {
        format: FORMAT,
        version: 1,
        backend: MASTER_BACKEND,
        purpose: cleanPurpose,
        reference: cleanReference,
        payload: encryptSecret(secret, masterPassword, { purpose: cleanPurpose })
      };
    },
    async open(envelope, { masterPassword } = {}) {
      const value = validateEnvelope(envelope);
      if (value.backend === OS_BACKEND) {
        requireOsStorage();
        try {
          return text(safeStorage.decryptString(decodeCiphertext(value.ciphertext)), "凭据");
        } catch (error) {
          throw new Error("系统凭据解密失败。", { cause: error });
        }
      }
      try {
        return text(decryptSecret(value.payload, masterPassword), "凭据");
      } catch (error) {
        throw new Error("可迁移凭据解密失败。", { cause: error });
      }
    },
    randomReference(prefix = "secret") {
      const safePrefix = /^[a-z0-9-]+$/i.test(String(prefix)) ? String(prefix) : "secret";
      return `${safePrefix}-${Buffer.from(randomBytesImpl(12)).toString("hex")}`;
    }
  });
}

export { FORMAT as SECRET_ENVELOPE_FORMAT, MASTER_BACKEND, OS_BACKEND };
