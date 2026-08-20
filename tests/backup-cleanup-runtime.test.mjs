import test from "node:test";
import assert from "node:assert/strict";
import { createBackupCleanupRuntime } from "../src/backup-cleanup-runtime.mjs";

function createHarness() {
  const timers = [];
  const calls = [];
  const runtime = createBackupCleanupRuntime({
    planCleanup: async () => { calls.push("plan"); return { dryRun: true, candidates: [], summary: { candidateCount: 0 } }; },
    executeCleanup: async ({ confirmed }) => { calls.push(["execute", confirmed]); return { dryRun: false, summary: { deletedCount: 1 } }; },
    clock: () => new Date("2026-08-19T00:00:00.000Z"),
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: (id) => { calls.push(["clear", id]); },
    intervalMs: 60_000
  });
  return { runtime, timers, calls };
}

test("backup cleanup runtime schedules dry-run plans and requires explicit confirmation for deletion", async () => {
  const { runtime, timers, calls } = createHarness();
  const scheduled = runtime.start();
  assert.equal(scheduled.state, "scheduled");
  await timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["plan"]);
  assert.equal(runtime.status().lastStatus, "planned");

  const planned = await runtime.trigger({ confirmed: false });
  assert.equal(planned.dryRun, true);
  assert.equal(calls.includes("execute"), false);
  const executed = await runtime.trigger({ confirmed: true });
  assert.equal(executed.dryRun, false);
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === "execute").at(-1), ["execute", true]);
  runtime.stop();
});

test("backup cleanup runtime refuses confirmed scheduled start", () => {
  const { runtime } = createHarness();
  assert.throws(() => runtime.start({ confirmed: true }), { code: "BACKUP_SCHEDULER_AUTO_DELETE_DISABLED" });
});
