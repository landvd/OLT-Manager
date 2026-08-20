import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const FORMAT_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KDF = "scrypt";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const ASSOCIATED_DATA = Buffer.from("olt-manager/oss-ngb-password/v1", "utf8");
const GENERIC_FORMAT_VERSION = 1;
const GENERIC_ALGORITHM = "aes-256-gcm";
const GENERIC_KDF = "scrypt";

function requiredText(value, label) {
  const text = String(value ?? "");
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function validateMasterPassword(value, label = "迁移主密码") {
  const masterPassword = requiredText(value, label);
  if ([...masterPassword].length < 8) throw new Error(`${label}至少需要 8 位。`);
  return masterPassword;
}

function deriveKey(masterPassword, salt) {
  return scryptSync(masterPassword, salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

function associatedDataForPurpose(purpose) {
  const value = requiredText(purpose, "密文用途");
  if (!/^[a-z0-9][a-z0-9._/-]{0,95}$/i.test(value)) throw new Error("密文用途格式无效。");
  return Buffer.from(`olt-manager/secret/${value}/v1`, "utf8");
}

function base64(value) {
  return Buffer.from(value).toString("base64");
}

function decodeBase64(value, label, expectedLength) {
  const text = requiredText(value, label);
  const decoded = Buffer.from(text, "base64");
  if (!decoded.length || decoded.toString("base64") !== text) throw new Error(`${label}格式无效。`);
  if (expectedLength && decoded.length !== expectedLength) throw new Error(`${label}长度无效。`);
  return decoded;
}

export function encryptOssNgbPassword(password, migrationMasterPassword) {
  const cleanPassword = requiredText(password, "网管二期登录密码");
  const masterPassword = validateMasterPassword(migrationMasterPassword);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(masterPassword, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(ASSOCIATED_DATA);
  const ciphertext = Buffer.concat([cipher.update(cleanPassword, "utf8"), cipher.final()]);
  return {
    version: FORMAT_VERSION,
    algorithm: ALGORITHM,
    kdf: KDF,
    kdfN: SCRYPT_OPTIONS.N,
    kdfR: SCRYPT_OPTIONS.r,
    kdfP: SCRYPT_OPTIONS.p,
    salt: base64(salt),
    iv: base64(iv),
    authTag: base64(cipher.getAuthTag()),
    ciphertext: base64(ciphertext)
  };
}

export function decryptOssNgbPassword(credential, migrationMasterPassword) {
  const masterPassword = validateMasterPassword(migrationMasterPassword);
  if (Number(credential?.version) !== FORMAT_VERSION || credential?.algorithm !== ALGORITHM || credential?.kdf !== KDF) {
    throw new Error("网管二期已保存密码的加密格式不受支持。");
  }
  if (Number(credential.kdfN) !== SCRYPT_OPTIONS.N || Number(credential.kdfR) !== SCRYPT_OPTIONS.r || Number(credential.kdfP) !== SCRYPT_OPTIONS.p) {
    throw new Error("网管二期已保存密码的加密参数不受支持。");
  }
  const salt = decodeBase64(credential.salt, "密码密文 salt", SALT_LENGTH);
  const iv = decodeBase64(credential.iv, "密码密文 nonce", IV_LENGTH);
  const authTag = decodeBase64(credential.authTag, "密码密文认证标签", AUTH_TAG_LENGTH);
  const ciphertext = decodeBase64(credential.ciphertext, "密码密文");
  const decipher = createDecipheriv(ALGORITHM, deriveKey(masterPassword, salt), iv);
  decipher.setAAD(ASSOCIATED_DATA);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function migrationMasterPasswordIsValid(value) {
  try {
    validateMasterPassword(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a generic secret for storage in SQLite/backup material.
 * The master password is deliberately not part of the returned envelope.
 */
export function encryptSecret(secret, masterPassword, { purpose = "generic" } = {}) {
  const cleanSecret = requiredText(secret, "凭据");
  const cleanMasterPassword = validateMasterPassword(masterPassword, "主密码");
  const aad = associatedDataForPurpose(purpose);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(cleanMasterPassword, salt);
  const cipher = createCipheriv(GENERIC_ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(cleanSecret, "utf8"), cipher.final()]);
  return {
    version: GENERIC_FORMAT_VERSION,
    algorithm: GENERIC_ALGORITHM,
    kdf: GENERIC_KDF,
    purpose: String(purpose),
    kdfN: SCRYPT_OPTIONS.N,
    kdfR: SCRYPT_OPTIONS.r,
    kdfP: SCRYPT_OPTIONS.p,
    salt: base64(salt),
    iv: base64(iv),
    authTag: base64(cipher.getAuthTag()),
    ciphertext: base64(ciphertext)
  };
}

export function decryptSecret(envelope, masterPassword) {
  const cleanMasterPassword = validateMasterPassword(masterPassword, "主密码");
  if (Number(envelope?.version) !== GENERIC_FORMAT_VERSION || envelope?.algorithm !== GENERIC_ALGORITHM || envelope?.kdf !== GENERIC_KDF) {
    throw new Error("凭据密文格式不受支持。");
  }
  if (Number(envelope.kdfN) !== SCRYPT_OPTIONS.N || Number(envelope.kdfR) !== SCRYPT_OPTIONS.r || Number(envelope.kdfP) !== SCRYPT_OPTIONS.p) {
    throw new Error("凭据密文参数不受支持。");
  }
  const aad = associatedDataForPurpose(envelope.purpose);
  const salt = decodeBase64(envelope.salt, "密码密文 salt", SALT_LENGTH);
  const iv = decodeBase64(envelope.iv, "密码密文 nonce", IV_LENGTH);
  const authTag = decodeBase64(envelope.authTag, "密码密文认证标签", AUTH_TAG_LENGTH);
  const ciphertext = decodeBase64(envelope.ciphertext, "密码密文");
  const decipher = createDecipheriv(GENERIC_ALGORITHM, deriveKey(cleanMasterPassword, salt), iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
