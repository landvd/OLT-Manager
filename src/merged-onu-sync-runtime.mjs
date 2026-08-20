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
  remoteSessionState,
  mergedOnuService,
  resourceUserSync,
  getOlts,
  getResourceOltIpMappings,
  activeOssNgbSession,
  loginNmseSession,
  resourceGridRank,
  backupDatabaseBeforeSync,
  replaceResourceUsersBatch,
  listRecoverableMergedOnuSyncRuns,
  beginMergedOnuSyncRun,
  claimMergedOnuSyncLease,
  updateMergedOnuSyncRuntime,
  getLatestMergedOnuSourceManifest,
  getMergedOnuSourceStatus,
  getMergedOnuNetworkSource,
  getMergedOnuNmseSource,
  replaceMergedOnuNetworkSource,
  replaceMergedOnuNmseSource,
  persistMergedOnuManifest,
  recordMergedOnuSourceSyncSuccess,
  recordMergedOnuSyncFailure,
  syncMergedOnuDataset
} = {}) {
  if (!state || !recoveryState) throw new TypeError("合并 ONU 同步运行时需要注入状态容器。");
  const required = {
    remoteSessionState,
    mergedOnuService,
    resourceUserSync,
    getOlts,
    getResourceOltIpMappings,
    activeOssNgbSession,
    loginNmseSession,
    resourceGridRank,
    backupDatabaseBeforeSync,
    replaceResourceUsersBatch,
    listRecoverableMergedOnuSyncRuns,
    beginMergedOnuSyncRun,
    claimMergedOnuSyncLease,
    updateMergedOnuSyncRuntime,
    getLatestMergedOnuSourceManifest,
    getMergedOnuSourceStatus,
    getMergedOnuNetworkSource,
    getMergedOnuNmseSource,
    replaceMergedOnuNetworkSource,
    replaceMergedOnuNmseSource,
    persistMergedOnuManifest,
    recordMergedOnuSourceSyncSuccess,
    recordMergedOnuSyncFailure,
    syncMergedOnuDataset
  };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== "function" && name !== "remoteSessionState" && name !== "mergedOnuService" && name !== "resourceUserSync") {
      throw new TypeError(`合并 ONU 同步运行时缺少依赖：${name}。`);
    }
  }

  const setState = (next = {}) => Object.assign(state, next);

  async function refreshRecoveryState() {
    const runs = await listRecoverableMergedOnuSyncRuns();
    recoveryState.inspectedAt = new Date().toISOString();
    recoveryState.runs = runs.map(publicMergedOnuRecoveryRun);
    return runs;
  }

  function recoveryLeaseConflict(run, message = "合并 ONU 同步已有其他 worker 持有有效租约。") {
    const error = syncError(message, 409);
    error.code = "MERGED_ONU_SYNC_LEASE_ACTIVE";
    error.recovery = publicMergedOnuRecoveryRun(run);
    return error;
  }

  async function updatePhase({ runId, phase, checkpoint = null, now = "" }) {
    const current = now || new Date().toISOString();
    const durable = await updateMergedOnuSyncRuntime({
      runId,
      workerId,
      status: "running",
      phase,
      checkpoint: checkpoint || { status: "running", cursor: null, updatedAt: current },
      leaseUntil: new Date(Date.parse(current) + leaseMs).toISOString(),
      now: current
    });
    if (!durable.updated) throw recoveryLeaseConflict(durable.run, "合并 ONU 同步租约已失效，请重新发起同步。 ");
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

  async function persistAndExtractNmseRows(datasets) {
    await replaceResourceUsersBatch({ datasets });
    return mergedOnuService.readLocalUsersAsMergeRows(datasets);
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
        leaseMs,
        now: startedAt
      });
      if (!claimed.claimed) throw recoveryLeaseConflict(claimed.run || expiredSameOperation, "合并 ONU 同步恢复租约竞争失败，请稍后重试。");
      const recoveredRun = claimed.run || expiredSameOperation;
      setState({
        running: true, operation, status: "running", phase,
        totalOlts: 0, completedOlts: 0, networkRows: 0, nmseRows: 0,
        nmseTotal: 0, nmsePages: 0, nmseCompletedPages: 0, nmseWorkers: 0,
        nmseAttempt: 0, mergedRows: 0, conflicts: 0, error: "",
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
    const durable = await beginMergedOnuSyncRun({ runId, operation, phase, startedAt, idempotencyKey, workerId });
    if (durable.duplicate) return { duplicate: true, runId: durable.run?.runId || runId, existingRun: durable.run };
    setState({
      running: true, operation, status: "running", phase,
      totalOlts: 0, completedOlts: 0, networkRows: 0, nmseRows: 0,
      nmseTotal: 0, nmsePages: 0, nmseCompletedPages: 0, nmseWorkers: 0,
      nmseAttempt: 0, mergedRows: 0, conflicts: 0, error: "",
      startedAt, completedAt: "", revision: ""
    });
    await refreshRecoveryState();
    return { startedAt, runId };
  }

  async function readNetworkRows(targets) {
    const ossSession = activeOssNgbSession();
    const networkRows = [];
    for (const [targetIndex, { target, mapping }] of targets.entries()) {
      const remote = ossSession.olts.find((item) => item.resourceIp === mapping.resourceIp);
      if (!remote?.cuid) throw syncError(`网管二期会话未发现 OLT ${target.id} 的对应资源。`, 404);
      const rows = await ossSession.client.readOnuInventory(remote.cuid);
      networkRows.push(...rows.map((row) => ({ ...row, oltIp: target.host })));
      setState({ completedOlts: targetIndex + 1, networkRows: networkRows.length });
    }
    return networkRows;
  }

  async function readNmseRows(targets) {
    let nmse = await loginNmseSession();
    const datasets = [];
    for (const { target } of targets) {
      const gridRank = resourceGridRank(nmse, target);
      const readRows = async () => resourceUserSync.readComplete({
        oltId: target.id,
        gridRank,
        session: nmse,
        pageSize: 20,
        maxConcurrentPages: 8,
        onProgress: (progress) => setState({
          nmseTotal: Number(progress.total || 0),
          nmsePages: Number(progress.pages || 0),
          nmseCompletedPages: Number(progress.completedPages || 0),
          nmseRows: Number(progress.received || 0),
          nmseWorkers: Number(progress.workers || 0),
          nmseAttempt: Number(progress.attempt || 0)
        })
      });
      let rows;
      try {
        rows = await readRows();
      } catch (error) {
        if (error?.status !== 401) throw error;
        remoteSessionState.clearNmseSession();
        nmse = await loginNmseSession();
        rows = await readRows();
      }
      datasets.push({ oltIp: target.host, gridRank, rows });
      setState({ nmseRows: datasets.reduce((count, dataset) => count + dataset.rows.length, 0) });
    }
    return datasets;
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
    if (begun.duplicate) return { duplicate: true, runId: begun.runId, existingRun: begun.existingRun };
    const { startedAt, runId, recovered = false, recovery = null } = begun;
    let backup;
    let networkRowCount = 0;
    let nmseRowCount = 0;
    try {
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
        const stored = await replaceMergedOnuNetworkSource({ rows });
        const completedAt = new Date().toISOString();
        const sourceManifest = buildSourceManifest({ source: "network", runId, idempotencyKey, startedAt, completedAt, targetOltIds: targets.map(({ target }) => target.id), sourceRevision: stored.source.revision, rowCount: rows.length });
        await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "network-source", updatedAt: completedAt }, now: completedAt });
        await persistMergedOnuManifest({ runId, manifest: sourceManifest });
        await recordMergedOnuSourceSyncSuccess({ runId, operation, networkCount: rows.length, nmseCount: 0, backup, startedAt, completedAt });
        return { ...stored, ...(await complete({ runId, operation, backup, networkCount: rows.length, nmseCount: 0 })), recovered, recovery };
      }
      const datasets = await readNmseRows(targets);
      const rows = await persistAndExtractNmseRows(datasets);
      nmseRowCount = rows.length;
      const stored = await replaceMergedOnuNmseSource({ rows });
      const completedAt = new Date().toISOString();
      const sourceManifest = buildSourceManifest({ source: "nmse", runId, idempotencyKey, startedAt, completedAt, targetOltIds: targets.map(({ target }) => target.id), sourceRevision: stored.source.revision, rowCount: rows.length });
      await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "nmse-source", updatedAt: completedAt }, now: completedAt });
      await persistMergedOnuManifest({ runId, manifest: sourceManifest });
      await recordMergedOnuSourceSyncSuccess({ runId, operation, networkCount: 0, nmseCount: rows.length, backup, startedAt, completedAt });
      return { ...stored, ...(await complete({ runId, operation, backup, networkCount: 0, nmseCount: rows.length })), recovered, recovery };
    } catch (error) {
      return fail({ runId, operation, startedAt, backup, networkCount: networkRowCount, nmseCount: nmseRowCount, error });
    }
  }

  async function runManualMerge({ idempotencyKey = "" } = {}) {
    const operation = "merge";
    const begun = await begin(operation, "starting", { idempotencyKey });
    if (begun.duplicate) return { duplicate: true, runId: begun.runId, existingRun: begun.existingRun };
    const { startedAt, runId, recovered = false, recovery = null } = begun;
    let backup;
    try {
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
      const result = await syncMergedOnuDataset({ operation, networkRows, nmseRows, backup, manifest, workerId, runAlreadyClaimed: true, manageRuntime: false });
      return { ...result, ...(await complete({ runId, operation, backup, networkCount: result.networkCount, nmseCount: result.nmseCount, mergedCount: result.mergedCount, conflictCount: result.conflictCount, revision: result.revision })), recovered, recovery };
    } catch (error) {
      return fail({ runId, operation, startedAt, backup, error });
    }
  }

  async function runFullSync({ idempotencyKey = "" } = {}) {
    const operation = "full";
    const begun = await begin(operation, "starting", { idempotencyKey });
    if (begun.duplicate) return { duplicate: true, runId: begun.runId, existingRun: begun.existingRun };
    const { startedAt, runId, recovered = false, recovery = null } = begun;
    let backup;
    let networkRowCount = 0;
    let nmseRowCount = 0;
    try {
      backup = await backupDatabaseBeforeSync({ reason: "merged-onu-sync" });
      const olts = await getOlts();
      const targets = mergedOnuService.selectMergedOnuTargets(olts, await getResourceOltIpMappings());
      setState({ totalOlts: targets.length, phase: "fetching-network" });
      const networkRows = await readNetworkRows(targets);
      networkRowCount = networkRows.length;
      setState({ phase: "fetching-nmse", completedOlts: targets.length });
      const nmseRows = await persistAndExtractNmseRows(await readNmseRows(targets));
      nmseRowCount = nmseRows.length;
      const networkStored = await replaceMergedOnuNetworkSource({ rows: networkRows });
      const nmseStored = await replaceMergedOnuNmseSource({ rows: nmseRows });
      const sourceCompletedAt = new Date().toISOString();
      await persistMergedOnuManifest({ runId, manifest: buildSourceManifest({ source: "network", runId, startedAt, completedAt: sourceCompletedAt, targetOltIds: targets.map(({ target }) => target.id), sourceRevision: networkStored.source.revision, rowCount: networkRows.length }) });
      await persistMergedOnuManifest({ runId, manifest: buildSourceManifest({ source: "nmse", runId, completedAt: sourceCompletedAt, startedAt, targetOltIds: targets.map(({ target }) => target.id), sourceRevision: nmseStored.source.revision, rowCount: nmseRows.length }) });
      const manifest = await buildInputManifest({ runId, networkRows, nmseRows, idempotencyKey });
      await updatePhase({ runId, phase: "persisting", checkpoint: { status: "complete", cursor: "sources-ready", updatedAt: sourceCompletedAt }, now: sourceCompletedAt });
      setState({ phase: "merging" });
      const result = await syncMergedOnuDataset({ operation, networkRows, nmseRows, backup, manifest, workerId, runAlreadyClaimed: true, manageRuntime: false });
      return { ...result, ...(await complete({ runId, operation, backup, networkCount: result.networkCount, nmseCount: result.nmseCount, mergedCount: result.mergedCount, conflictCount: result.conflictCount, revision: result.revision })), recovered, recovery };
    } catch (error) {
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
