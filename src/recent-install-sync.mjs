// 当天装机同步（ADR-090）：外勤装完 ONU 就要查，但台账几天才同步一次。
// 按一期网管 BOSS 页面的查询方式读取：开始时间当天 0 点、结束时间此刻、处理状态成功、操作状态全部、
// 查询内容为配置的镇区。只读一期网管，只写本地 boss_recent_installs，不推进 BOSS 水位。
import { canonicalizeBossWallDate, normalizeBossChange } from "./nmse-boss-sync.mjs";

const DEFAULT_MIN_INTERVAL_MS = 2 * 60 * 1000;

/** 上海时区当天 0 点到此刻的时间窗。 */
export function todayBossWindow(now = new Date()) {
  const end = canonicalizeBossWallDate(now.toISOString());
  return { start: `${end.slice(0, 10)} 00:00:00`, end };
}

export function createRecentInstallSync({
  readRecentChanges,
  saveRecentInstalls,
  getKnownKeys = async () => new Set(),
  recordRun = async () => {},
  now = () => new Date(),
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  log = () => {}
} = {}) {
  if (typeof readRecentChanges !== "function" || typeof saveRecentInstalls !== "function") {
    throw new TypeError("当天装机同步缺少依赖。");
  }
  let running = null;
  let lastAttemptAt = 0;
  let last = null;

  async function execute(trigger) {
    const startedAt = now();
    const window = todayBossWindow(startedAt);
    lastAttemptAt = startedAt.getTime();
    try {
      const known = await getKnownKeys();
      const skipRow = known?.size ? (row) => {
        try {
          return known.has(normalizeBossChange(row).idempotencyKey);
        } catch {
          return false;
        }
      } : null;
      const { rows, skipped = 0 } = await readRecentChanges({ window, skipRow });
      const saved = await saveRecentInstalls(rows, { fetchedAt: now().toISOString() });
      last = {
        status: "success", trigger, window, eventCount: rows.length, newCount: Number(saved?.newCount || 0), skipped,
        startedAt: startedAt.toISOString(), completedAt: now().toISOString(), error: ""
      };
    } catch (error) {
      last = {
        status: "failed", trigger, window, eventCount: 0, newCount: 0, skipped: 0,
        startedAt: startedAt.toISOString(), completedAt: now().toISOString(), error: error?.message || "读取失败"
      };
      log(`[recent-installs] 同步失败：${last.error}`);
    }
    try {
      await recordRun({ trigger, status: last.status, windowStart: window.start, windowEnd: window.end, eventCount: last.eventCount, newCount: last.newCount, error: last.error, startedAt: last.startedAt, completedAt: last.completedAt });
    } catch {
      // 运行记录失败不影响结果。
    }
    if (last.status === "failed") {
      const error = new Error(last.error);
      error.status = 502;
      throw error;
    }
    return { ...last };
  }

  return Object.freeze({
    /** 距上次读取不到最小间隔时不再读（飞书连续查不到时避免反复请求一期网管）。 */
    canFetch() {
      return !running && now().getTime() - lastAttemptAt >= minIntervalMs;
    },
    async syncToday({ trigger = "manual", force = false } = {}) {
      if (running) return running;
      if (!force && now().getTime() - lastAttemptAt < minIntervalMs) return { ...(last || {}), status: "skipped", newCount: 0 };
      running = execute(trigger);
      try {
        return await running;
      } finally {
        running = null;
      }
    },
    status() {
      return { running: Boolean(running), last };
    }
  });
}
