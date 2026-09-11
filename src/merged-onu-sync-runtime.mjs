import { randomUUID } from "node:crypto";
import {
  buildSourceManifest,
  isLeaseActive,
  publicMergedOnuRecoveryRun,
  publicMergedOnuRecoveryState
} from "./merged-onu-runtime.mjs";
import { createMergedInputManifest } from "./merged-onu-manifest.mjs";

function syncError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicBackup(backup) {
  return {
    name: String(backup?.path || "").split(/[\\/]/).pop() || "",
    bytes: Number(backup?.bytes || 0),
    sha256: String(backup?.sha256 || "")
  };
}

function syncErrorMessage(error, operation = "full") {
  const message = String(error?.message || "").trim();
  const system = operation === "network" ? "网管二期" : operation === "nmse" ? "NMSE-PON" : "合并 ONU";
  if (/SESSION_RECOVERY_(?:FAILED|EXHAUSTED)$/.test(String(error?.code || ""))) return message;
  if (error?.status === 401 || /(登录|会话|令牌|token|unauthori|forbidden|401|403)/i.test(message)) {
    return operation === "network"
      ? "网管二期登录会话已失效，请重新登录网管二期后再同步。"
      : "NMSE-PON 登录会话已失效，请重新登录资源管理系统后再同步。";
  }
  if (/超时/.test(message)) return `${system}请求超时：${message}`;
  if (/连接失败|连接/.test(message)) return `${system}连接失败：${message}`;
  if (error?.status === 404 || error?.status === 409) return message || `${system}同步失败。`;
  return message || `${system}同步失败，请检查登录状态、IP 映射和只读数据。`;
}

export function createMergedOnuSyncRuntime({
  state,
  recoveryState,
  workerId = `merged-onu-${process.pid}-${randomUUID().slice(0, 12)}`,
  leaseMs = 30 * 60 * 1000,
  leaseHeartbeatMs = 0,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  remoteSessionState,
  mergedOnuService,
  getOlts,
  getResourceOltIpMappings,
  activeOssNgbSession,
  ensureOssNgbSession = null,
  runNmseBossIncremental = null,
  backupDatabaseBeforeSync,
  listRecoverableMergedOnuSyncRuns,
  beginMergedOnuSyncRun,
  claimMergedOnuSyncLease,
  renewMergedOnuSyncLease,
  updateMergedOnuSyncRuntime,
  getLatestMergedOnuSourceManifest,
  getMergedOnuSourceStatus,
  getMergedOnuDatasetStatus,
  getMergedOnuSyncRuns,
  getMergedOnuNetworkSource,
  getMergedOnuNmseSource,
  replaceMergedOnuNetworkSource,
  persistMergedOnuManifest,
  recordMergedOnuSourceSyncSuccess,
  recordMergedOnuSyncFailure,
  syncMergedOnuDataset
} = {}) {
  if (!state || !recoveryState) throw new TypeError("合并 ONU 同步运行时需要注入状态容器。");
  const required = {
    remoteSessionState,
    mergedOnuService,
    getOlts,
    getResourceOltIpMappings,
    activeOssNgbSession,
    backupDatabaseBeforeSync,
    listRecoverableMergedOnuSyncRuns,
    beginMergedOnuSyncRun,
    claimMergedOnuSyncLease,
    renewMergedOnuSyncLease,
    updateMergedOnuSyncRuntime,
    getLatestMergedOnuSourceManifest,
    getMergedOnuSourceStatus,
    getMergedOnuDatasetStatus,
    getMergedOnuSyncRuns,
    getMergedOnuNetworkSource,
    getMergedOnuNmseSource,
    replaceMergedOnuNetworkSource,
    runNmseBossIncremental,
    persistMergedOnuManifest,
    recordMergedOnuSourceSyncSuccess,
    recordMergedOnuSyncFailure,
    syncMergedOnuDataset
  };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== "function" && name !== "remoteSessionState" && name !== "mergedOnuService") {
      throw new TypeError(`合并 ONU 同步运行时缺少依赖：${name}。`);
    }
  }
  if (typeof setIntervalFn !== "function" || typeof clearIntervalFn !== "function") {
    throw new TypeError("合并 ONU 同步运行时需要有效的租约心跳定时器。");
  }

  const normalizedLeaseMs = Math.max(1, Number(leaseMs) || 1);
  const maximumHeartbeatMs = Math.max(1, Math.floor(normalizedLeaseMs / 3));
  const heartbeatMs = Math.min(
    maximumHeartbeatMs,
    Math.max(1, Number(leaseHeartbeatMs) || Math.min(60_000, maximumHeartbeatMs))
  );

  const setState = (next = {}) => Object.assign(state, next);
  const applyBossProgress = (progress = {}) => setState({
    phase: progress.mode === "history" ? "fetching-nmse-history" : "fetching-nmse",
    nmseTotal: Number(progress.total || progress.eventCount || 0),
    nmsePages: Number(progress.pages || 0),
    nmseCompletedPages: Number(progress.completedPages || 0),
    nmseRows: progress.mode === "history"
      ? Number(progress.accumulatedRows || 0) + (progress.phase === "boss-details" ? Number(progress.details || 0) : 0)
      : progress.phase === "boss-details" ? Number(progress.details || 0) : Number(progress.received || 0),
    nmseWorkers: Number(progress.workers || 0),
    nmseAttempt: Number(progress.attempt || 0),
    nmseChunkIndex: Number(progress.chunkIndex || 0),
    nmseChunkCount: Number(progress.chunkCount || 0),
    nmseCompletedChunks: Number(progress.completedChunks || 0),
    nmseHistoryStart: String(progress.historyStart || ""),
    nmseHistoryEnd: String(progress.historyEnd || ""),
    nmseHistorySkipped: Number(progress.skippedCount || 0),
    nmseHistoryConflicts: Number(progress.conflictCount || 0)
  });

  async function refreshRecoveryState() {
    const runs = await listRecoverableMergedOnuSyncRuns();
    recoveryState.inspectedAt = new Date().toISOString();
    recoveryState.runs = runs.map(publicMergedOnuRecoveryRun);
    return runs;
  }

  async function replayOrRejectDuplicate(begun, operation) {
    const existingRun = begun.existingRun;
    if (!existingRun || existingRun.operation !== operation || existingRun.status !== "success") {
      const error = syncError("相同幂等 key 对应的同步任务尚未成功完成，不能伪装为成功重放。", 409);
      error.code = "MERGED_ONU_SYNC_DUPLICATE_NOT_REPLAYABLE";
      throw error;
    }
    const [record, datasetStatus] = await Promise.all([
      getMergedOnuSyncRuns({ limit: 200 }).then((runs) => runs.find((run) => (run.id || run.runId) === existingRun.runId && run.status === "success")),
      getMergedOnuDatasetStatus()
    ]);
    if (!record) {
      const error = syncError("幂等任务已标记成功，但缺少可重放结果记录。", 409);
      error.code = "MERGED_ONU_SYNC_DUPLICATE_RESULT_MISSING";
      throw error;
    }
    const backup = publicBackup({ path: record.backupPath, bytes: record.backupBytes, sha256: record.backupSha256 });
    const common = { duplicate: true, replayed: true, operation, runId: existingRun.runId, recovered: false, recovery: null, backup };
    if (operation === "network" || operation === "nmse") {
      return { ...common, count: operation === "network" ? record.networkCount : record.nmseCount, source: datasetStatus?.sources?.[operation] || { revision: "" } };
    }
    return {
      ...common,
      revision: datasetStatus?.revision || "",
      networkCount: record.networkCount,
      nmseCount: record.nmseCount,
      mergedCount: record.mergedCount,
      conflictCount: record.conflictCount,
      conflicts: []
    };
  }

  function recoveryLeaseConflict(run, message = "合并 ONU 同步已有其他 worker 持有有效租约。") {
    const error = syncError(message, 409);
    error.code = "MERGED_ONU_SYNC_LEASE_ACTIVE";
    error.recovery = publicMergedOnuRecoveryRun(run);
    return error;
  }

  function lostLease(run, message = "合并 ONU 同步租约已失效，请重新发起同步。") {
    const error = syncError(message, 409);
    error.code = "MERGED_ONU_SYNC_LEASE_LOST";
    error.recovery = publicMergedOnuRecoveryRun(run);
    return error;
  }

  function startLeaseHeartbeat(runId) {
    let stopped = false;
    let pending = null;
    let failure = null;
    const renew = () => {
      if (stopped || failure) return pending || Promise.resolve();
      if (pending) return pending;
      const current = new Date().toISOString();
      pending = Promise.resolve()
        .then(() => renewMergedOnuSyncLease({ runId, workerId, leaseMs: normalizedLeaseMs, now: current }))
        .then((durable) => {
          if (!durable?.renewed) throw lostLease(durable?.run);
          recoveryState.inspectedAt = current;
          recoveryState.runs = recoveryState.runs.map((run) => run.runId === runId ? publicMergedOnuRecoveryRun(durable.run) : run);
        })
        .catch((error) => {
          failure = error instanceof Error ? error : lostLease(null);
        })
        .finally(() => { pending = null; });
      return pending;
    };
    const timer = setIntervalFn(() => { void renew(); }, heartbeatMs);
    timer?.unref?.();
    return {
      async assertHealthy() {
        if (stopped) throw lostLease(null, "合并 ONU 同步租约心跳已停止，拒绝继续提交。");
        await renew();
        if (failure) throw failure;
      },
      async stop({ ignoreError = false } = {}) {
        if (!stopped) {
          stopped = true;
          clearIntervalFn(timer);
        }
        if (pending) await pending;
        if (failure && !ignoreError) throw failure;
      }
    };
  }

  async function completeWithHeartbeat(heartbeat, input) {
    await heartbeat.assertHealthy();
    await heartbeat.stop();
    return complete(input);
  }

  async function updatePhase({ runId, phase, checkpoint = null, now = "" }) {
    const current = now || new Date().toISOString();
    const durable = await updateMergedOnuSyncRuntime({
      runId,
      workerId,
      status: "running",
      phase,
      checkpoint: checkpoint || { status: "running", cursor: null, updatedAt: current },
      leaseUntil: new Date(Date.parse(current) + normalizedLeaseMs).toISOString(),
      now: current
    });
    if (!durable.updated) throw lostLease(durable.run);
    await refreshRecoveryState();
    return durable.run;
  }

  async function buildInputManifest({ runId, idempotencyKey = "", networkRows, nmseRows } = {}) {
    const [network, nmse] = await Promise.all([
      getLatestMergedOnuSourceManifest("network"),
      getLatestMergedOnuSourceManifest("nmse")
    ]);
    if (!network || !nmse) {
      const error = syncError("缺少完整的 network 或 nmse source manifest，不能执行合并。", 409);
      error.code = "MERGED_ONU_SOURCE_MANIFEST_REQUIRED";
      throw error;
    }
    const sourceStatus = await getMergedOnuSourceStatus();
    const mismatches = [];
    if (network.sourceRevision !== sourceStatus.network.revision) mismatches.push("network revision");
    if (nmse.sourceRevision !== sourceStatus.nmse.revision) mismatches.push("nmse revision");
    if (Number(network.rowCount) !== networkRows.length) mismatches.push("network rowCount");
    if (Number(nmse.rowCount) !== nmseRows.length) mismatches.push("nmse rowCount");
    if (mismatches.length) {
      const error = syncError(`源 manifest 与当前源快照不一致：${mismatches.join(", ")}。`, 409);
      error.code = "MERGED_ONU_SOURCE_MANIFEST_MISMATCH";
      throw error;
    }
    try {
      return createMergedInputManifest({ network, nmse, runId, idempotencyKey });
    } catch (error) {
      error.status = error.status || 409;
      throw error;
    }
  }

  async function begin(operation, phase = "backing-up", { idempotencyKey = "" } = {}) {
    if (state.running) throw syncError("合并 ONU 同步正在执行。", 409);
    const recoverable = await refreshRecoveryState();
    const active = recoverable.find((run) => isLeaseActive(run));
    if (active) throw recoveryLeaseConflict(active);

    const startedAt = new Date().toISOString();
    const expiredSameOperation = recoverable.find((run) => run.operation === operation);
    if (expiredSameOperation) {
      const claimed = await claimMergedOnuSyncLease({
        runId: expiredSameOperation.runId,
        workerId,
        leaseMs: normalizedLeaseMs,
        now: startedAt
      });
      if (!claimed.claimed) throw recoveryLeaseConflict(claimed.run || expiredSameOperation, "合并 ONU 同步恢复租约竞争失败，请稍后重试。");
      const recoveredRun = claimed.run || expiredSameOperation;
      setState({
        running: true, operation, status: "running", phase,
        totalOlts: 0, completedOlts: 0, networkRows: 0, nmseRows: 0,
        nmseTotal: 0, nmsePages: 0, nmseCompletedPages: 0, nmseWorkers: 0,
        nmseAttempt: 0, nmseChunkIndex: 0, nmseChunkCount: 0, nmseCompletedChunks: 0,
        nmseHistoryStart: "", nmseHistoryEnd: "", nmseHistorySkipped: 0, nmseHistoryConflicts: 0,
        mergedRows: 0, conflicts: 0, error: "",
        startedAt: recoveredRun.startedAt || startedAt, completedAt: "", revision: ""
      });
      await refreshRecoveryState();
      return {
        startedAt: recoveredRun.startedAt || startedAt,
        runId: recoveredRun.runId,
        recovered: true,
        recovery: publicMergedOnuRecoveryRun(expiredSameOperation)
      };
    }

    const expiredOtherOperation = recoverable.find((run) => !isLeaseActive(run));
    if (expiredOtherOperation) {
      const error = syncError("存在已过期但未完成的其他合并 ONU 任务，请按原操作人工重试后再发起新同步。", 409);
      error.code = "MERGED_ONU_SYNC_RECOVERY_REQUIRED";
      error.recovery = publicMergedOnuRecoveryRun(expiredOtherOperation);
      throw error;
    }

    const runId = `merged-onu-${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`;
    const durable = await beginMergedOnuSyncRun({ runId, operation, phase, startedAt, idempotencyKey, workerId, leaseMs: normalizedLeaseMs });
    if (!durable.accepted && durable.reason === "active_lease") {
      throw recoveryLeaseConflict(durable.run);
    }
    if (durable.duplicate) {
      const existingRun = durable.run || durable.existingRun || null;
      return { duplicate: true, runId: existingRun?.runId || durable.runId || runId, existingRun };
    }
    setState({
      running: true, operation, status: "running", phase,
      totalOlts: 0, completedOlts: 0, networkRows: 0, nmseRows: 0,
      nmseTotal: 0, nmsePages: 0, nmseCompletedPages: 0, nmseWorkers: 0,
      nmseAttempt: 0, nmseChunkIndex: 0, nmseChunkCount: 0, nmseCompletedChunks: 0,
      nmseHistoryStart: "", nmseHistoryEnd: "", nmseHistorySkipped: 0, nmseHistoryConflicts: 0,
      mergedRows: 0, conflicts: 0, error: "",
      startedAt, completedAt: "", revision: ""
    });
    await refreshRecoveryState();
    return { startedAt, runId };
  }

  async function readNetworkRows(targets) {
    let ossSession = typeof ensureOssNgbSession === "function"
      ? await ensureOssNgbSession()
      : activeOssNgbSession();
    const networkRows = [];
    for (const [targetIndex, { target, mapping }] of targets.entries()) {
      let rows;
      let retried = false;
      while (true) {
        const remote = ossSession.olts.find((item) => item.resourceIp === mapping.resourceIp);
        if (!remote?.cuid) throw syncError(`网管二期会话未发现 OLT ${target.id} 的对应资源。`, 404);
        try {
          rows = await ossSession.client.readOnuInventory(remote.cuid);
          break;
        } catch (error) {
          if (error?.status !== 401 || typeof ensureOssNgbSession !== "function") throw error;
          if (retried) {
            const exhausted = syncError("网管二期会话自动恢复后再次失效，请检查已保存凭据或上游登录状态。", 401);
            exhausted.code = "OSS_SESSION_RECOVERY_EXHAUSTED";
            throw exhausted;
          }
          retried = true;
          setState({ phase: "recovering-network-session" });
          remoteSessionState.clearOssNgbSession();
          try {
            ossSession = await ensureOssNgbSession();
          } catch (reloginError) {
            const recoveryError = syncError(`网管二期会话失效且自动重新登录失败：${reloginError?.message || "登录失败。"}`, reloginError?.status || 401);
            recoveryError.code = "OSS_SESSION_RECOVERY_FAILED";
            throw recoveryError;
          }
          setState({ phase: "fetching-network" });
        }
      }
      networkRows.push(...rows.map((row) => ({ ...row, oltIp: target.host })));
      setState({ completedOlts: targetIndex + 1, networkRows: networkRows.length });
    }
    return networkRows;
  }

  async function complete({ runId, operation, backup, networkCount, nmseCount, mergedCount = 0, conflictCount = 0, revision = "" }) {
    const completedAt = new Date().toISOString();
    const durable = await updateMergedOnuSyncRuntime({
      runId, workerId, status: "success", phase: "complete",
      checkpoint: { status: "complete", cursor: null, updatedAt: completedAt },
      leaseUntil: "", now: completedAt
    });
    if (!durable.updated) throw syncError("合并 ONU 同步租约已失效，拒绝确认完成。", 409);
    await refreshRecoveryState();
    setState({ running: false, status: "success", phase: "complete", networkRows: networkCount, nmseRows: nmseCount, mergedRows: mergedCount, conflicts: conflictCount, error: "", completedAt, revision });
    return { operation, backup: publicBackup(backup), completedAt };
  }

  async function fail({ runId, operation, startedAt, backup, networkCount = 0, nmseCount = 0, error }) {
    const message = syncErrorMessage(error, operation);
    if (error?.status === 401) {
      remoteSessionState.clearNmseSession();
      remoteSessionState.clearOssNgbSession();
    }
    if (runId) {
      try {
        await updateMergedOnuSyncRuntime({
          runId, workerId, status: "failed", phase: "failed",
          checkpoint: { status: "failed", cursor: null, updatedAt: new Date().toISOString() },
          leaseUntil: "", error: message
        });
      } catch {
        // Preserve the original operation error if recovery-state persistence fails.
      }
    }
    await refreshRecoveryState();
    setState({ running: false, status: "failed", phase: "failed", error: message, completedAt: new Date().toISOString() });
    if (backup) {
      try {
        await recordMergedOnuSyncFailure({ runId: `failed-${randomUUID()}`, operation, networkCount, nmseCount, backup, error: message, startedAt, completedAt: new Date().toISOString() });
      } catch {
        // Keep the original sync failure visible if audit persistence also fails.
      }
    }
    throw error;
  }

  async function runSourceSync(operation, { idempotencyKey = "" } = {}) {
    const begun = await begin(operation, "backing-up", { idempotencyKey });
    if (begun.duplicate) return replayOrRejectDuplicate(begun, operation);
    const { startedAt, runId, recovered = false, recovery = null } = begun;
    let backup;
    let networkRowCount = 0;
    let nmseRowCount = 0;
    let heartbeat = null;
    try {
      heartbeat = startLeaseHeartbeat(runId);
      backup = await backupDatabaseBeforeSync({ reason: `merged-onu-${operation}-sync` });
      await updatePhase({ runId, phase: operation === "network" ? "collecting-network" : "collecting-nmse" });
      const olts = await getOlts();
      const targets = operation === "network"
        ? mergedOnuService.selectMergedOnuTargets(olts, await getResourceOltIpMappings())
        : mergedOnuService.selectMergedNmseTargets(olts);
      setState({ totalOlts: targets.length, phase: operation === "network" ? "fetching-network" : "fetching-nmse" });
      if (operation === "network") {
        const rows = await readNetworkRows(targets);
        networkRowCount = rows.length;
        await heartbeat.assertHealthy();
        const stored = await replaceMergedOnuNetworkSource({ rows });
        const completedAt = new Date().toISOString();
        const sourceManifest = buildSourceManifest({ source: "network", runId, idempotencyKey, startedAt, completedAt, targetOltIds: targets.map(({ target }) => target.id), sourceRevision: stored.source.revision, rowCount: rows.length });
        await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "network-source", updatedAt: completedAt }, now: completedAt });
        await persistMergedOnuManifest({ runId, manifest: sourceManifest });
        await recordMergedOnuSourceSyncSuccess({ runId, operation, networkCount: rows.length, nmseCount: 0, backup, startedAt, completedAt });
        return { ...stored, ...(await completeWithHeartbeat(heartbeat, { runId, operation, backup, networkCount: rows.length, nmseCount: 0 })), recovered, recovery };
      }
      await runNmseBossIncremental({
        manifestContext: { runId, startedAt, idempotencyKey, targetOltIds: targets.map(({ target }) => target.id), windowStart: "", windowEnd: "" },
        onProgress: applyBossProgress,
        beforeCommit: () => heartbeat.assertHealthy()
      });
      const rows = await getMergedOnuNmseSource();
      nmseRowCount = rows.length;
      const stored = { count: rows.length, source: (await getMergedOnuSourceStatus()).nmse };
      const completedAt = new Date().toISOString();
      await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "nmse-source", updatedAt: completedAt }, now: completedAt });
      await recordMergedOnuSourceSyncSuccess({ runId, operation, networkCount: 0, nmseCount: rows.length, backup, startedAt, completedAt });
      return { ...stored, ...(await completeWithHeartbeat(heartbeat, { runId, operation, backup, networkCount: 0, nmseCount: rows.length })), recovered, recovery };
    } catch (error) {
      await heartbeat?.stop({ ignoreError: true });
      return fail({ runId, operation, startedAt, backup, networkCount: networkRowCount, nmseCount: nmseRowCount, error });
    }
  }

  async function runManualMerge({ idempotencyKey = "" } = {}) {
    const operation = "merge";
    const begun = await begin(operation, "starting", { idempotencyKey });
    if (begun.duplicate) return replayOrRejectDuplicate(begun, operation);
    const { startedAt, runId, recovered = false, recovery = null } = begun;
    let backup;
    let heartbeat = null;
    try {
      heartbeat = startLeaseHeartbeat(runId);
      backup = await backupDatabaseBeforeSync({ reason: "merged-onu-manual-merge" });
      const sourceStatus = await getMergedOnuSourceStatus();
      if (!sourceStatus.network.synced || !sourceStatus.nmse.synced) throw syncError("请先分别完成网管二期和 NMSE-PON 源数据同步，再执行手动合并。", 409);
      const networkRows = await getMergedOnuNetworkSource();
      const nmseRows = await getMergedOnuNmseSource();
      const now = new Date().toISOString();
      await updatePhase({ runId, phase: "merging", checkpoint: { status: "complete", cursor: "sources-ready", updatedAt: now }, now });
      const manifest = await buildInputManifest({ runId, networkRows, nmseRows, idempotencyKey });
      setState({ phase: "merging", networkRows: networkRows.length, nmseRows: nmseRows.length });
      await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "sources-ready", updatedAt: new Date().toISOString() } });
      await heartbeat.assertHealthy();
      const result = await syncMergedOnuDataset({ operation, networkRows, nmseRows, backup, manifest, workerId, runAlreadyClaimed: true, manageRuntime: false });
      return { ...result, ...(await completeWithHeartbeat(heartbeat, { runId, operation, backup, networkCount: result.networkCount, nmseCount: result.nmseCount, mergedCount: result.mergedCount, conflictCount: result.conflictCount, revision: result.revision })), recovered, recovery };
    } catch (error) {
      await heartbeat?.stop({ ignoreError: true });
      return fail({ runId, operation, startedAt, backup, error });
    }
  }

  async function runFullSync({ idempotencyKey = "" } = {}) {
    const operation = "full";
    const begun = await begin(operation, "starting", { idempotencyKey });
    if (begun.duplicate) return replayOrRejectDuplicate(begun, operation);
    const { startedAt, runId, recovered = false, recovery = null } = begun;
    let backup;
    let networkRowCount = 0;
    let nmseRowCount = 0;
    let heartbeat = null;
    try {
      heartbeat = startLeaseHeartbeat(runId);
      backup = await backupDatabaseBeforeSync({ reason: "merged-onu-sync" });
      const olts = await getOlts();
      const targets = mergedOnuService.selectMergedOnuTargets(olts, await getResourceOltIpMappings());
      setState({ totalOlts: targets.length, phase: "fetching-network" });
      const networkRows = await readNetworkRows(targets);
      networkRowCount = networkRows.length;
      setState({ phase: "fetching-nmse", completedOlts: targets.length });
      await runNmseBossIncremental({
        manifestContext: { runId, startedAt, idempotencyKey, targetOltIds: targets.map(({ target }) => target.id), windowStart: "", windowEnd: "" },
        onProgress: applyBossProgress,
        beforeCommit: () => heartbeat.assertHealthy()
      });
      const nmseRows = await getMergedOnuNmseSource();
      nmseRowCount = nmseRows.length;
      await heartbeat.assertHealthy();
      const networkStored = await replaceMergedOnuNetworkSource({ rows: networkRows });
      const nmseStored = { count: nmseRows.length, source: (await getMergedOnuSourceStatus()).nmse };
      const sourceCompletedAt = new Date().toISOString();
      await persistMergedOnuManifest({ runId, manifest: buildSourceManifest({ source: "network", runId, startedAt, completedAt: sourceCompletedAt, targetOltIds: targets.map(({ target }) => target.id), sourceRevision: networkStored.source.revision, rowCount: networkRows.length }) });
      const manifest = await buildInputManifest({ runId, networkRows, nmseRows, idempotencyKey });
      await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "sources-ready", updatedAt: sourceCompletedAt }, now: sourceCompletedAt });
      setState({ phase: "merging" });
      await heartbeat.assertHealthy();
      const result = await syncMergedOnuDataset({ operation, networkRows, nmseRows, backup, manifest, workerId, runAlreadyClaimed: true, manageRuntime: false });
      return { ...result, ...(await completeWithHeartbeat(heartbeat, { runId, operation, backup, networkCount: result.networkCount, nmseCount: result.nmseCount, mergedCount: result.mergedCount, conflictCount: result.conflictCount, revision: result.revision })), recovered, recovery };
    } catch (error) {
      await heartbeat?.stop({ ignoreError: true });
      return fail({ runId, operation, startedAt, backup, networkCount: networkRowCount, nmseCount: nmseRowCount, error });
    }
  }

  return {
    publicSyncState: () => ({ ...state, recovery: publicMergedOnuRecoveryState(recoveryState) }),
    refreshRecoveryState,
    runSourceSync,
    runManualMerge,
    runFullSync,
    syncError,
    syncErrorMessage
  };
}
