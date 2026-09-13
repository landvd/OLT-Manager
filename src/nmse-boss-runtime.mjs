import {
  BOSS_NAME_HISTORY_START,
  BOSS_READ_ONLY_QUERY,
  computeBossIncrementalWindow,
  computeBossNameHistoryWindows,
  currentBossWallTime,
  deduplicateBossChanges,
  filterBossChanges,
  previousShanghaiCalendarDate,
  projectBossNameHistory
} from "./nmse-boss-sync.mjs";

export function createNmseBossIncrementalRuntime({ getState, getSession, applyChanges, replaceNameHistory = null, relogin = null, clearSession = null, now = () => new Date() } = {}) {
  for (const [name, value] of Object.entries({ getState, getSession, applyChanges })) if (typeof value !== "function") throw new TypeError(`BOSS增量运行时缺少依赖：${name}。`);
  let running = false;
  let last = { status: "idle", error: "", count: 0, window: null, watermark: "" };
  return {
    state() { return { running, ...last }; },
    async run({ onProgress, manifestContext = null, beforeCommit = null, forceHistory = false } = {}) {
      if (running) { const error = new Error("BOSS同步正在执行。"); error.status = 409; throw error; }
      if (beforeCommit !== null && typeof beforeCommit !== "function") throw new TypeError("BOSS 同步提交守卫必须是函数。");
      running = true;
      try {
        const state = await getState();
        const runStartedAt = now();
        const bossIso = (value) => new Date(`${String(value).replace(" ", "T")}+08:00`).toISOString();
        const readWindow = async (window, { projection = "changes", progressContext = {} } = {}) => {
          let retried = false;
          while (true) {
            const session = await getSession();
            try {
              return await session.client.getBossOperations(session.auth, {
                windowStart: window.start,
                windowEnd: window.end,
                projection,
                onProgress: (progress) => {
                  const combined = { ...progress, ...progressContext };
                  last = { ...last, status: "running", window, progress: combined };
                  onProgress?.(combined);
                }
              });
            } catch (error) {
              if (error?.status !== 401 || typeof relogin !== "function") throw error;
              if (retried) {
                const exhausted = new Error("NMSE-PON 会话自动恢复后再次失效，请检查已保存凭据或上游登录状态。");
                exhausted.status = 401;
                exhausted.code = "NMSE_SESSION_RECOVERY_EXHAUSTED";
                throw exhausted;
              }
              retried = true;
              const recoveryProgress = { phase: "boss-session-recovery", attempt: 1, maxAttempts: 1, ...progressContext };
              last = { ...last, status: "running", window, progress: recoveryProgress };
              onProgress?.(recoveryProgress);
              clearSession?.();
              try {
                await relogin();
              } catch (reloginError) {
                const recoveryError = new Error(`NMSE-PON 会话失效且自动重新登录失败：${reloginError?.message || "登录失败。"}`);
                recoveryError.status = reloginError?.status || 401;
                recoveryError.code = "NMSE_SESSION_RECOVERY_FAILED";
                throw recoveryError;
              }
            }
          }
        };

        const historyRequired = (Object.hasOwn(state || {}, "nameHistoryCompletedAt") && !String(state?.nameHistoryCompletedAt || "").trim()) || Boolean(forceHistory);
        if (historyRequired) {
          if (typeof replaceNameHistory !== "function") throw new TypeError("BOSS 历史姓名初始化缺少本地提交依赖。");
          const window = { start: BOSS_NAME_HISTORY_START, end: currentBossWallTime(runStartedAt) };
          const windows = computeBossNameHistoryWindows(window);
          const latest = new Map();
          let eventCount = 0;
          let skippedCount = 0;
          let conflictCount = 0;
          for (const [index, chunk] of windows.entries()) {
            const raw = await readWindow(chunk, {
              projection: "names",
              progressContext: {
                mode: "history",
                chunkIndex: index + 1,
                chunkCount: windows.length,
                completedChunks: index,
                accumulatedRows: latest.size,
                historyStart: window.start,
                historyEnd: window.end,
                chunkStart: chunk.start,
                chunkEnd: chunk.end
              }
            });
            const projected = projectBossNameHistory(raw, { window: chunk, includeEnd: index === windows.length - 1 });
            eventCount += projected.eventCount;
            skippedCount += projected.skippedCount;
            conflictCount += projected.conflictCount;
            for (const row of projected.rows) {
              const previous = latest.get(row.loid);
              if (!previous || row.receivedAt > previous.receivedAt || (row.receivedAt === previous.receivedAt && row.idempotencyKey > previous.idempotencyKey)) {
                if (previous && row.username.trim().length <= 1 && previous.username.trim().length >= 2) {
                  latest.set(row.loid, { ...row, username: previous.username });
                } else {
                  latest.set(row.loid, row);
                }
              }
            }
            onProgress?.({
              phase: "boss-history-chunk",
              mode: "history",
              chunkIndex: index + 1,
              chunkCount: windows.length,
              completedChunks: index + 1,
              accumulatedRows: latest.size,
              eventCount,
              skippedCount,
              conflictCount,
              historyStart: window.start,
              historyEnd: window.end,
              chunkStart: chunk.start,
              chunkEnd: chunk.end
            });
          }
          if (eventCount === 0 || latest.size === 0) {
            const empty = new Error("BOSS 历史姓名查询未返回任何可用姓名，已拒绝标记初始化完成。");
            empty.status = 502;
            empty.code = "BOSS_NAME_HISTORY_EMPTY";
            throw empty;
          }
          const coverageThrough = previousShanghaiCalendarDate(window.end);
          const completedAt = now().toISOString();
          const effectiveManifestContext = manifestContext ? { ...manifestContext, windowStart: bossIso(window.start), windowEnd: bossIso(window.end), completedAt, coverageThrough } : null;
          await beforeCommit?.({ mode: "history", window, eventCount, nameCount: latest.size });
          const persisted = await replaceNameHistory({
            rows: [...latest.values()],
            watermark: window.end,
            windowStart: window.start,
            windowEnd: window.end,
            coverageThrough,
            eventCount,
            skippedCount,
            conflictCount,
            manifestContext: effectiveManifestContext,
            force: Boolean(forceHistory)
          });
          last = { status: "success", mode: "history", error: "", count: persisted.count, nameCount: latest.size, eventCount, skippedCount, conflictCount, window, watermark: persisted.watermark, query: BOSS_READ_ONLY_QUERY };
          return { ...last };
        }

        const window = computeBossIncrementalWindow({ watermark: state?.watermark, now: runStartedAt, overlapDays: 1 });
        const rowsFromBoss = await readWindow(window);
        const rows = deduplicateBossChanges(filterBossChanges(rowsFromBoss, { content: BOSS_READ_ONLY_QUERY.content, window }));
        const coverageThrough = previousShanghaiCalendarDate(window.end);
        const completedAt = now().toISOString();
        const effectiveManifestContext = manifestContext ? { ...manifestContext, windowStart: bossIso(window.start), windowEnd: bossIso(window.end), completedAt, coverageThrough } : null;
        await beforeCommit?.({ mode: "incremental", window, eventCount: rows.length, nameCount: 0 });
        const persisted = await applyChanges({ rows, watermark: window.end, windowStart: window.start, windowEnd: window.end, coverageThrough, manifestContext: effectiveManifestContext });
        last = { status: "success", mode: "incremental", error: "", count: rows.length, window, watermark: persisted.watermark, query: BOSS_READ_ONLY_QUERY };
        return { ...last };
      } catch (error) {
        last = { ...last, status: "failed", error: error.message || "BOSS增量同步失败。" };
        throw error;
      } finally { running = false; }
    }
  };
}
