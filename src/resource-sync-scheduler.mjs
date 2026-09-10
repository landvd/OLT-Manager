const DEFAULT_MAX_SCHEDULER_DELAY = 2_147_000_000;
const DEFAULT_INTERRUPTED_RETRY_DELAY = 31 * 60 * 1000;
const CREDENTIAL_BLOCKED_CODES = new Set([
  "RESOURCE_CREDENTIAL_UNLOCK_REQUIRED",
  "RESOURCE_CREDENTIAL_MIGRATION_REQUIRED",
  "RESOURCE_CREDENTIAL_REQUIRED"
]);

const RESOURCE_SYNC_OPERATIONS = new Set(["network", "nmse", "merge", "full"]);

export function createResourceSyncScheduler({
  getTasks,
  updateTask,
  getTargetOlt,
  getNmseSession,
  getGridRank,
  resourceUserSync,
  operations = {},
  invalidateNmseSession = () => {},
  invalidateOssSession = () => {},
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  maxSchedulerDelay = DEFAULT_MAX_SCHEDULER_DELAY,
  interruptedRetryDelayMs = DEFAULT_INTERRUPTED_RETRY_DELAY
} = {}) {
  const timers = new Map();
  let initialized = false;

  function clear(taskId) {
    const timer = timers.get(taskId);
    if (timer) clearTimeoutFn(timer);
    timers.delete(taskId);
  }

  function nextRunAt(task) {
    const repeatDays = Number(task.repeatDays || 0);
    if (!Number.isInteger(repeatDays) || repeatDays <= 0) return "";
    const next = new Date(task.runAt);
    if (!Number.isFinite(next.getTime())) return "";
    do {
      next.setDate(next.getDate() + repeatDays);
    } while (next.getTime() <= now());
    return next.toISOString();
  }

  async function run(task) {
    clear(task.id);
    const startedAt = new Date(now()).toISOString();
    await updateTask(task.id, { status: "running", startedAt, completedAt: null, error: "", resultCount: 0 });
    try {
      const operation = String(task.operation || "").trim();
      let result;
      const legacySingleOltTask = operation === "nmse" && String(task.oltId || "").trim();
      if (RESOURCE_SYNC_OPERATIONS.has(operation) && !legacySingleOltTask && typeof operations[operation] === "function") {
        result = await operations[operation]({ task, idempotencyKey: `resource-schedule:${task.id}:${task.runAt}` });
      } else {
        // Keep already-created legacy tasks runnable until users replace them.
        const target = await getTargetOlt(task.oltId);
        const session = await getNmseSession();
        const gridRank = getGridRank(session, target);
        result = await resourceUserSync.syncComplete({ oltId: target.id, oltIp: target.host, gridRank, session });
      }
      const resultCount = Number(result?.mergedCount ?? result?.count ?? result?.networkCount ?? result?.nmseCount ?? 0);
      const next = nextRunAt(task);
      const update = {
        status: task.repeatDays ? "pending" : "success",
        startedAt,
        completedAt: new Date(now()).toISOString(),
        error: "",
        resultCount: Number.isFinite(resultCount) ? Math.max(0, resultCount) : 0,
        lastRunAt: startedAt,
        lastStatus: "success"
      };
      if (next) update.runAt = next;
      const updated = await updateTask(task.id, update);
      if (updated?.status === "pending") schedule(updated);
    } catch (error) {
      if (error.status === 401) {
        if (task.operation === "network" || task.operation === "full") invalidateOssSession();
        if (task.operation !== "network") invalidateNmseSession();
      }
      const credentialBlocked = CREDENTIAL_BLOCKED_CODES.has(error.code);
      const next = nextRunAt(task);
      const update = {
        status: task.repeatDays && !credentialBlocked ? "pending" : "failed",
        startedAt,
        completedAt: new Date(now()).toISOString(),
        error: error.message || "用户信息同步失败。",
        resultCount: 0,
        lastRunAt: startedAt,
        lastStatus: "failed"
      };
      if (next && !credentialBlocked) update.runAt = next;
      const updated = await updateTask(task.id, update);
      if (updated?.status === "pending") schedule(updated);
    }
  }

  function schedule(task) {
    if (!task || task.status !== "pending") return;
    clear(task.id);
    const runAt = Date.parse(task.runAt);
    if (!Number.isFinite(runAt)) return;
    const delay = runAt - now();
    const timer = setTimeoutFn(() => {
      if (delay > maxSchedulerDelay) {
        schedule(task);
        return;
      }
      void run(task);
    }, Math.max(0, Math.min(delay, maxSchedulerDelay)));
    timer.unref?.();
    timers.set(task.id, timer);
  }

  function scheduleInterrupted(task, retryAt) {
    clear(task.id);
    const delay = retryAt - now();
    const timer = setTimeoutFn(() => {
      if (delay > maxSchedulerDelay) {
        scheduleInterrupted(task, retryAt);
        return;
      }
      // Keep the original runAt so a crash recovery reuses the same durable
      // idempotency key instead of creating a second logical run.
      void run(task);
    }, Math.max(0, Math.min(delay, maxSchedulerDelay)));
    timer.unref?.();
    timers.set(task.id, timer);
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    const tasks = await getTasks();
    for (const task of tasks) {
      if (task.status === "pending") {
        schedule(task);
        continue;
      }
      if (task.status !== "running") continue;
      const operation = String(task.operation || "").trim();
      const legacySingleOltTask = operation === "nmse" && String(task.oltId || "").trim();
      if (!RESOURCE_SYNC_OPERATIONS.has(operation) || legacySingleOltTask) {
        await updateTask(task.id, {
          status: "failed",
          completedAt: new Date(now()).toISOString(),
          error: "上次任务因程序退出而中断；旧版单 OLT 任务不会自动重放，请人工确认后新建任务。",
          resultCount: 0,
          lastStatus: "failed"
        });
        continue;
      }
      const interruptedAt = Date.parse(task.startedAt);
      const leaseExpiry = Number.isFinite(interruptedAt)
        ? interruptedAt + Math.max(0, Number(interruptedRetryDelayMs) || 0)
        : now() + Math.max(0, Number(interruptedRetryDelayMs) || 0);
      const retryAt = Math.max(now(), leaseExpiry);
      const recovered = await updateTask(task.id, {
        status: "running",
        completedAt: null,
        error: "上次任务因程序退出而中断；将在旧同步租约到期后自动恢复。",
        resultCount: 0,
        lastStatus: "failed"
      });
      scheduleInterrupted(recovered || task, retryAt);
    }
  }

  return { initialize, schedule, clear };
}
