import { createBackupCleanupScheduler } from "./backup-cleanup-scheduler.mjs";

export function createBackupCleanupRuntime({
  planCleanup,
  executeCleanup,
  clock = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  intervalMs
} = {}) {
  const scheduler = createBackupCleanupScheduler({ planCleanup, executeCleanup, clock, setTimer, clearTimer, intervalMs });
  return Object.freeze({
    start: (options) => scheduler.start(options),
    stop: () => scheduler.stop(),
    status: () => scheduler.status(),
    trigger: (options) => scheduler.trigger(options)
  });
}
