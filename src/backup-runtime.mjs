import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, readdir, realpath, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  BackupPolicyError,
  normalizeBackupMetadata,
  normalizeBackupPolicy,
  selectBackupCleanupCandidates
} from "./backup-policy.mjs";

const SUPPORTED_BACKUP_PATTERN = /^olt-manager-[A-Za-z0-9._-]+\.sqlite(?:\.enc)?$/;
const METADATA_SUFFIX = ".metadata.json";
const MAX_METADATA_BYTES = 64 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CLEANUP_LOCK_FILE = ".backup-cleanup.lock";
const MAX_STALE_LOCK_AGE_MS = 60 * 60 * 1000;
const issuedPlans = new WeakMap();

function fail(code, message) {
  const error = new Error(message);
  error.name = "BackupRuntimeError";
  error.code = code;
  throw error;
}

function isContainedFile(root, fileName) {
  const filePath = join(root, fileName);
  const relativePath = relative(root, filePath);
  return relativePath === fileName && !relativePath.startsWith("..") && !relativePath.includes("/") && !relativePath.includes("\\");
}

async function resolveBackupsRoot(backupsRoot) {
  if (typeof backupsRoot !== "string" || !backupsRoot.trim()) {
    fail("BACKUP_ROOT_REQUIRED", "必须明确指定备份目录。");
  }
  if (!isAbsolute(backupsRoot)) {
    fail("BACKUP_ROOT_UNSAFE", "备份目录必须是绝对路径。");
  }
  const candidate = resolve(backupsRoot);
  let canonical;
  try {
    canonical = await realpath(candidate);
  } catch {
    fail("BACKUP_ROOT_UNAVAILABLE", "备份目录不可用。");
  }
  let details;
  try {
    details = await lstat(canonical);
  } catch {
    fail("BACKUP_ROOT_UNAVAILABLE", "备份目录不可用。");
  }
  if (!details.isDirectory()) fail("BACKUP_ROOT_UNSAFE", "备份根路径不是目录。");
  return canonical;
}

function supportedBackupFile(fileName) {
  return SUPPORTED_BACKUP_PATTERN.test(fileName);
}

function metadataFileName(fileName) {
  return `${fileName}${METADATA_SUFFIX}`;
}

function blocked(fileName, reason) {
  return Object.freeze({ fileName, reason });
}

function errorCode(error, fallback = "BACKUP_METADATA_INVALID") {
  if (error instanceof BackupPolicyError && error.code) return error.code;
  return typeof error?.code === "string" ? error.code : fallback;
}

function requireMetadataFields(raw, fileName) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("BACKUP_METADATA_INVALID", "备份元数据必须是对象。");
  }
  if (raw.fileName !== fileName) {
    fail("BACKUP_METADATA_FILENAME_MISMATCH", "备份元数据文件名不匹配。");
  }
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    fail("BACKUP_METADATA_INVALID", "备份元数据缺少保护 ID。");
  }
  if (raw.backupType !== "sqlite-full" && raw.kind !== "sqlite-full") {
    fail("BACKUP_METADATA_INVALID", "备份类型不是完整 SQLite。");
  }
  const security = raw.security && typeof raw.security === "object" ? raw.security : raw;
  if (typeof (security.encrypted ?? security.isEncrypted) !== "boolean") {
    fail("ENCRYPTION_STATUS_UNKNOWN", "备份加密状态未知。");
  }
  if (typeof (security.encryptionAlgorithm ?? security.algorithm) !== "string") {
    fail("ENCRYPTION_ALGORITHM_UNKNOWN", "备份加密算法未知。");
  }
  const formatVersion = security.encryptionFormatVersion ?? security.formatVersion;
  if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
    fail("ENCRYPTION_FORMAT_INVALID", "备份加密格式版本无效。");
  }
  const integrity = raw.integrity;
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    fail("BACKUP_INTEGRITY_METADATA_MISSING", "缺少完整 SQLite 完整性元数据。");
  }
  const integrityCheck = integrity.sqliteIntegrityCheck ?? integrity.integrityCheck;
  if (integrityCheck !== "ok") {
    fail("BACKUP_INTEGRITY_METADATA_INVALID", "SQLite 完整性元数据无效。");
  }
  if (integrity.algorithm !== "sha256" || typeof integrity.sha256 !== "string" || !SHA256_PATTERN.test(integrity.sha256)) {
    fail("BACKUP_INTEGRITY_METADATA_INVALID", "SQLite 摘要元数据无效。");
  }
  if (!Number.isSafeInteger(integrity.sizeBytes) || integrity.sizeBytes < 0) {
    fail("BACKUP_INTEGRITY_METADATA_INVALID", "SQLite 大小元数据无效。");
  }
}

async function inspectBackup(root, entry, entryMap) {
  const fileName = entry.name;
  if (!entry.isFile() || !supportedBackupFile(fileName)) return { ignored: true };
  if (!isContainedFile(root, fileName)) return { blocked: blocked(fileName, "BACKUP_PATH_UNSAFE") };

  const sidecarName = metadataFileName(fileName);
  const sidecar = entryMap.get(sidecarName);
  if (!sidecar || !sidecar.isFile() || !isContainedFile(root, sidecarName)) {
    return { blocked: blocked(fileName, "SECURITY_METADATA_MISSING") };
  }

  const backupPath = join(root, fileName);
  const sidecarPath = join(root, sidecarName);
  try {
    const [backupDetails, sidecarDetails] = await Promise.all([lstat(backupPath), lstat(sidecarPath)]);
    if (!backupDetails.isFile() || !sidecarDetails.isFile()) {
      return { blocked: blocked(fileName, "BACKUP_PATH_UNSAFE") };
    }
    if (sidecarDetails.size > MAX_METADATA_BYTES) {
      return { blocked: blocked(fileName, "BACKUP_METADATA_TOO_LARGE") };
    }
    const raw = JSON.parse(await readFile(sidecarPath, "utf8"));
    requireMetadataFields(raw, fileName);
    const metadata = normalizeBackupMetadata(raw, { requireEncryption: true });
    if (!metadata.security.valid) {
      return { blocked: blocked(fileName, metadata.security.reason) };
    }
    if (fileName.endsWith(".sqlite")) {
      return { blocked: blocked(fileName, "COMPLETE_SQLITE_ENCRYPTION_REQUIRED") };
    }
    if (metadata.sizeBytes !== backupDetails.size || raw.integrity.sizeBytes !== backupDetails.size) {
      return { blocked: blocked(fileName, "BACKUP_INTEGRITY_SIZE_MISMATCH") };
    }
    const backupBytes = await readFile(backupPath);
    if (fileName.endsWith(".sqlite") && backupBytes.subarray(0, 16).toString() === "SQLite format 3\0") {
      return { blocked: blocked(fileName, "COMPLETE_SQLITE_ENCRYPTION_REQUIRED") };
    }
    const digest = createHash("sha256").update(backupBytes).digest("hex");
    if (digest !== raw.integrity.sha256) {
      return { blocked: blocked(fileName, "BACKUP_INTEGRITY_HASH_MISMATCH") };
    }
    return {
      metadata,
      integrity: Object.freeze({
        algorithm: "sha256",
        sha256: raw.integrity.sha256,
        sizeBytes: backupDetails.size,
        sqliteIntegrityCheck: "ok"
      }),
      sidecarFileName: sidecarName
    };
  } catch (error) {
    return { blocked: blocked(fileName, errorCode(error)) };
  }
}

async function inspectBackups(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const backups = [];
  const blockedBackups = [];
  let ignoredCount = 0;
  for (const entry of entries) {
    const inspected = await inspectBackup(root, entry, entryMap);
    if (inspected.ignored) {
      ignoredCount += 1;
    } else if (inspected.blocked) {
      blockedBackups.push(inspected.blocked);
    } else {
      backups.push({ ...inspected.metadata, integrity: inspected.integrity, sidecarFileName: inspected.sidecarFileName });
    }
  }
  return { backups, blockedBackups, ignoredCount };
}

function summarize({ candidates, blockedBackups, ignoredCount, eligibleCount }) {
  return Object.freeze({
    candidateCount: candidates.length,
    eligibleCount,
    blockedCount: blockedBackups.length,
    ignoredCount,
    blockedReasons: Object.freeze(blockedBackups.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {}))
  });
}

export async function planBackupCleanup({ backupsRoot, policy = {}, now = new Date() } = {}) {
  const root = await resolveBackupsRoot(backupsRoot);
  const normalizedPolicy = normalizeBackupPolicy(policy);
  const inspected = await inspectBackups(root);
  const selected = selectBackupCleanupCandidates(inspected.backups, {
    policy: normalizedPolicy,
    now
  });
  const byFileName = new Map(inspected.backups.map((backup) => [backup.fileName, backup]));
  const candidates = selected.map((candidate) => Object.freeze({
    ...candidate,
    sidecarFileName: byFileName.get(candidate.fileName).sidecarFileName
  }));
  const plan = Object.freeze({
    version: 1,
    dryRun: true,
    candidates: Object.freeze(candidates),
    blocked: Object.freeze(inspected.blockedBackups),
    summary: summarize({
      candidates,
      blockedBackups: inspected.blockedBackups,
      ignoredCount: inspected.ignoredCount,
      eligibleCount: inspected.backups.length
    })
  });
  issuedPlans.set(plan, { root, policy: normalizedPolicy, now });
  return plan;
}

function assertPlan(plan, root) {
  const state = issuedPlans.get(plan);
  if (!state || state.root !== root) fail("BACKUP_PLAN_INVALID", "清理计划无效或不属于当前备份目录。");
  return state;
}

async function safeUnlink(root, fileName) {
  if (typeof fileName !== "string" || !isContainedFile(root, fileName)) {
    fail("BACKUP_PATH_UNSAFE", "清理路径不在备份目录内。");
  }
  const target = join(root, fileName);
  let details;
  try {
    details = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return { deleted: false, missing: true };
    throw error;
  }
  if (!details.isFile()) fail("BACKUP_PATH_UNSAFE", "清理目标不是普通文件。");
  await unlink(target);
  return { deleted: true, missing: false };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readCleanupLock(lockPath) {
  try {
    const [raw, details] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    const record = JSON.parse(raw);
    return {
      pid: Number(record?.pid),
      startedAt: Number(record?.startedAt),
      ownerToken: typeof record?.ownerToken === "string" ? record.ownerToken : "",
      ageMs: Math.max(0, Date.now() - details.mtimeMs)
    };
  } catch {
    return null;
  }
}

async function acquireCleanupLock(root) {
  const lockPath = join(root, CLEANUP_LOCK_FILE);
  const ownerToken = randomUUID();
  const payload = JSON.stringify({ pid: process.pid, startedAt: Date.now(), ownerToken });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(payload, "utf8");
      await handle.close();
      return async () => {
        const current = await readCleanupLock(lockPath);
        if (current?.ownerToken !== ownerToken) return;
        await unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      const current = await readCleanupLock(lockPath);
      const stale = current && !processIsAlive(current.pid) && current.ageMs >= MAX_STALE_LOCK_AGE_MS;
      if (!stale) fail("BACKUP_CLEANUP_LOCKED", "备份清理正在由其他进程执行，请稍后重试。");
      await unlink(lockPath).catch(() => {});
    }
  }
  fail("BACKUP_CLEANUP_LOCKED", "备份清理锁竞争失败，请稍后重试。");
}

export async function executeBackupCleanup({ backupsRoot, plan, confirmed = false } = {}) {
  if (confirmed !== true) fail("BACKUP_EXECUTE_CONFIRMATION_REQUIRED", "执行清理必须明确 confirmed=true。");
  const root = await resolveBackupsRoot(backupsRoot);
  const state = assertPlan(plan, root);
  const releaseLock = await acquireCleanupLock(root);
  try {
    const current = await planBackupCleanup({ backupsRoot: root, policy: state.policy, now: state.now });
    const currentById = new Map(current.candidates.map((candidate) => [candidate.id, candidate]));
    const deleted = [];
    const failed = [];
    const skipped = [];
    for (const candidate of plan.candidates) {
      const currentCandidate = currentById.get(candidate.id);
      if (!currentCandidate || currentCandidate.fileName !== candidate.fileName) {
        skipped.push(Object.freeze({ id: candidate.id, fileName: candidate.fileName, reason: "PLAN_STALE" }));
        continue;
      }
      try {
        const backupResult = await safeUnlink(root, currentCandidate.fileName);
        const metadataResult = await safeUnlink(root, currentCandidate.sidecarFileName);
        deleted.push(Object.freeze({
          id: candidate.id,
          fileName: candidate.fileName,
          deletedBackup: backupResult.deleted,
          deletedMetadata: metadataResult.deleted
        }));
      } catch (error) {
        failed.push(Object.freeze({ id: candidate.id, fileName: candidate.fileName, reason: errorCode(error, "BACKUP_DELETE_FAILED") }));
      }
    }
    return Object.freeze({
      dryRun: false,
      confirmed: true,
      deleted: Object.freeze(deleted),
      failed: Object.freeze(failed),
      skipped: Object.freeze(skipped),
      summary: Object.freeze({
        requestedCount: plan.candidates.length,
        deletedCount: deleted.length,
        failedCount: failed.length,
        skippedCount: skipped.length
      })
    });
  } finally {
    await releaseLock();
  }
}
