import { createSourceManifest } from "./merged-onu-manifest.mjs";

export function isLeaseActive(run, now = Date.now()) {
  const leaseUntil = Date.parse(String(run?.leaseUntil || ""));
  return Number.isFinite(leaseUntil) && leaseUntil > now;
}

export function publicMergedOnuRecoveryRun(run, now = Date.now()) {
  if (!run) return null;
  const checkpointStatus = String(run.checkpoint?.status || "not_started");
  return {
    runId: String(run.runId || ""),
    operation: String(run.operation || ""),
    status: String(run.status || ""),
    phase: String(run.phase || ""),
    checkpointStatus,
    leaseUntil: String(run.leaseUntil || ""),
    leaseActive: isLeaseActive(run, now),
    startedAt: String(run.startedAt || ""),
    updatedAt: String(run.updatedAt || ""),
    recoveryAction: checkpointStatus === "complete"
      ? "resume-from-stage-boundary"
      : "manual-retry-from-stage-boundary"
  };
}

export function publicMergedOnuRecoveryState(state = {}, now = Date.now()) {
  return {
    inspectedAt: String(state.inspectedAt || ""),
    runs: Array.isArray(state.runs)
      ? state.runs.map((run) => ({ ...run, leaseActive: isLeaseActive(run, now) }))
      : []
  };
}

export function snapshotWindowFor(startedAt) {
  const day = String(startedAt || "").slice(0, 10);
  return {
    windowStart: `${day}T00:00:00.000Z`,
    windowEnd: `${day}T23:59:59.999Z`
  };
}

export function buildSourceManifest({
  source,
  runId,
  idempotencyKey = "",
  startedAt,
  completedAt,
  targetOltIds,
  sourceRevision,
  rowCount,
  windowStart,
  windowEnd
}) {
  const snapshotWindow = snapshotWindowFor(startedAt);
  return createSourceManifest({
    source,
    collectionStartedAt: startedAt,
    collectionCompletedAt: completedAt,
    windowStart: windowStart || snapshotWindow.windowStart,
    windowEnd: windowEnd || snapshotWindow.windowEnd,
    sourceRevision,
    targetOltIds,
    rowCount,
    status: "complete",
    runId,
    idempotencyKey,
    checkpoint: { status: "complete", cursor: null, updatedAt: completedAt }
  });
}
