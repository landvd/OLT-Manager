import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuSubsystem } from "../src/feishu/subsystem.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

function makeStore(initial = undefined) {
  let value = initial;
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

function makeGateway({ fail = false } = {}) {
  return {
    async status() {
      if (fail) throw new Error("gateway unavailable");
      return { contractVersion: "1", readOnly: true, datasetRevision: "rev-1" };
    }
  };
}

test("Feishu subsystem defaults off and persists explicit enable/stop", async () => {
  const store = makeStore();
  const calls = [];
  const subsystem = createFeishuSubsystem({
    stateStore: store,
    gateway: makeGateway(),
    runtimeFactory: () => ({
      async start(options) { calls.push(["start", options]); },
      async stop() { calls.push(["stop"]); },
      status() { return { state: "connected", lastError: null }; }
    })
  });
  assert.equal((await subsystem.initialize()).enabled, false);
  assert.equal((await subsystem.enable({ appId: "cli_test", credentialReference: "keychain:1" })).enabled, true);
  assert.equal(calls[0][0], "start");
  assert.equal((await subsystem.stop()).enabled, false);
  assert.equal(calls[1][0], "stop");
  assert.equal(store.value().enabled, false);
});

test("Feishu connection failure is isolated and enabled state remains reconnectable", async () => {
  const store = makeStore({
    ...emptyFeishuState(),
    enabled: true,
    app: { appId: "cli_test", credentialReference: "keychain:1" }
  });
  const subsystem = createFeishuSubsystem({
    stateStore: store,
    gateway: makeGateway({ fail: true }),
    runtimeFactory: () => ({ async start() { throw new Error("runtime unavailable"); } })
  });
  const status = await subsystem.initialize();
  assert.equal(status.enabled, true);
  assert.equal(status.connection.state, "faulted");
  assert.match(status.connection.lastError, /gateway unavailable/);
  assert.equal(store.value().enabled, true);
});

test("Feishu status reflects a runtime connection established after start returns", async () => {
  const store = makeStore();
  let runtimeState = "connecting";
  const subsystem = createFeishuSubsystem({
    stateStore: store,
    gateway: makeGateway(),
    runtimeFactory: () => ({
      async start() { runtimeState = "connected"; },
      status() { return { state: runtimeState, lastError: null }; }
    })
  });

  await subsystem.initialize();
  await subsystem.enable({ appId: "cli_test", credentialReference: "keychain:1" });
  assert.equal(subsystem.status().connection.state, "connected");
  runtimeState = "reconnecting";
  assert.equal(subsystem.status().connection.state, "reconnecting");
});
