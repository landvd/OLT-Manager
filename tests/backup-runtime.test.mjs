import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeBackupCleanup, planBackupCleanup } from "../src/backup-runtime.mjs";

const NOW = "2026-08-19T00:00:00.000Z";
const roots = [];
const extraPaths = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(extraPaths.splice(0).map((filePath) => rm(filePath, { force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "olt-manager-backup-runtime-"));
  roots.push(root);
  return root;
}

async function makeBackup(root, id, {
  createdAt = "2026-07-01T00:00:00.000Z",
  fileName = `olt-manager-${id}.sqlite.enc`,
  encrypted = true,
  protected: protectedBackup = false,
  metadataFileName = fileName
} = {}) {
  const bytes = Buffer.from(`encrypted-container:${id}`);
  const filePath = join(root, fileName);
  await writeFile(filePath, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(root, `${fileName}.metadata.json`), JSON.stringify({
    id,
    fileName: metadataFileName,
    backupType: "sqlite-full",
    sizeBytes: bytes.length,
    createdAt,
    modifiedAt: createdAt,
    protected: protectedBackup,
    security: {
      encrypted,
      encryptionAlgorithm: "aes-256-gcm",
      encryptionFormatVersion: 1
    },
    integrity: {
      algorithm: "sha256",
      sha256: digest,
      sizeBytes: bytes.length,
      sqliteIntegrityCheck: "ok"
    }
  }));
  return { filePath, sidecarPath: join(root, `${fileName}.metadata.json`) };
}

test("dry-run only plans cleanup and does not delete files", async () => {
  const root = await makeRoot();
  const files = await makeBackup(root, "old");
  const plan = await planBackupCleanup({
    backupsRoot: root,
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 }
  });
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.candidates.map((candidate) => candidate.id), ["old"]);
  await stat(files.filePath);
  await stat(files.sidecarPath);
});

test("existing unencrypted complete SQLite is fail-closed even with a sidecar", async () => {
  const root = await makeRoot();
  const fileName = "olt-manager-plain.sqlite";
  const bytes = Buffer.from("SQLite format 3\0plain-database");
  await writeFile(join(root, fileName), bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(root, `${fileName}.metadata.json`), JSON.stringify({
    id: "plain",
    fileName,
    backupType: "sqlite-full",
    sizeBytes: bytes.length,
    createdAt: "2026-01-01T00:00:00.000Z",
    security: { encrypted: false, encryptionAlgorithm: "aes-256-gcm", encryptionFormatVersion: 1 },
    integrity: { algorithm: "sha256", sha256: digest, sizeBytes: bytes.length, sqliteIntegrityCheck: "ok" }
  }));
  const plan = await planBackupCleanup({
    backupsRoot: root,
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0, requireEncryption: false }
  });
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.blocked[0].reason, "COMPLETE_SQLITE_ENCRYPTION_REQUIRED");
});

test("protected backup is excluded while another eligible backup is selected", async () => {
  const root = await makeRoot();
  await makeBackup(root, "protected", { protected: true });
  await makeBackup(root, "removable");
  const plan = await planBackupCleanup({
    backupsRoot: root,
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 }
  });
  assert.deepEqual(plan.candidates.map((candidate) => candidate.id), ["removable"]);
});

test("execute requires confirmation and removes only the issued candidate pair", async () => {
  const root = await makeRoot();
  const files = await makeBackup(root, "removable");
  const plan = await planBackupCleanup({
    backupsRoot: root,
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 }
  });
  await assert.rejects(
    () => executeBackupCleanup({ backupsRoot: root, plan }),
    { code: "BACKUP_EXECUTE_CONFIRMATION_REQUIRED" }
  );
  const result = await executeBackupCleanup({ backupsRoot: root, plan, confirmed: true });
  assert.deepEqual(result.summary, { requestedCount: 1, deletedCount: 1, failedCount: 0, skippedCount: 0 });
  await assert.rejects(() => readFile(files.filePath), { code: "ENOENT" });
  await assert.rejects(() => readFile(files.sidecarPath), { code: "ENOENT" });
});

test("metadata path traversal is blocked and cannot target a file outside the root", async () => {
  const root = await makeRoot();
  const outside = join(root, "..", "outside.sqlite.enc");
  extraPaths.push(outside);
  await writeFile(outside, "must-survive");
  await makeBackup(root, "traversal", { metadataFileName: "../outside.sqlite.enc" });
  const plan = await planBackupCleanup({
    backupsRoot: root,
    now: NOW,
    policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 }
  });
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.blocked[0].reason, "BACKUP_METADATA_FILENAME_MISMATCH");
  assert.equal(await readFile(outside, "utf8"), "must-survive");
  await assert.rejects(
    () => planBackupCleanup({ backupsRoot: "../outside" }),
    { code: "BACKUP_ROOT_UNSAFE" }
  );
});

test("explicit cleanup fails closed when another process owns the cleanup lock", async () => {
  const root = await makeRoot();
  const files = await makeBackup(root, "locked");
  const plan = await planBackupCleanup({ backupsRoot: root, now: NOW, policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 } });
  await writeFile(join(root, ".backup-cleanup.lock"), JSON.stringify({ pid: process.pid, startedAt: Date.now(), ownerToken: "other-process" }));

  await assert.rejects(
    () => executeBackupCleanup({ backupsRoot: root, plan, confirmed: true }),
    { code: "BACKUP_CLEANUP_LOCKED" }
  );
  await stat(files.filePath);
});

test("cleanup can recover a dead stale lock and removes it after success", async () => {
  const root = await makeRoot();
  const files = await makeBackup(root, "stale");
  const plan = await planBackupCleanup({ backupsRoot: root, now: NOW, policy: { retentionDays: 1, maxBackups: 1, minBackups: 0 } });
  const lockPath = join(root, ".backup-cleanup.lock");
  await writeFile(lockPath, JSON.stringify({ pid: 99999999, startedAt: Date.now() - 2 * 60 * 60 * 1000, ownerToken: "dead-process" }));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(lockPath, old, old);

  const result = await executeBackupCleanup({ backupsRoot: root, plan, confirmed: true });
  assert.equal(result.summary.deletedCount, 1);
  await assert.rejects(() => stat(files.filePath), { code: "ENOENT" });
  await assert.rejects(() => stat(lockPath), { code: "ENOENT" });
});
