import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BACKUP_POLICY,
  normalizeBackupMetadata,
  normalizeBackupPolicy,
  selectBackupCleanupCandidates,
  validateBackupSecurityMetadata
} from "../src/backup-policy.mjs";

const NOW = "2026-08-19T00:00:00.000Z";
const encrypted = {
  encrypted: true,
  encryptionAlgorithm: "aes-256-gcm",
  encryptionFormatVersion: 1
};

function backup(id, createdAt, overrides = {}) {
  return {
    id,
    fileName: `${id}.sqlite.enc`,
    createdAt,
    sizeBytes: "1024",
    backupType: "sqlite-full",
    ...encrypted,
    ...overrides
  };
}

test("default backup policy is explicit and immutable", () => {
  const policy = normalizeBackupPolicy();
  assert.deepEqual(policy, DEFAULT_BACKUP_POLICY);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.protectedBackupIds), true);
});

test("metadata normalizes size, filename, and timestamps without returning a path", () => {
  const metadata = normalizeBackupMetadata({
    id: "backup-1",
    path: "/private/backup folder/backup 1.sqlite.enc",
    size: "2048",
    createdAt: "2026-08-18T12:00:00+08:00",
    ...encrypted,
    backupType: "sqlite-full"
  });
  assert.equal(metadata.fileName, "backup_1.sqlite.enc");
  assert.equal(metadata.sizeBytes, 2048);
  assert.equal(metadata.createdAt, "2026-08-18T04:00:00.000Z");
  assert.equal(metadata.modifiedAt, metadata.createdAt);
  assert.equal(Object.hasOwn(metadata, "path"), false);
});

test("expired and count-overflow backups are selected while newest minimum is retained", () => {
  const candidates = selectBackupCleanupCandidates([
    backup("oldest", "2026-07-01T00:00:00.000Z"),
    backup("old", "2026-07-10T00:00:00.000Z"),
    backup("middle", "2026-08-01T00:00:00.000Z"),
    backup("new", "2026-08-18T00:00:00.000Z")
  ], {
    now: NOW,
    policy: { retentionDays: 30, maxBackups: 3, minBackups: 2 }
  });
  assert.deepEqual(candidates.map(({ id, reason }) => ({ id, reason })), [
    { id: "oldest", reason: "expired+count" },
    { id: "old", reason: "expired" }
  ]);
});

test("protected backups are never cleanup candidates", () => {
  const candidates = selectBackupCleanupCandidates([
    backup("protected-by-record", "2026-01-01T00:00:00.000Z", { protected: true }),
    backup("protected-by-policy", "2026-01-02T00:00:00.000Z"),
    backup("removable", "2026-01-03T00:00:00.000Z")
  ], {
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0, protectedBackupIds: ["protected-by-policy"] }
  });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["removable"]);
});

test("invalid policies are rejected before candidate selection", () => {
  assert.throws(
    () => normalizeBackupPolicy({ minBackups: 4, maxBackups: 3 }),
    { code: "BACKUP_POLICY_INVALID" }
  );
  assert.throws(
    () => normalizeBackupPolicy({ protectedBackupIds: ["unsafe id"] }),
    { code: "BACKUP_METADATA_INVALID" }
  );
});

test("unencrypted complete SQLite metadata is unsafe and selection fails closed", () => {
  const security = validateBackupSecurityMetadata({
    encrypted: false,
    backupType: "sqlite-full"
  }, { requireEncryption: false });
  assert.equal(security.valid, false);
  assert.equal(security.isSafeBackup, false);
  assert.equal(security.reason, "COMPLETE_SQLITE_ENCRYPTION_REQUIRED");

  assert.throws(
    () => selectBackupCleanupCandidates([
      backup("unsafe", "2026-01-01T00:00:00.000Z", { encrypted: false })
    ], { now: NOW, policy: { requireEncryption: false, minBackups: 0, maxBackups: 1 } }),
    { code: "BACKUP_SECURITY_FAIL_CLOSED" }
  );
});

test("candidate ordering is stable for equal timestamps", () => {
  const candidates = selectBackupCleanupCandidates([
    backup("zeta", "2026-01-01T00:00:00.000Z"),
    backup("alpha", "2026-01-01T00:00:00.000Z"),
    backup("beta", "2026-01-01T00:00:00.000Z")
  ], {
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 }
  });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["alpha", "beta", "zeta"]);
});

test("unsafe path-like metadata is rejected without echoing its contents", () => {
  assert.throws(
    () => normalizeBackupMetadata({
      id: "backup-1",
      path: "/tmp/backup?password=do-not-echo.sqlite",
      createdAt: NOW,
      ...encrypted
    }),
    { code: "BACKUP_PATH_UNSAFE" }
  );
});
