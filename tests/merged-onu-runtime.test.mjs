import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSourceManifest,
  isLeaseActive,
  publicMergedOnuRecoveryRun,
  publicMergedOnuRecoveryState,
  snapshotWindowFor
} from "../src/merged-onu-runtime.mjs";

const now = Date.parse("2026-08-19T00:05:00.000Z");

test("lease projection uses the supplied clock and expires at the boundary", () => {
  const run = { leaseUntil: "2026-08-19T00:05:00.000Z" };
  assert.equal(isLeaseActive(run, now - 1), true);
  assert.equal(isLeaseActive(run, now), false);
  assert.equal(isLeaseActive({ leaseUntil: "not-a-date" }, now), false);
});

test("public recovery projection contains only stable recovery fields", () => {
  const run = {
    runId: "run-1",
    operation: "network",
    status: "running",
    phase: "reading",
    checkpoint: { status: "complete", cursor: "network-source" },
    leaseUntil: "2026-08-19T00:10:00.000Z",
    startedAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:04:00.000Z",
    password: "must-not-project"
  };
  assert.deepEqual(publicMergedOnuRecoveryRun(run, now), {
    runId: "run-1",
    operation: "network",
    status: "running",
    phase: "reading",
    checkpointStatus: "complete",
    leaseUntil: "2026-08-19T00:10:00.000Z",
    leaseActive: true,
    startedAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:04:00.000Z",
    recoveryAction: "resume-from-stage-boundary"
  });
});

test("recovery state projection clones and recalculates lease status", () => {
  const state = {
    inspectedAt: "2026-08-19T00:04:00.000Z",
    runs: [{ runId: "run-1", leaseUntil: "2026-08-19T00:10:00.000Z" }]
  };
  const projected = publicMergedOnuRecoveryState(state, now);
  assert.deepEqual(projected, {
    inspectedAt: state.inspectedAt,
    runs: [{ runId: "run-1", leaseUntil: "2026-08-19T00:10:00.000Z", leaseActive: true }]
  });
  assert.notEqual(projected.runs, state.runs);
});

test("source manifests default to the UTC snapshot day window", () => {
  assert.deepEqual(snapshotWindowFor("2026-08-19T12:34:56.000Z"), {
    windowStart: "2026-08-19T00:00:00.000Z",
    windowEnd: "2026-08-19T23:59:59.999Z"
  });
  const manifest = buildSourceManifest({
    source: "network",
    runId: "run-1",
    startedAt: "2026-08-19T12:34:56.000Z",
    completedAt: "2026-08-19T12:35:00.000Z",
    targetOltIds: ["olt-1"],
    sourceRevision: "revision-1",
    rowCount: 1
  });
  assert.equal(manifest.windowStart, "2026-08-19T00:00:00.000Z");
  assert.equal(manifest.windowEnd, "2026-08-19T23:59:59.999Z");
  assert.equal(Object.hasOwn(manifest, "password"), false);
});
