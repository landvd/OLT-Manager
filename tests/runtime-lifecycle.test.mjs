import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeLifecycle, RUNTIME_LIFECYCLE_STATES } from "../src/runtime-lifecycle.mjs";

function fakeServer({ closeDelayMs = 0 } = {}) {
  let listening = true;
  let closeCalls = 0;
  let closeAllConnectionsCalls = 0;
  return {
    get listening() { return listening; },
    get closeCalls() { return closeCalls; },
    get closeAllConnectionsCalls() { return closeAllConnectionsCalls; },
    close(callback) {
      closeCalls += 1;
      setTimeout(() => {
        listening = false;
        callback?.();
      }, closeDelayMs);
    },
    closeAllConnections() {
      closeAllConnectionsCalls += 1;
      listening = false;
    }
  };
}

test("lifecycle starts, stores a server handle, and reaches closed", async () => {
  const server = fakeServer();
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 100 });
  assert.equal(lifecycle.getState(), RUNTIME_LIFECYCLE_STATES.STARTING);

  const handle = await lifecycle.start(async () => ({ server, url: "http://127.0.0.1:0" }));
  assert.equal(lifecycle.getState(), RUNTIME_LIFECYCLE_STATES.READY);
  assert.equal(lifecycle.getHandle(), handle);
  assert.equal(lifecycle.snapshot().signal.aborted, false);

  const result = await lifecycle.close();
  assert.equal(result.state, RUNTIME_LIFECYCLE_STATES.CLOSED);
  assert.equal(server.closeCalls, 1);
  assert.equal(lifecycle.getState(), RUNTIME_LIFECYCLE_STATES.CLOSED);
});

test("close is idempotent and force closes active connections", async () => {
  const server = fakeServer({ closeDelayMs: 10 });
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 100 });
  await lifecycle.start(async () => ({ server }));

  const [first, second] = await Promise.all([
    lifecycle.close({ force: true }),
    lifecycle.close({ force: true })
  ]);
  assert.equal(first, second);
  assert.equal(server.closeCalls, 1);
  assert.equal(server.closeAllConnectionsCalls, 1);
  assert.equal(lifecycle.snapshot().signal.aborted, true);
});

test("startup failure aborts and closes the lifecycle", async () => {
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 100 });
  await assert.rejects(
    lifecycle.start(async () => { throw new Error("startup failed"); }),
    /startup failed/
  );
  assert.equal(lifecycle.getState(), RUNTIME_LIFECYCLE_STATES.CLOSED);
  assert.equal(lifecycle.snapshot().signal.aborted, true);
  assert.equal(lifecycle.snapshot().abortReason, "startup-failed");
});

test("a hanging server is force-closed after the timeout", async () => {
  const server = fakeServer({ closeDelayMs: 100 });
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 5 });
  await lifecycle.start(async () => ({ server }));

  const result = await lifecycle.close();
  assert.equal(result.timedOut, true);
  assert.equal(server.closeAllConnectionsCalls, 1);
  assert.equal(lifecycle.getState(), RUNTIME_LIFECYCLE_STATES.CLOSED);
});

test("abort marks the CLI boundary before closing the temporary server", async () => {
  const server = fakeServer();
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 100 });
  await lifecycle.start(async ({ signal }) => {
    assert.equal(signal, lifecycle.signal);
    return { server, url: "http://127.0.0.1:0" };
  });
  lifecycle.abort("interrupted");
  assert.equal(lifecycle.signal.aborted, true);
  assert.equal(lifecycle.signal.reason, "interrupted");
  const result = await lifecycle.close({ force: true, abort: false });
  assert.equal(result.state, RUNTIME_LIFECYCLE_STATES.CLOSED);
  assert.equal(server.closeAllConnectionsCalls, 1);
});

test("close during startup aborts, waits for the handle, and cleans it once", async () => {
  const server = fakeServer();
  let releaseStartup;
  const startup = new Promise((resolve) => { releaseStartup = () => resolve({ server }); });
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 100 });
  const startPromise = lifecycle.start(async ({ signal }) => {
    assert.equal(signal, lifecycle.signal);
    return startup;
  });

  const closePromise = lifecycle.close({ force: true });
  assert.equal(lifecycle.getState(), RUNTIME_LIFECYCLE_STATES.STARTING);
  assert.equal(lifecycle.signal.reason, "shutdown");
  releaseStartup();

  await assert.rejects(startPromise, { name: "AbortError" });
  const result = await closePromise;
  assert.equal(result.state, RUNTIME_LIFECYCLE_STATES.CLOSED);
  assert.equal(server.closeCalls, 1);
  assert.equal(server.closeAllConnectionsCalls, 1);
});

test("concurrent starts share one startup operation", async () => {
  const server = fakeServer();
  let startCalls = 0;
  const lifecycle = createRuntimeLifecycle({ closeTimeoutMs: 100 });
  const start = () => {
    startCalls += 1;
    return new Promise((resolve) => setTimeout(() => resolve({ server }), 5));
  };
  const [first, second] = await Promise.all([lifecycle.start(start), lifecycle.start(start)]);
  assert.equal(first, second);
  assert.equal(startCalls, 1);
  await lifecycle.close();
});
