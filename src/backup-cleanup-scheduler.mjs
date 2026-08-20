const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const STATES = new Set(["idle", "scheduled", "running", "success", "failed", "stopped"]);

function schedulerError(code, message) {
  const error = new Error(message);
  error.name = "BackupCleanupSchedulerError";
  error.code = code;
  return error;
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw schedulerError("BACKUP_SCHEDULER_DEPENDENCY_REQUIRED", `${name} 必须是函数。`);
  }
  return value;
}

function timestamp(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "BACKUP_CLEANUP_FAILED";
}

function safeSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const safe = {};
  for (const field of ["candidateCount", "eligibleCount", "blockedCount", "ignoredCount", "requestedCount", "deletedCount", "failedCount", "skippedCount"]) {
    if (Number.isSafeInteger(summary[field]) && summary[field] >= 0) safe[field] = summary[field];
  }
  return Object.freeze(safe);
}

function normalizeInterval(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw schedulerError("BACKUP_SCHEDULER_INTERVAL_INVALID", "调度间隔必须是正整数毫秒。");
  }
  return value;
}

function publicStatus(state) {
  return Object.freeze({
    state: state.state,
    running: state.running,
    started: state.started,
    confirmed: state.confirmed,
    nextRunAt: state.nextRunAt,
    lastRunAt: state.lastRunAt,
    lastStatus: state.lastStatus,
    lastErrorCode: state.lastErrorCode,
    lastSummary: state.lastSummary
  });
}

export function createBackupCleanupScheduler({
  planCleanup,
  executeCleanup,
  clock,
  setTimer,
  clearTimer,
  intervalMs = DEFAULT_INTERVAL_MS
} = {}) {
  requireFunction(planCleanup, "planCleanup");
  requireFunction(executeCleanup, "executeCleanup");
  requireFunction(clock, "clock");
  requireFunction(setTimer, "setTimer");
  requireFunction(clearTimer, "clearTimer");
  const defaultIntervalMs = normalizeInterval(intervalMs);

  let timer = null;
  let inFlight = null;
  const state = {
    state: "idle",
    running: false,
    started: false,
    confirmed: false,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastErrorCode: null,
    lastSummary: null
  };

  function now() {
    const current = clock();
    const value = current instanceof Date ? current.getTime() : current;
    if (!Number.isFinite(value)) throw schedulerError("BACKUP_SCHEDULER_CLOCK_INVALID", "调度时钟无效。");
    return value;
  }

  function clearScheduledTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    state.nextRunAt = null;
  }

  function schedule() {
    clearScheduledTimer();
    if (!state.started) return;
    const current = now();
    const next = current + state.intervalMs;
    state.nextRunAt = timestamp(next);
    const delay = Math.min(state.intervalMs, MAX_TIMER_DELAY_MS);
    timer = setTimer(() => {
      timer = null;
      state.nextRunAt = null;
      void trigger({ confirmed: false }).catch(() => {});
    }, delay);
  }

  async function trigger({ confirmed = false } = {}) {
    if (confirmed !== true && confirmed !== false) {
      throw schedulerError("BACKUP_SCHEDULER_CONFIRMATION_INVALID", "confirmed 必须是布尔值。");
    }
    if (inFlight) return Object.freeze({ skipped: true, reason: "RUN_IN_PROGRESS", status: publicStatus(state) });

    const startedAt = timestamp(now());
    state.running = true;
    state.state = "running";
    state.lastRunAt = startedAt;
    state.lastStatus = null;
    state.lastErrorCode = null;
    state.lastSummary = null;
    state.confirmed = confirmed;

    inFlight = (async () => {
      try {
        const plan = await planCleanup({ now: startedAt });
        const result = confirmed === true
          ? await executeCleanup({ plan, confirmed: true })
          : plan;
        state.lastStatus = confirmed === true ? "executed" : "planned";
        state.lastSummary = safeSummary(result?.summary);
        state.state = "success";
        return result;
      } catch (error) {
        state.state = "failed";
        state.lastStatus = "failed";
        state.lastErrorCode = safeErrorCode(error);
        throw schedulerError("BACKUP_CLEANUP_SCHEDULER_RUN_FAILED", "备份清理调度运行失败。");
      } finally {
        state.running = false;
        inFlight = null;
        state.confirmed = false;
        if (state.started) schedule();
      }
    })();
    return inFlight;
  }

  function start({ intervalMs: requestedIntervalMs = defaultIntervalMs, confirmed = false } = {}) {
    if (confirmed === true) {
      throw schedulerError("BACKUP_SCHEDULER_AUTO_DELETE_DISABLED", "定时触发禁止自动确认删除，请使用一次性显式执行。 ");
    }
    if (confirmed !== false) {
      throw schedulerError("BACKUP_SCHEDULER_CONFIRMATION_INVALID", "confirmed 必须是布尔值。");
    }
    state.intervalMs = normalizeInterval(requestedIntervalMs);
    state.confirmed = false;
    state.started = true;
    state.state = "scheduled";
    schedule();
    return publicStatus(state);
  }

  function stop() {
    state.started = false;
    clearScheduledTimer();
    if (!state.running) state.state = "stopped";
    return publicStatus(state);
  }

  state.intervalMs = defaultIntervalMs;
  return Object.freeze({ start, stop, trigger, status: () => publicStatus(state) });
}
