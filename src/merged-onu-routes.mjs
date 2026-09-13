function publicError(error, fallback, operation, mergedSyncErrorMessage) {
  const clientError = error.status === 400 || error.status === 409 || error.status === 401 || error.status === 404;
  return clientError ? (error.message || fallback) : mergedSyncErrorMessage(error, operation);
}

export async function handleMergedOnuRoutes(req, res, url, {
  publicMergedOnuSyncState,
  getMergedOnuSyncRuns,
  getMergedOnuConflicts,
  getMergedOnuDatasetStatus,
  getMergedOnuSnapshots,
  getNmseBossSyncState = async () => ({}),
  initializeNmseBossSyncState = async () => { throw new Error("BOSS 水位初始化不可用。"); },
  resetNmseBossNameHistory = async () => { throw new Error("BOSS 历史姓名重置不可用。"); },
  backupDatabaseBeforeSync = async () => null,
  runMergedOnuSourceSync,
  runMergedOnuManualMerge,
  runMergedOnuSync,
  resourceTargetOlt,
  mergedSyncError,
  mergedSyncErrorMessage,
  readBody,
  json,
  olts = []
} = {}) {
  if (req.method === "GET" && url.pathname === "/api/admin/merged-onu/sync/progress") {
    await json(res, 200, publicMergedOnuSyncState());
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/merged-onu/boss-watermark") {
    try {
      const body = await readBody(req);
      const backup = await backupDatabaseBeforeSync({ reason: "nmse-boss-watermark-initialize" });
      await json(res, 200, { ok: true, bossSync: await initializeNmseBossSyncState({ watermark: body?.watermark }), backup: backup ? { name: String(backup.path || "").split(/[\\/]/).pop() || "", bytes: Number(backup.bytes || 0), sha256: String(backup.sha256 || "") } : null });
    } catch (error) { await json(res, error.status || 400, { ok: false, error: error.message || "一期 BOSS 水位初始化失败。" }); }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/merged-onu/boss-name-history/reset") {
    try {
      const backup = await backupDatabaseBeforeSync({ reason: "nmse-boss-name-history-reset" });
      const bossSync = await resetNmseBossNameHistory();
      await json(res, 200, {
        ok: true,
        bossSync,
        backup: backup ? {
          name: String(backup.path || "").split(/[\\/]/).pop() || "",
          bytes: Number(backup.bytes || 0),
          sha256: String(backup.sha256 || "")
        } : null
      });
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message || "一期 BOSS 历史姓名重置失败。" });
    }
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/merged-onu/runs") {
    const runs = await getMergedOnuSyncRuns();
    await json(res, 200, {
      rows: runs.map((run) => ({
        ...run,
        backupPath: run.backupPath ? run.backupPath.split(/[\\/]/).pop() : ""
      }))
    });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/merged-onu/conflicts") {
    await json(res, 200, { rows: await getMergedOnuConflicts({ runId: url.searchParams.get("runId") || "" }) });
    return true;
  }
  if (req.method === "GET" && (url.pathname === "/api/admin/merged-onu/status" || url.pathname === "/api/admin/merged-onu/dataset")) {
    await json(res, 200, { ...await getMergedOnuDatasetStatus(), bossSync: await getNmseBossSyncState(), progress: publicMergedOnuSyncState() });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/merged-onu/snapshots") {
    const oltId = url.searchParams.get("oltId") || "";
    const target = oltId ? resourceTargetOlt(olts, oltId) : null;
    const keyword = String(url.searchParams.get("q") || "").trim().toLowerCase();
    let rows = await getMergedOnuSnapshots({ oltIp: target?.host });
    if (keyword) rows = rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(keyword)));
    await json(res, 200, { rows });
    return true;
  }
  const mergedSourceSyncMatch = req.method === "POST" && url.pathname.match(/^\/api\/admin\/merged-onu\/sync\/(network|nmse)$/);
  if (mergedSourceSyncMatch) {
    const operation = mergedSourceSyncMatch[1];
    try {
      const body = await readBody(req);
      if (body && typeof body === "object" && Object.hasOwn(body, "oltId")) {
        throw mergedSyncError("网管二期和 NMSE-PON 源同步仅支持全量同步，不接受 oltId 参数。", 400);
      }
      const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
      const result = await runMergedOnuSourceSync(operation, { idempotencyKey });
      await json(res, 200, {
        ok: true,
        operation,
        runId: result.runId || "",
        duplicate: Boolean(result.duplicate),
        replayed: Boolean(result.replayed),
        recovered: Boolean(result.recovered),
        recovery: result.recovery || null,
        count: Number(result.count || 0),
        revision: result.source?.revision || "",
        source: result.source || null,
        backup: result.backup || null
      });
    } catch (error) {
      await json(res, error.status || 502, { ok: false, error: publicError(error, `${operation} 源同步失败。`, operation, mergedSyncErrorMessage) });
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/merged-onu/merge") {
    try {
      const body = await readBody(req);
      if (body && typeof body === "object" && Object.hasOwn(body, "oltId")) {
        throw mergedSyncError("手动合并仅支持两套源数据全量合并，不接受 oltId 参数。", 400);
      }
      const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
      const result = await runMergedOnuManualMerge({ idempotencyKey });
      await json(res, 200, {
        ok: true,
        operation: "merge",
        runId: result.runId || "",
        duplicate: Boolean(result.duplicate),
        replayed: Boolean(result.replayed),
        recovered: Boolean(result.recovered),
        recovery: result.recovery || null,
        revision: result.revision || "",
        networkCount: Number(result.networkCount || 0),
        nmseCount: Number(result.nmseCount || 0),
        mergedCount: Number(result.mergedCount || 0),
        conflictCount: Number(result.conflictCount || 0),
        conflicts: result.conflicts || [],
        backup: result.backup || null
      });
    } catch (error) {
      await json(res, error.status || 502, { ok: false, error: publicError(error, "手动合并失败。", "merge", mergedSyncErrorMessage) });
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/merged-onu/sync") {
    try {
      const body = await readBody(req);
      if (body && typeof body === "object" && Object.hasOwn(body, "oltId")) {
        throw mergedSyncError("合并 ONU 同步仅支持全量同步，不接受 oltId 参数。", 400);
      }
      const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
      const result = await runMergedOnuSync({ idempotencyKey });
      await json(res, 200, {
        ok: true,
        runId: result.runId || "",
        duplicate: Boolean(result.duplicate),
        replayed: Boolean(result.replayed),
        recovered: Boolean(result.recovered),
        recovery: result.recovery || null,
        revision: result.revision || "",
        networkCount: Number(result.networkCount || 0),
        nmseCount: Number(result.nmseCount || 0),
        mergedCount: Number(result.mergedCount || 0),
        conflictCount: Number(result.conflictCount || 0),
        conflicts: result.conflicts || [],
        backup: result.backup || null
      });
    } catch (error) {
      await json(res, error.status || 502, { ok: false, error: publicError(error, "合并 ONU 同步失败。", "full", mergedSyncErrorMessage) });
    }
    return true;
  }
  return false;
}
