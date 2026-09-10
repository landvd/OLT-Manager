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

test("scheduled operations use a stable idempotency key derived from the planned run", async () => {
  let receivedKey = "";
  const harness = createHarness({
    syncComplete: async ({ idempotencyKey }) => {
      receivedKey = idempotencyKey;
      return { mergedCount: 1 };
    }
  });
  const task = baseTask({ id: "stable-task", runAt: "2026-08-19T00:00:00.000Z" });
  harness.scheduler.schedule(task);
  await runTimer(harness.timers[0]);
  assert.equal(receivedKey, "resource-schedule:stable-task:2026-08-19T00:00:00.000Z");
});

test("startup recovers interrupted modern tasks after the durable lease window without changing run identity", async () => {
  const task = baseTask({ status: "running", startedAt: "2026-08-19T00:00:00.000Z" });
  const timers = [];
  const updates = [];
  let receivedKey = "";
  const now = Date.parse("2026-08-19T01:00:00.000Z");
  const scheduler = createResourceSyncScheduler({
    getTasks: async () => [task],
    updateTask: async (id, update) => {
      updates.push({ id, update });
      return { ...task, ...update };
    },
    operations: { full: async ({ idempotencyKey }) => {
      receivedKey = idempotencyKey;
      return { mergedCount: 1 };
    } },
    now: () => now,
    interruptedRetryDelayMs: 31 * 60 * 1000,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {}
  });
  await scheduler.initialize();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.status, "running");
  assert.equal(updates[0].update.lastStatus, "failed");
  assert.equal(Object.hasOwn(updates[0].update, "runAt"), false);
  assert.match(updates[0].update.error, /程序退出.*自动恢复/);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);
  await runTimer(timers[0]);
  assert.equal(receivedKey, "resource-schedule:task-1:2026-08-19T00:00:00.000Z");
});

test("startup waits only for the remainder of an interrupted task lease", async () => {
  const task = baseTask({ status: "running", startedAt: "2026-08-19T00:50:00.000Z" });
  const timers = [];
  const now = Date.parse("2026-08-19T01:00:00.000Z");
  const scheduler = createResourceSyncScheduler({
    getTasks: async () => [task],
    updateTask: async (id, update) => ({ ...task, ...update }),
    operations: { full: async () => ({ mergedCount: 1 }) },
    now: () => now,
    interruptedRetryDelayMs: 31 * 60 * 1000,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {}
  });
  await scheduler.initialize();
  assert.equal(timers[0].delay, 21 * 60 * 1000);
});

test("startup fails closed for interrupted legacy single-OLT tasks", async () => {
  const task = baseTask({ operation: "nmse", oltId: "legacy-olt", status: "running" });
  const updates = [];
  const scheduler = createResourceSyncScheduler({
    getTasks: async () => [task],
    updateTask: async (id, update) => { updates.push({ id, update }); return { ...task, ...update }; },
    now: () => Date.parse("2026-08-19T01:00:00.000Z"),
    setTimeoutFn: () => { throw new Error("legacy task must not be rescheduled"); }
  });
  await scheduler.initialize();
  assert.equal(updates[0].update.status, "failed");
  assert.match(updates[0].update.error, /不会自动重放/);
});

test("authorization failures invalidate only the affected remote sessions", async () => {
  const invalidated = [];
  const timers = [];
  const task = baseTask({ operation: "network" });
  const scheduler = createResourceSyncScheduler({
    getTasks: async () => [],
    updateTask: async (id, update) => ({ ...task, ...update }),
    operations: { network: async () => { throw Object.assign(new Error("expired"), { status: 401 }); } },
    invalidateNmseSession: () => invalidated.push("nmse"),
    invalidateOssSession: () => invalidated.push("oss"),
    now: () => Date.parse("2026-08-19T01:00:00.000Z"),
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {}
  });
  scheduler.schedule(task);
  await runTimer(timers[0]);
  assert.deepEqual(invalidated, ["oss"]);
});
