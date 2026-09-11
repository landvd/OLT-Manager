import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-merged-recovery-"));
const db = await import(`../src/db.mjs?merged-recovery=${Date.now()}`);
const { createSourceManifest } = await import("../src/merged-onu-manifest.mjs");

const baseTime = "2026-08-19T00:00:00.000Z";

test("persists idempotent runs and refuses a duplicate key", async () => {
  await db.initDb();
  const first = await db.beginMergedOnuSyncRun({
    runId: "recovery-run-1",
    operation: "full",
    idempotencyKey: "recovery-idem-1",
    workerId: "worker-1",
    startedAt: baseTime,
    leaseMs: 60_000
  });
  const duplicate = await db.beginMergedOnuSyncRun({
    runId: "recovery-run-2",
    operation: "full",
    idempotencyKey: "recovery-idem-1",
    workerId: "worker-2",
    startedAt: baseTime,
    leaseMs: 60_000
  });

  assert.equal(first.accepted, true);
  assert.equal(first.run.runId, "recovery-run-1");
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate_idempotency_key");
  assert.equal(duplicate.run.runId, "recovery-run-1");
});

test("only an expired lease can be claimed by another worker", async () => {
  const beforeExpiry = await db.claimMergedOnuSyncLease({
    runId: "recovery-run-1",
    workerId: "worker-2",
    now: "2026-08-19T00:00:30.000Z",
    leaseMs: 60_000
  });
  assert.equal(beforeExpiry.claimed, false);
  assert.equal(beforeExpiry.run.workerId, "worker-1");

  const afterExpiry = await db.claimMergedOnuSyncLease({
    runId: "recovery-run-1",
    workerId: "worker-2",
    now: "2026-08-19T00:02:00.000Z",
    leaseMs: 60_000
  });
  assert.equal(afterExpiry.claimed, true);
  assert.equal(afterExpiry.run.workerId, "worker-2");
});

test("lease renewal succeeds only for the current worker while a running lease is still active", async () => {
  await db.beginMergedOnuSyncRun({
    runId: "renew-active-run",
    operation: "network",
    idempotencyKey: "renew-active-idem",
    workerId: "renew-worker",
    startedAt: "2026-08-19T00:04:00.000Z",
    leaseMs: 60_000
  });

  const renewed = await db.renewMergedOnuSyncLease({
    runId: "renew-active-run",
    workerId: "renew-worker",
    now: "2026-08-19T00:04:30.000Z",
    leaseMs: 120_000
  });
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.run.workerId, "renew-worker");
  assert.equal(renewed.run.status, "running");
  assert.equal(renewed.run.leaseUntil, "2026-08-19T00:06:30.000Z");

  const wrongWorker = await db.renewMergedOnuSyncLease({
    runId: "renew-active-run",
    workerId: "other-worker",
    now: "2026-08-19T00:05:00.000Z",
    leaseMs: 120_000
  });
  assert.equal(wrongWorker.renewed, false);
  assert.equal(wrongWorker.run.workerId, "renew-worker");
  assert.equal(wrongWorker.run.leaseUntil, "2026-08-19T00:06:30.000Z");

  const expired = await db.renewMergedOnuSyncLease({
    runId: "renew-active-run",
    workerId: "renew-worker",
    now: "2026-08-19T00:07:00.000Z",
    leaseMs: 120_000
  });
  assert.equal(expired.renewed, false);
  assert.equal(expired.run.leaseUntil, "2026-08-19T00:06:30.000Z");

  const cleanupClaim = await db.claimMergedOnuSyncLease({
    runId: "renew-active-run",
    workerId: "cleanup-worker",
    now: "2026-08-19T00:07:00.000Z",
    leaseMs: 60_000
  });
  assert.equal(cleanupClaim.claimed, true);
  const cleanup = await db.updateMergedOnuSyncRuntime({
    runId: "renew-active-run",
    workerId: "cleanup-worker",
    status: "success",
    phase: "complete",
    checkpoint: { status: "complete", cursor: null, updatedAt: "2026-08-19T00:07:01.000Z" },
    leaseUntil: "",
    now: "2026-08-19T00:07:01.000Z"
  });
  assert.equal(cleanup.updated, true);
});

test("lease renewal refuses terminal runs", async () => {
  await db.beginMergedOnuSyncRun({
    runId: "renew-terminal-run",
    operation: "merge",
    idempotencyKey: "renew-terminal-idem",
    workerId: "terminal-worker",
    startedAt: "2026-08-19T00:08:00.000Z",
    leaseMs: 60_000
  });
  const completed = await db.updateMergedOnuSyncRuntime({
    runId: "renew-terminal-run",
    workerId: "terminal-worker",
    status: "success",
    phase: "complete",
    checkpoint: { status: "complete", cursor: null, updatedAt: "2026-08-19T00:08:10.000Z" },
    leaseUntil: "",
    now: "2026-08-19T00:08:10.000Z"
  });
  assert.equal(completed.updated, true);

  const renewed = await db.renewMergedOnuSyncLease({
    runId: "renew-terminal-run",
    workerId: "terminal-worker",
    now: "2026-08-19T00:08:20.000Z",
    leaseMs: 60_000
  });
  assert.equal(renewed.renewed, false);
  assert.equal(renewed.run.status, "success");
  assert.equal(renewed.run.leaseUntil, "");
});

test("persists a sanitized source manifest and exposes recoverable runs", async () => {
  const manifest = createSourceManifest({
    source: "network",
    sourceKind: "network-full-snapshot",
    scope: { kind: "target-olts" },
    collectionStartedAt: baseTime,
    collectionCompletedAt: "2026-08-19T00:01:00.000Z",
    windowStart: baseTime,
    windowEnd: "2026-08-19T00:01:00.000Z",
    sourceRevision: "source-revision-1",
    targetOltIds: ["olt-1"],
    rowCount: 1,
    status: "complete",
    runId: "recovery-run-1",
    idempotencyKey: "recovery-idem-1",
    password: "must-not-persist"
  });
  const persisted = await db.persistMergedOnuManifest({ runId: "recovery-run-1", manifest });
  const loaded = await db.getMergedOnuSyncManifest({ runId: "recovery-run-1", manifestType: "source", source: "network" });
  const recoverable = await db.listRecoverableMergedOnuSyncRuns();

  assert.equal(persisted.source, "network");
  assert.equal(loaded.sourceRevision, "source-revision-1");
  assert.equal(Object.hasOwn(loaded, "password"), false);
  assert.equal(recoverable.length, 1);
  assert.equal(recoverable[0].runId, "recovery-run-1");
});

test("completed runs leave the recovery list", async () => {
  const result = await db.updateMergedOnuSyncRuntime({
    runId: "recovery-run-1",
    workerId: "worker-2",
    status: "success",
    phase: "completed",
    checkpoint: { status: "complete", cursor: "merge-done", updatedAt: "2026-08-19T00:02:10.000Z" },
    now: "2026-08-19T00:02:10.000Z"
  });
  assert.equal(result.updated, true);
  assert.deepEqual(await db.listRecoverableMergedOnuSyncRuns(), []);
});

test("begin atomically permits only one globally active lease across different run IDs", async () => {
  const candidates = [
    {
      runId: "global-lease-run-a",
      operation: "network",
      idempotencyKey: "global-lease-idem-a",
      workerId: "global-worker-a"
    },
    {
      runId: "global-lease-run-b",
      operation: "nmse",
      idempotencyKey: "global-lease-idem-b",
      workerId: "global-worker-b"
    }
  ];
  const results = await Promise.all(candidates.map((candidate) => db.beginMergedOnuSyncRun({
    ...candidate,
    startedAt: "2026-08-20T00:00:00.000Z",
    leaseMs: 60_000
  })));
  const accepted = results.filter((result) => result.accepted);
  const rejected = results.filter((result) => !result.accepted);

  assert.equal(accepted.length, 1, "only one transaction may acquire the global running lease");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].duplicate, false, "different run IDs and idempotency keys are a lease conflict, not a duplicate");
  assert.equal(rejected[0].reason, "active_lease");
  assert.equal(rejected[0].run.runId, accepted[0].run.runId);
  assert.equal(rejected[0].run.workerId, accepted[0].run.workerId);

  const winner = accepted[0].run;
  const completed = await db.updateMergedOnuSyncRuntime({
    runId: winner.runId,
    workerId: winner.workerId,
    status: "success",
    phase: "complete",
    checkpoint: { status: "complete", cursor: null, updatedAt: "2026-08-20T00:00:10.000Z" },
    leaseUntil: "",
    now: "2026-08-20T00:00:10.000Z"
  });
  assert.equal(completed.updated, true);

  const afterCompletion = await db.beginMergedOnuSyncRun({
    runId: "global-lease-run-after",
    operation: "merge",
    idempotencyKey: "global-lease-idem-after",
    workerId: "global-worker-after",
    startedAt: "2026-08-20T00:00:20.000Z",
    leaseMs: 60_000
  });
  assert.equal(afterCompletion.accepted, true, "a terminal predecessor must release the global slot");
  const afterCleanup = await db.updateMergedOnuSyncRuntime({
    runId: afterCompletion.run.runId,
    workerId: afterCompletion.run.workerId,
    status: "success",
    phase: "complete",
    checkpoint: { status: "complete", cursor: null, updatedAt: "2026-08-20T00:00:30.000Z" },
    leaseUntil: "",
    now: "2026-08-20T00:00:30.000Z"
  });
  assert.equal(afterCleanup.updated, true);
});

test("an expired source run can be reclaimed and replay its success audit with the same run ID", async () => {
  const begun = await db.beginMergedOnuSyncRun({
    runId: "source-audit-replay-run",
    operation: "network",
    idempotencyKey: "source-audit-replay-idem",
    workerId: "source-worker-old",
    startedAt: "2026-08-21T00:00:00.000Z",
    leaseMs: 60_000
  });
  assert.equal(begun.accepted, true);
  const auditInput = {
    runId: begun.run.runId,
    operation: "network",
    networkCount: 7,
    nmseCount: 0,
    backup: { path: "/safe/source-before.sqlite", bytes: 12, sha256: "source-sha" },
    startedAt: "2026-08-21T00:00:00.000Z",
    completedAt: "2026-08-21T00:00:30.000Z"
  };
  const firstAudit = await db.recordMergedOnuSourceSyncSuccess(auditInput);
  assert.deepEqual(firstAudit, { runId: begun.run.runId, operation: "network", status: "success" });

  const reclaimed = await db.claimMergedOnuSyncLease({
    runId: begun.run.runId,
    workerId: "source-worker-new",
    now: "2026-08-21T00:02:00.000Z",
    leaseMs: 60_000
  });
  assert.equal(reclaimed.claimed, true);
  const replayedAudit = await db.recordMergedOnuSourceSyncSuccess(auditInput);
  assert.deepEqual(replayedAudit, firstAudit);
  const auditRows = (await db.getMergedOnuSyncRuns({ limit: 200 })).filter((run) => run.id === begun.run.runId);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].status, "success");
  assert.equal(auditRows[0].networkCount, 7);

  const completed = await db.updateMergedOnuSyncRuntime({
    runId: begun.run.runId,
    workerId: "source-worker-new",
    status: "success",
    phase: "complete",
    checkpoint: { status: "complete", cursor: null, updatedAt: "2026-08-21T00:02:10.000Z" },
    leaseUntil: "",
    now: "2026-08-21T00:02:10.000Z"
  });
  assert.equal(completed.updated, true);
});

test("an expired merged run can replay its committed dataset with the same run ID", async () => {
  const begun = await db.beginMergedOnuSyncRun({
    runId: "dataset-replay-run",
    operation: "merge",
    idempotencyKey: "dataset-replay-idem",
    workerId: "dataset-worker-old",
    startedAt: "2026-08-22T00:00:00.000Z",
    leaseMs: 60_000
  });
  assert.equal(begun.accepted, true);
  const commitInput = {
    runId: begun.run.runId,
    operation: "merge",
    rows: [],
    conflicts: [],
    networkCount: 0,
    nmseCount: 0,
    backup: { path: "/safe/dataset-before.sqlite", bytes: 14, sha256: "dataset-sha" },
    startedAt: "2026-08-22T00:00:00.000Z",
    completedAt: "2026-08-22T00:00:30.000Z"
  };
  const firstCommit = await db.replaceMergedOnuDataset(commitInput);

  const reclaimed = await db.claimMergedOnuSyncLease({
    runId: begun.run.runId,
    workerId: "dataset-worker-new",
    now: "2026-08-22T00:02:00.000Z",
    leaseMs: 60_000
  });
  assert.equal(reclaimed.claimed, true);
  const replayedCommit = await db.replaceMergedOnuDataset(commitInput);
  assert.equal(replayedCommit.runId, firstCommit.runId);
  assert.equal(replayedCommit.revision, firstCommit.revision, "an idempotent replay must not create another dataset revision");
  const auditRows = (await db.getMergedOnuSyncRuns({ limit: 200 })).filter((run) => run.id === begun.run.runId);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].status, "success");

  const completed = await db.updateMergedOnuSyncRuntime({
    runId: begun.run.runId,
    workerId: "dataset-worker-new",
    status: "success",
    phase: "complete",
    checkpoint: { status: "complete", cursor: null, updatedAt: "2026-08-22T00:02:10.000Z" },
    leaseUntil: "",
    now: "2026-08-22T00:02:10.000Z"
  });
  assert.equal(completed.updated, true);
});
