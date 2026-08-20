import test from "node:test";
import assert from "node:assert/strict";
import { createBackupCleanupScheduler } from "../src/backup-cleanup-scheduler.mjs";

function harness({ planCleanup = async () => ({ dryRun: true, summary: { candidateCount: 0 } }), executeCleanup = async () => ({ dryRun: false }) } = {}) {
  let current = Date.parse("2026-08-19T00:00:00.000Z");
  const timers = [];
  const cleared = [];
  const scheduler = createBackupCleanupScheduler({
    planCleanup,
    executeCleanup,
    clock: () => current,
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => cleared.push(timer)
  });
  return { scheduler, timers, cleared, advance: (value) => { current = value; } };
}

test("trigger defaults to dry-run and does not execute", async () => {
  let planned = 0;
  let executed = 0;
  const { scheduler } = harness({
    planCleanup: async () => { planned += 1; return { dryRun: true, summary: { candidateCount: 2 } }; },
    executeCleanup: async () => { executed += 1; return {}; }
  });
  const result = await scheduler.trigger();
  assert.equal(planned, 1);
  assert.equal(executed, 0);
  assert.equal(result.dryRun, true);
  assert.equal(scheduler.status().lastStatus, "planned");
});

test("only explicit confirmed=true executes", async () => {
  const calls = [];
  const { scheduler } = harness({
    planCleanup: async () => { calls.push("plan"); return { candidates: [] }; },
    executeCleanup: async (input) => { calls.push(input.confirmed); return { summary: { deletedCount: 0 } }; }
  });
  await scheduler.trigger({ confirmed: false });
  await scheduler.trigger({ confirmed: true });
  assert.deepEqual(calls, ["plan", "plan", true]);
  assert.equal(scheduler.status().confirmed, false);
});

test("concurrent trigger is ignored while a run is pending", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let count = 0;
  const { scheduler } = harness({ planCleanup: async () => { count += 1; await pending; return {}; } });
  const first = scheduler.trigger();
  const second = await scheduler.trigger();
  assert.deepEqual(second, { skipped: true, reason: "RUN_IN_PROGRESS", status: scheduler.status() });
  assert.equal(count, 1);
  release();
  await first;
  assert.equal(scheduler.status().running, false);
});

test("start and stop schedule and clear timers idempotently", () => {
  const { scheduler, timers, cleared } = harness();
  scheduler.start({ intervalMs: 1000 });
  scheduler.start({ intervalMs: 1000 });
  assert.equal(timers.length, 2);
  assert.equal(cleared.length, 1);
  scheduler.stop();
  scheduler.stop();
  assert.equal(cleared.length, 2);
  assert.equal(scheduler.status().state, "stopped");
  assert.equal(scheduler.status().nextRunAt, null);
});

test("scheduled cleanup cannot enable automatic deletion", () => {
  const { scheduler, timers } = harness();
  assert.throws(() => scheduler.start({ intervalMs: 1000, confirmed: true }), { code: "BACKUP_SCHEDULER_AUTO_DELETE_DISABLED" });
  scheduler.start({ intervalMs: 1000 });
  assert.equal(scheduler.status().confirmed, false);
  assert.doesNotThrow(() => timers[0].callback());
});

test("failed runs expose only a stable error code", async () => {
  const secret = "/private/backup/password=secret-token.sqlite.enc";
  const { scheduler } = harness({
    planCleanup: async () => { throw Object.assign(new Error(secret), { code: "BACKUP_PATH_UNSAFE" }); }
  });
  await assert.rejects(() => scheduler.trigger(), { code: "BACKUP_CLEANUP_SCHEDULER_RUN_FAILED" });
  const status = scheduler.status();
  assert.equal(status.state, "failed");
  assert.equal(status.lastErrorCode, "BACKUP_PATH_UNSAFE");
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(JSON.stringify(status).includes("password"), false);
});
