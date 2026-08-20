const DAY_MS = 24 * 60 * 60 * 1000;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const CREDENTIAL_PATTERN = /(?:password|passwd|secret|token|cookie|authorization|community)\s*[:=]/i;
const ENCRYPTION_ALGORITHMS = new Set(["aes-256-gcm", "age"]);

export const DEFAULT_BACKUP_POLICY = Object.freeze({
  retentionDays: 30,
  maxBackups: 20,
  minBackups: 3,
  requireEncryption: true,
  protectedBackupIds: Object.freeze([])
});

export class BackupPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackupPolicyError(code, message);
}

function normalizeInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const candidate = typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    fail("BACKUP_POLICY_INVALID", `${field} 必须是 ${min}-${max} 范围内的整数。`);
  }
  return candidate;
}

function normalizeOpaqueId(value, field = "backupId") {
  if (typeof value !== "string") {
    fail("BACKUP_METADATA_INVALID", `${field} 必须是不透明字符串。`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !SAFE_NAME_PATTERN.test(normalized)) {
    fail("BACKUP_METADATA_INVALID", `${field} 格式不安全。`);
  }
  return normalized;
}

function assertSafePathInput(value) {
  if (typeof value !== "string" || !value.trim()) {
    fail("BACKUP_METADATA_INVALID", "备份文件名不能为空。");
  }
  if (/\p{Cc}/u.test(value) || value.includes("\0") || /:\/\//.test(value) || /[?#]/.test(value)) {
    fail("BACKUP_PATH_UNSAFE", "备份路径包含不允许的控制字符或远端标记。");
  }
  if (CREDENTIAL_PATTERN.test(value)) {
    fail("BACKUP_PATH_UNSAFE", "备份路径疑似包含凭据字段。");
  }
}

function normalizeBackupFileName(value) {
  assertSafePathInput(value);
  const source = value.trim().split(/[\\/]/).at(-1);
  if (!source || source === "." || source === "..") {
    fail("BACKUP_METADATA_INVALID", "备份文件名无效。");
  }
  const normalized = source
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+$/, "_")
    .slice(0, 128);
  if (!normalized || !SAFE_NAME_PATTERN.test(normalized)) {
    fail("BACKUP_METADATA_INVALID", "备份文件名格式不安全。");
  }
  return normalized;
}

function normalizeTimestamp(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    fail("BACKUP_METADATA_INVALID", `${field} 必须是有效时间。`);
  }
  const date = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "number"
      ? new Date(value)
      : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    fail("BACKUP_METADATA_INVALID", `${field} 必须是有效时间。`);
  }
  return date.toISOString();
}

function normalizeSizeBytes(value) {
  if (value === undefined || value === null || value === "") return 0;
  return normalizeInteger(value, "sizeBytes", { max: Number.MAX_SAFE_INTEGER });
}

function normalizeBackupType(input) {
  if (input.isCompleteSqlite === true || input.backupType === "sqlite-full" || input.kind === "sqlite-full") {
    return "sqlite-full";
  }
  if (typeof input.backupType === "string" && SAFE_NAME_PATTERN.test(input.backupType)) {
    return input.backupType;
  }
  if (typeof input.kind === "string" && SAFE_NAME_PATTERN.test(input.kind)) {
    return input.kind;
  }
  return "artifact";
}

function normalizeBoolean(value, field) {
  if (typeof value !== "boolean") {
    fail("BACKUP_METADATA_INVALID", `${field} 必须是布尔值。`);
  }
  return value;
}

/**
 * Validate security metadata without touching files or attempting decryption.
 * `valid` means the metadata can be acted on under the supplied policy;
 * `isSafeBackup` is deliberately false for every unencrypted backup.
 */
export function validateBackupSecurityMetadata(input, { requireEncryption = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      isSafeBackup: false,
      status: "invalid",
      reason: "SECURITY_METADATA_MISSING"
    };
  }
  if (typeof requireEncryption !== "boolean") {
    fail("BACKUP_POLICY_INVALID", "requireEncryption 必须是布尔值。");
  }

  const encrypted = input.encrypted ?? input.isEncrypted;
  if (typeof encrypted !== "boolean") {
    return {
      valid: false,
      isSafeBackup: false,
      status: "unknown",
      reason: "ENCRYPTION_STATUS_UNKNOWN"
    };
  }

  const backupType = input.backupType ?? input.kind;
  const isCompleteSqlite = input.isCompleteSqlite === true || backupType === "sqlite-full";
  if (!encrypted) {
    if (isCompleteSqlite) {
      return {
        valid: false,
        isSafeBackup: false,
        status: "unsafe",
        reason: "COMPLETE_SQLITE_ENCRYPTION_REQUIRED",
        encrypted: false,
        backupType: "sqlite-full"
      };
    }
    if (requireEncryption) {
      return {
        valid: false,
        isSafeBackup: false,
        status: "unsafe",
        reason: "ENCRYPTION_REQUIRED",
        encrypted: false
      };
    }
    return {
      valid: true,
      isSafeBackup: false,
      status: "unsafe",
      reason: "UNENCRYPTED_ALLOWED_BY_POLICY",
      encrypted: false
    };
  }

  const algorithm = input.encryptionAlgorithm ?? input.algorithm;
  if (typeof algorithm !== "string" || !ENCRYPTION_ALGORITHMS.has(algorithm)) {
    return {
      valid: false,
      isSafeBackup: false,
      status: "invalid",
      reason: "ENCRYPTION_ALGORITHM_UNKNOWN",
      encrypted: true
    };
  }
  const formatVersion = input.encryptionFormatVersion ?? input.formatVersion ?? 1;
  if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
    return {
      valid: false,
      isSafeBackup: false,
      status: "invalid",
      reason: "ENCRYPTION_FORMAT_INVALID",
      encrypted: true,
      algorithm
    };
  }
  return {
    valid: true,
    isSafeBackup: true,
    status: "safe",
    reason: "ENCRYPTED",
    encrypted: true,
    algorithm,
    formatVersion
  };
}

export function normalizeBackupPolicy(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("BACKUP_POLICY_INVALID", "备份策略必须是对象。");
  }
  const retentionDays = normalizeInteger(
    input.retentionDays ?? DEFAULT_BACKUP_POLICY.retentionDays,
    "retentionDays",
    { min: 1, max: 3650 }
  );
  const maxBackups = normalizeInteger(
    input.maxBackups ?? DEFAULT_BACKUP_POLICY.maxBackups,
    "maxBackups",
    { min: 1, max: 1000 }
  );
  const minBackups = normalizeInteger(
    input.minBackups ?? DEFAULT_BACKUP_POLICY.minBackups,
    "minBackups",
    { min: 0, max: 1000 }
  );
  if (minBackups > maxBackups) {
    fail("BACKUP_POLICY_INVALID", "minBackups 不能大于 maxBackups。");
  }
  const requireEncryption = input.requireEncryption ?? DEFAULT_BACKUP_POLICY.requireEncryption;
  if (typeof requireEncryption !== "boolean") {
    fail("BACKUP_POLICY_INVALID", "requireEncryption 必须是布尔值。");
  }
  const protectedBackupIds = input.protectedBackupIds ?? DEFAULT_BACKUP_POLICY.protectedBackupIds;
  if (!Array.isArray(protectedBackupIds)) {
    fail("BACKUP_POLICY_INVALID", "protectedBackupIds 必须是数组。");
  }
  const normalizedProtectedIds = [...new Set(protectedBackupIds.map((value) => normalizeOpaqueId(value)))].sort();
  return Object.freeze({
    retentionDays,
    maxBackups,
    minBackups,
    requireEncryption,
    protectedBackupIds: Object.freeze(normalizedProtectedIds)
  });
}

export function normalizeBackupMetadata(input, { requireEncryption = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("BACKUP_METADATA_INVALID", "备份元数据必须是对象。");
  }
  const fileName = normalizeBackupFileName(input.fileName ?? input.name ?? input.path);
  const id = normalizeOpaqueId(input.id ?? fileName);
  const backupType = normalizeBackupType(input);
  const createdAt = normalizeTimestamp(input.createdAt ?? input.created_at, "createdAt");
  const modifiedAt = normalizeTimestamp(
    input.modifiedAt ?? input.modified_at,
    "modifiedAt",
    { required: false }
  ) || createdAt;
  const securityInput = input.security && typeof input.security === "object"
    ? { ...input.security, backupType, isCompleteSqlite: backupType === "sqlite-full" }
    : { ...input, backupType, isCompleteSqlite: backupType === "sqlite-full" };
  const security = validateBackupSecurityMetadata(securityInput, { requireEncryption });
  return Object.freeze({
    id,
    fileName,
    backupType,
    sizeBytes: normalizeSizeBytes(input.sizeBytes ?? input.size),
    createdAt,
    modifiedAt,
    protected: input.protected === true,
    security: Object.freeze(security)
  });
}

function compareNewest(left, right) {
  const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeDifference !== 0) return timeDifference;
  const idDifference = left.id.localeCompare(right.id);
  return idDifference;
}

function compareOldest(left, right) {
  const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (timeDifference !== 0) return timeDifference;
  return left.id.localeCompare(right.id);
}

/**
 * Return cleanup candidates only. This function never deletes, renames, or
 * opens a file. It intentionally returns a sanitized fileName, not a path.
 */
export function selectBackupCleanupCandidates(backups, { policy = {}, now = new Date() } = {}) {
  if (!Array.isArray(backups)) {
    fail("BACKUP_METADATA_INVALID", "备份列表必须是数组。");
  }
  const normalizedPolicy = normalizeBackupPolicy(policy);
  const nowIso = normalizeTimestamp(now, "now");
  const nowMs = Date.parse(nowIso);
  const normalized = backups.map((backup) => normalizeBackupMetadata(backup, {
    requireEncryption: normalizedPolicy.requireEncryption
  }));
  const ids = new Set();
  for (const backup of normalized) {
    if (ids.has(backup.id)) fail("BACKUP_METADATA_INVALID", "备份 ID 不能重复。");
    ids.add(backup.id);
    if (!backup.security.valid) {
      fail("BACKUP_SECURITY_FAIL_CLOSED", "备份安全元数据不满足自动清理条件。");
    }
  }

  const protectedIds = new Set(normalizedPolicy.protectedBackupIds);
  const protectedBackups = normalized.filter((backup) => backup.protected || protectedIds.has(backup.id));
  const unprotectedBackups = normalized
    .filter((backup) => !backup.protected && !protectedIds.has(backup.id))
    .sort(compareNewest);
  const minimumUnprotectedToKeep = Math.max(0, normalizedPolicy.minBackups - protectedBackups.length);
  const maximumUnprotectedToKeep = Math.max(0, normalizedPolicy.maxBackups - protectedBackups.length);
  const cutoffMs = nowMs - normalizedPolicy.retentionDays * DAY_MS;

  return unprotectedBackups
    .map((backup, index) => {
      const expired = Date.parse(backup.createdAt) < cutoffMs;
      const overLimit = index >= maximumUnprotectedToKeep;
      const mustKeep = index < minimumUnprotectedToKeep;
      if (mustKeep || (!expired && !overLimit)) return null;
      const reasons = [];
      if (expired) reasons.push("expired");
      if (overLimit) reasons.push("count");
      return {
        id: backup.id,
        fileName: backup.fileName,
        backupType: backup.backupType,
        sizeBytes: backup.sizeBytes,
        createdAt: backup.createdAt,
        modifiedAt: backup.modifiedAt,
        reason: reasons.join("+")
      };
    })
    .filter(Boolean)
    .sort(compareOldest);
}
