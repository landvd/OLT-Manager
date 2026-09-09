import { computeBossIncrementalWindow, deduplicateBossChanges, filterBossChanges, previousShanghaiCalendarDate, BOSS_READ_ONLY_QUERY } from "./nmse-boss-sync.mjs";

export function createNmseBossIncrementalRuntime({ getState, getSession, applyChanges, relogin = null, clearSession = null, now = () => new Date() } = {}) {
  for (const [name, value] of Object.entries({ getState, getSession, applyChanges })) if (typeof value !== "function") throw new TypeError(`BOSS增量运行时缺少依赖：${name}。`);
  let running = false;
  let last = { status: "idle", error: "", count: 0, window: null, watermark: "" };
  return {
    state() { return { running, ...last }; },
    async run({ onProgress, manifestContext = null } = {}) {
      if (running) { const error = new Error("BOSS增量同步正在执行。"); error.status = 409; throw error; }
      running = true;
      try {
        const state = await getState();
        const completionNow = now();
        const window = computeBossIncrementalWindow({ watermark: state?.watermark, now: completionNow, overlapDays: 1 });
        let rowsFromBoss;
        let retried = false;
        while (true) {
          const session = await getSession();
          try {
            rowsFromBoss = await session.client.getBossOperations(session.auth, {
              windowStart: window.start, windowEnd: window.end,
              onProgress: (progress) => { last = { ...last, status: "running", window, progress }; onProgress?.(progress); }
            });
            break;
          } catch (error) {
            if (error?.status !== 401 || retried || typeof relogin !== "function") throw error;
            retried = true;
            clearSession?.();
            await relogin();
          }
        }
        const rows = deduplicateBossChanges(filterBossChanges(rowsFromBoss, { content: BOSS_READ_ONLY_QUERY.content, window }));
        const bossIso = (value) => new Date(`${String(value).replace(" ", "T")}+08:00`).toISOString();
        // Use the runtime clock consistently so callers/tests with an injected
        // clock get the real collection completion instant, not wall-clock
        // time from a separate Date() call.
        const completedAt = completionNow.toISOString();
        const coverageThrough = previousShanghaiCalendarDate(window.end);
        const effectiveManifestContext = manifestContext ? { ...manifestContext, windowStart: bossIso(window.start), windowEnd: bossIso(window.end), completedAt, coverageThrough } : null;
        const persisted = await applyChanges({ rows, watermark: window.end, windowStart: window.start, windowEnd: window.end, coverageThrough, manifestContext: effectiveManifestContext });
        last = { status: "success", error: "", count: rows.length, window, watermark: persisted.watermark, query: BOSS_READ_ONLY_QUERY };
        return { ...last };
      } catch (error) {
        last = { ...last, status: "failed", error: error.message || "BOSS增量同步失败。" };
        throw error;
      } finally { running = false; }
    }
  };
}
