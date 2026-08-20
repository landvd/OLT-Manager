import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync
} from "node:crypto";

const FORMAT = "olt-manager/encrypted-backup-container";
const VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KDF = "scrypt";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 96 * 1024 * 1024;
const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

class BackupContainerError extends Error {
  constructor(code, message = "加密备份容器无效。") {
    super(message);
    this.name = "BackupContainerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackupContainerError(code, message);
}

function password(value) {
  if (typeof value !== "string" || [...value].length < 8) {
    fail("BACKUP_PASSWORD_INVALID", "主密码至少需要 8 位。");
  }
  return value;
}

function purpose(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,95}$/i.test(value)) {
    fail("BACKUP_PURPOSE_INVALID", "备份用途格式无效。");
  }
  return value;
}

function bytes(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail("BACKUP_BYTES_INVALID", `${label}必须是 Buffer 或 Uint8Array。`);
}

function base64(value) {
  return Buffer.from(value).toString("base64");
}

function decodeBase64(value, label, expectedLength) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail("BACKUP_FORMAT_INVALID", `${label}格式无效。`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || decoded.length !== expectedLength) {
    fail("BACKUP_FORMAT_INVALID", `${label}长度无效。`);
  }
  return decoded;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function aadFor(cleanPurpose) {
  return Buffer.from(`${FORMAT}/v${VERSION}/purpose/${cleanPurpose}`, "utf8");
}

function deriveKey(masterPassword, salt) {
  return scryptSync(password(masterPassword), salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

function parseContainer(value) {
  const container = bytes(value, "容器");
  if (container.length > MAX_CONTAINER_BYTES) fail("BACKUP_CONTAINER_TOO_LARGE");
  const text = container.toString("utf8");
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    fail("BACKUP_FORMAT_INVALID");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) fail("BACKUP_FORMAT_INVALID");
  if (envelope.format !== FORMAT || envelope.version !== VERSION || envelope.algorithm !== ALGORITHM || envelope.kdf !== KDF) {
    fail("BACKUP_FORMAT_UNSUPPORTED");
  }
  const cleanPurpose = purpose(envelope.purpose);
  if (!Number.isSafeInteger(envelope.payloadSize) || envelope.payloadSize < 0 || envelope.payloadSize > MAX_PAYLOAD_BYTES) {
    fail("BACKUP_METADATA_INVALID");
  }
  if (typeof envelope.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(envelope.payloadSha256)) {
    fail("BACKUP_METADATA_INVALID");
  }
  if (envelope.kdfN !== SCRYPT_OPTIONS.N || envelope.kdfR !== SCRYPT_OPTIONS.r || envelope.kdfP !== SCRYPT_OPTIONS.p) {
    fail("BACKUP_KDF_UNSUPPORTED");
  }
  const salt = decodeBase64(envelope.salt, "salt", SALT_LENGTH);
  const iv = decodeBase64(envelope.iv, "nonce", IV_LENGTH);
  const authTag = decodeBase64(envelope.authTag, "认证标签", AUTH_TAG_LENGTH);
  const ciphertext = typeof envelope.ciphertext === "string" ? Buffer.from(envelope.ciphertext, "base64") : null;
  if (!ciphertext || ciphertext.toString("base64") !== envelope.ciphertext || ciphertext.length > MAX_PAYLOAD_BYTES) {
    fail("BACKUP_FORMAT_INVALID");
  }
  return { envelope, cleanPurpose, salt, iv, authTag, ciphertext };
}

export function createEncryptedBackupContainer(payload, masterPassword, { purpose: backupPurpose = "sqlite-full" } = {}) {
  const plain = bytes(payload, "备份内容");
  if (plain.length > MAX_PAYLOAD_BYTES) fail("BACKUP_PAYLOAD_TOO_LARGE");
  const cleanPurpose = purpose(backupPurpose);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(masterPassword, salt), iv);
  cipher.setAAD(aadFor(cleanPurpose));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope = {
    format: FORMAT,
    version: VERSION,
    purpose: cleanPurpose,
    algorithm: ALGORITHM,
    kdf: KDF,
    kdfN: SCRYPT_OPTIONS.N,
    kdfR: SCRYPT_OPTIONS.r,
    kdfP: SCRYPT_OPTIONS.p,
    salt: base64(salt),
    iv: base64(iv),
    authTag: base64(cipher.getAuthTag()),
    payloadSize: plain.length,
    payloadSha256: digest(plain),
    ciphertext: base64(ciphertext)
  };
  const container = Buffer.from(JSON.stringify(envelope), "utf8");
  if (container.length > MAX_CONTAINER_BYTES) fail("BACKUP_CONTAINER_TOO_LARGE");
  return container;
}

export function inspectEncryptedBackupContainer(container) {
  const { envelope } = parseContainer(container);
  return Object.freeze({
    format: envelope.format,
    version: envelope.version,
    purpose: envelope.purpose,
    algorithm: envelope.algorithm,
    kdf: envelope.kdf,
    payloadSize: envelope.payloadSize,
    payloadSha256: envelope.payloadSha256
  });
}

export function decryptEncryptedBackupContainer(container, masterPassword) {
  const { envelope, cleanPurpose, salt, iv, authTag, ciphertext } = parseContainer(container);
  const decipher = createDecipheriv(ALGORITHM, deriveKey(masterPassword, salt), iv);
  decipher.setAAD(aadFor(cleanPurpose));
  decipher.setAuthTag(authTag);
  let plain;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail("BACKUP_DECRYPT_FAILED", "加密备份解密失败。");
  }
  if (plain.length !== envelope.payloadSize || digest(plain) !== envelope.payloadSha256) {
    fail("BACKUP_INTEGRITY_FAILED", "加密备份完整性校验失败。");
  }
  return plain;
}

export { BackupContainerError, MAX_CONTAINER_BYTES, MAX_PAYLOAD_BYTES };
