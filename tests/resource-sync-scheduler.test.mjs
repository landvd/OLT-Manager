import test from "node:test";
import assert from "node:assert/strict";
import { createResourceSyncScheduler } from "../src/resource-sync-scheduler.mjs";

const baseTask = (overrides = {}) => ({
  id: "task-1",
  operation: "full",
  oltId: "",
  runAt: "2026-08-19T00:00:00.000Z",
  repeatDays: 0,
  status: "pending",
  ...overrides
});
function createHarness({ syncComplete, now = Date.parse("2026-08-19T01:00:00.000Z") } = {}) {
  const timers = [];
  const cleared = [];
  const updates = [];
  const scheduler = createResourceSyncScheduler({
    getTasks: async () => [],
    updateTask: async (id, update) => {
      updates.push({ id, update });
      return { ...baseTask(), ...update };
    },
    getTargetOlt: async () => ({ id: "olt-1", host: "olt.example.test" }),
    getNmseSession: async () => ({ olts: [] }),
    getGridRank: () => "grid-1",
    resourceUserSync: { syncComplete: async () => ({ count: 3 }) },
    operations: {
      full: syncComplete || (async () => ({ mergedCount: 3 }))
    },
    now: () => now,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => cleared.push(timer)
  });
  return { scheduler, timers, cleared, updates };
}

async function runTimer(timer) {
  timer.callback();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("repeating tasks calculate the next run and remain pending", async () => {
  const harness = createHarness();
  const task = baseTask({ repeatDays: 2, runAt: "2026-08-18T01:00:00.000Z" });
  harness.scheduler.schedule(task);
  await runTimer(harness.timers[0]);

  const completed = harness.updates.at(-1).update;
  assert.equal(completed.status, "pending");
  assert.equal(completed.runAt, "2026-08-20T01:00:00.000Z");
  assert.equal(harness.timers.length, 2);
});

test("credential failures close repeating tasks instead of re-queueing them", async () => {
  const harness = createHarness({
    syncComplete: async () => {
      const error = new Error("需要解锁资源凭据。");
      error.code = "RESOURCE_CREDENTIAL_UNLOCK_REQUIRED";
      throw error;
    }
  });
  harness.scheduler.schedule(baseTask({ repeatDays: 7 }));
  await runTimer(harness.timers[0]);

  const failed = harness.updates.at(-1).update;
  assert.equal(failed.status, "failed");
  assert.equal(Object.hasOwn(failed, "runAt"), false);
  assert.equal(harness.timers.length, 1);
});

test("scheduling replaces and clearing removes the timer", () => {
  const harness = createHarness();
  const task = baseTask({ runAt: "2026-08-20T00:00:00.000Z" });
  harness.scheduler.schedule(task);
  harness.scheduler.schedule(task);
  assert.equal(harness.cleared.length, 1);
  harness.scheduler.clear(task.id);
  assert.equal(harness.cleared.length, 2);
});

test("new schedule operations dispatch without an OLT target", async () => {
  const calls = [];
  const timers = [];
  const harness = createHarness();
  const operations = ["network", "nmse", "merge", "full"];
  const scheduler = createResourceSyncScheduler({
    getTasks: async () => [],
    updateTask: async (id, update) => {
      calls.push({ id, update });
      return { ...baseTask({ operation: update.operation }), ...update };
    },
    operations: Object.fromEntries(operations.map((operation) => [operation, async ({ task }) => {
      calls.push({ operation, task });
      return { mergedCount: operation === "merge" ? 2 : 1 };
    }])),
    now: () => Date.parse("2026-08-19T01:00:00.000Z"),
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {}
  });
  for (const operation of operations) {
    scheduler.schedule(baseTask({ id: `task-${operation}`, operation, runAt: "2026-08-19T00:00:00.000Z" }));
    timers.at(-1).callback();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(calls.filter((entry) => entry.operation).map((entry) => entry.operation), operations);
});
