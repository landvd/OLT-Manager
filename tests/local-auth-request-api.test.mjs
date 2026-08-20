import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAuthApi } from "../src/local-auth-api.mjs";

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

test("local auth request API centralizes session, settings, login, and bootstrap contracts", async () => {
  const calls = [];
  const api = createLocalAuthApi({ fetch: async (...args) => { calls.push(args); return response({ configured: true, required: true, authenticated: true, token: "session-token", olts: [] }); } });
  assert.equal((await api.session("session-token")).authenticated, true);
  await api.updateRequirement(false, "session-token");
  await api.authenticate({ setupRequired: false, password: "test-password" });
  await api.bootstrap();
  assert.equal(calls[0][0], "/api/auth/session");
  assert.deepEqual(calls[0][1], { headers: { authorization: "Bearer session-token" } });
  assert.deepEqual(calls[1][1], { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer session-token" }, body: JSON.stringify({ enabled: false }) });
  assert.equal(calls[2][0], "/api/auth/login");
  assert.deepEqual(calls[2][1], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "test-password" }) });
  assert.equal(calls[3][0], "/api/bootstrap");
});

test("local auth request API uses setup endpoint and preserves server errors", async () => {
  const setup = createLocalAuthApi({ fetch: async () => response({ token: "setup-token" }) });
  await assert.doesNotReject(setup.authenticate({ setupRequired: true, password: "test-password" }));
  const failed = createLocalAuthApi({ fetch: async () => response({ error: "登录保护设置失败。" }, false) });
  await assert.rejects(failed.updateRequirement(true), /登录保护设置失败/);
  assert.throws(() => createLocalAuthApi({ fetch: null }), /requires fetch/);
});
