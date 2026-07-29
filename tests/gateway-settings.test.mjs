import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import gatewaySettingsModule from "../electron/gateway-settings.cjs";

const { createGatewaySettingsStore } = gatewaySettingsModule;

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, "")
  };
}

test("Gateway settings encrypt the token at rest and return only configuration metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olt-gateway-settings-"));
  const store = createGatewaySettingsStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  const saved = await store.save({ port: 8787, token: "synthetic-token-that-is-long-enough-1234" });
  assert.deepEqual(saved, { port: 8787, configured: true, restartRequired: true });
  assert.deepEqual(await store.readPublic(), {
    port: 8787,
    configured: true,
    available: true,
    unavailableReason: null
  });
  assert.equal((await store.readRuntime()).token, "synthetic-token-that-is-long-enough-1234");
  const raw = await readFile(join(directory, "gateway-settings.json"), "utf8");
  assert.doesNotMatch(raw, /synthetic-token/);
});

test("Gateway settings generate a one-time token and retain it when the token field is blank", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olt-gateway-settings-"));
  const store = createGatewaySettingsStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  const generated = await store.generate({ port: 8788 });
  assert.equal(generated.port, 8788);
  assert.equal(generated.configured, true);
  assert.match(generated.generatedToken, /^[a-f0-9]{64}$/);
  const retained = await store.save({ port: 8789, token: "" });
  assert.equal(retained.configured, true);
  assert.equal((await store.readRuntime()).token, generated.generatedToken);
});

test("Gateway settings fail closed for unavailable OS encryption and invalid ports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olt-gateway-settings-"));
  const unavailable = createGatewaySettingsStore({
    dataDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => false }
  });
  await assert.rejects(() => unavailable.save({ port: 8787, token: "x".repeat(32) }), /OS encryption/);
  const store = createGatewaySettingsStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  await assert.rejects(() => store.save({ port: 80, token: "x".repeat(32) }), /port/);
  await assert.rejects(() => store.save({ port: 8787, token: "short" }), /token/);
});

test("an unavailable or changed OS key disables only Gateway without blocking the app", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olt-gateway-settings-"));
  const writer = createGatewaySettingsStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  await writer.save({ port: 8787, token: "synthetic-token-that-is-long-enough-1234" });

  const unavailable = createGatewaySettingsStore({
    dataDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => false }
  });
  const unavailableRuntime = await unavailable.readRuntime();
  assert.equal(unavailableRuntime.port, 8787);
  assert.equal(unavailableRuntime.token, "");
  assert.match(unavailableRuntime.unavailableReason, /disabled/);

  const changedKey = createGatewaySettingsStore({
    dataDirectory: directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      decryptString: () => { throw new Error("changed key"); }
    }
  });
  assert.equal((await changedKey.readRuntime()).token, "");
});
