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

test("persists a sanitized source manifest and exposes recoverable runs", async () => {
  const manifest = createSourceManifest({
    source: "network",
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
