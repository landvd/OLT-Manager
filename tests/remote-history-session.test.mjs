import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteHistorySession } from "../src/remote-history-session.mjs";

function fakeClock() {
  let current = 0;
  const timers = [];
  return {
    now: () => current,
    setTimeoutImpl(callback, delay) {
      const timer = { callback, at: current + delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { if (timer) timer.cleared = true; },
    async advance(milliseconds) {
      current += milliseconds;
      for (const timer of timers.filter((item) => !item.cleared && item.at <= current)) {
        timer.cleared = true;
        timer.callback();
      }
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

test("remote history session auto-logs in once and clears after ten minutes", async () => {
  const clock = fakeClock();
  let active = null;
  let loginCalls = 0;
  let clearCalls = 0;
  const session = createRemoteHistorySession({
    getSession: () => active,
    login: async (options) => {
      loginCalls += 1;
      assert.deepEqual(options, { autoLogin: true });
      active = { id: "auto" };
      return active;
    },
    clearSession: async (expected) => {
      assert.equal(active, expected);
      clearCalls += 1;
      active = null;
    },
    ...clock
  });

  const first = await session.ensure();
  const second = await session.ensure();
  assert.equal(first, second);
  assert.equal(loginCalls, 1);
  assert.equal(clearCalls, 0);

  await clock.advance(10 * 60 * 1000);
  assert.equal(active, null);
  assert.equal(clearCalls, 1);
});

test("remote history session shares concurrent auto-login", async () => {
  const clock = fakeClock();
  let active = null;
  let loginCalls = 0;
  let resolveLogin;
  const loginDone = new Promise((resolve) => { resolveLogin = resolve; });
  const session = createRemoteHistorySession({
    getSession: () => active,
    login: async () => {
      loginCalls += 1;
      await loginDone;
      active = { id: "shared" };
      return active;
    },
    clearSession: async () => { active = null; },
    ...clock
  });

  const first = session.ensure();
  const second = session.ensure();
  assert.equal(loginCalls, 1);
  resolveLogin();
  assert.equal((await first).id, "shared");
  assert.equal((await second).id, "shared");
});

test("remote history session does not take ownership of an existing manual session", async () => {
  const clock = fakeClock();
  const manual = { id: "manual" };
  let active = manual;
  let loginCalls = 0;
  let clearCalls = 0;
  const session = createRemoteHistorySession({
    getSession: () => active,
    login: async () => { loginCalls += 1; return { id: "unexpected" }; },
    clearSession: async () => { clearCalls += 1; active = null; },
    ...clock
  });

  assert.equal(await session.ensure(), manual);
  await clock.advance(10 * 60 * 1000);
  assert.equal(active, manual);
  assert.equal(loginCalls, 0);
  assert.equal(clearCalls, 0);
  await session.close();
  assert.equal(active, null);
  assert.equal(clearCalls, 1);
});

test("remote history session invalidation only clears the expected session", async () => {
  const clock = fakeClock();
  let active = { id: "auto" };
  let clearCalls = 0;
  const session = createRemoteHistorySession({
    getSession: () => active,
    login: async () => active,
    clearSession: async (expected) => {
      clearCalls += 1;
      if (active === expected) active = null;
    },
    ...clock
  });

  assert.equal(await session.invalidate({ id: "other" }), false);
  assert.equal(active.id, "auto");
  assert.equal(clearCalls, 0);
  assert.equal(await session.invalidate(active), true);
  assert.equal(active, null);
  assert.equal(clearCalls, 1);
});
