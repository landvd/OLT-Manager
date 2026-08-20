import test from "node:test";
import assert from "node:assert/strict";
import { handleLocalAuthRoutes } from "../src/local-auth-routes.mjs";

function createHarness(overrides = {}) {
  const calls = [];
  const responses = [];
  const auth = {
    isTestBypass: false,
    async authenticate() { return { ok: true, code: "AUTH_OK", expiresAt: 123 }; },
    async isConfigured() { return true; },
    async isEnabled() { return true; },
    async setEnabled(value) { calls.push(["setEnabled", value]); return value !== false; },
    async setup(password) { calls.push(["setup", password]); return { token: "setup-token", expiresAt: 456 }; },
    async login(password) { calls.push(["login", password]); return { token: "login-token", expiresAt: 789 }; },
    async logout() { calls.push(["logout"]); return { ok: true }; },
    ...overrides.auth
  };
  const req = { method: "POST", body: "{}" };
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  const json = (target, status, body) => (responses.push({ target, status, body }), body);
  const readBody = async (request) => JSON.parse(request.body || "{}");
  return { auth, calls, responses, req, res, url: new URL("http://127.0.0.1/api/auth/login"), json, readBody };
}

test("local auth routes preserve fixed login, setup, settings, session and logout responses", async () => {
  const harness = createHarness();
  harness.req.body = JSON.stringify({ password: "test-password" });
  await handleLocalAuthRoutes(harness.req, harness.res, harness.url, harness);
  assert.deepEqual(harness.responses[0].body, { ok: true, token: "login-token", expiresAt: 789 });
  assert.deepEqual(harness.calls, [["login", "test-password"]]);

  harness.req.method = "POST";
  harness.req.body = JSON.stringify({ password: "setup-password" });
  harness.url = new URL("http://127.0.0.1/api/auth/setup");
  await handleLocalAuthRoutes(harness.req, harness.res, harness.url, harness);
  assert.deepEqual(harness.responses[1].body, { ok: true, token: "setup-token", expiresAt: 456 });

  harness.req.body = JSON.stringify({ enabled: false });
  harness.url = new URL("http://127.0.0.1/api/auth/settings");
  await handleLocalAuthRoutes(harness.req, harness.res, harness.url, harness);
  assert.deepEqual(harness.responses[2].body, { ok: true, required: false });

  harness.req.method = "GET";
  harness.url = new URL("http://127.0.0.1/api/auth/session");
  await handleLocalAuthRoutes(harness.req, harness.res, harness.url, harness);
  assert.deepEqual(harness.responses[3].body, { ok: true, authenticated: true, configured: true, required: true, expiresAt: 123, testMode: false });

  harness.req.method = "POST";
  harness.url = new URL("http://127.0.0.1/api/auth/logout");
  await handleLocalAuthRoutes(harness.req, harness.res, harness.url, harness);
  assert.deepEqual(harness.responses[4].body, { ok: true });
});

test("local auth routes fail closed on unauthenticated settings and unmatched paths", async () => {
  const harness = createHarness({ auth: { async authenticate() { return { ok: false, code: "AUTH_REQUIRED" }; } } });
  const handled = await handleLocalAuthRoutes(harness.req, harness.res, new URL("http://127.0.0.1/api/auth/settings"), harness);
  assert.deepEqual(handled, { ok: false, code: "AUTH_REQUIRED", error: "请先登录本地管理系统。" });
  assert.equal(harness.responses[0].status, 401);
  assert.equal(harness.res.headers["www-authenticate"], "Bearer");

  const unmatched = await handleLocalAuthRoutes(harness.req, harness.res, new URL("http://127.0.0.1/not-api"), harness);
  assert.equal(unmatched, false);
  await assert.rejects(() => handleLocalAuthRoutes(harness.req, harness.res, new URL("http://127.0.0.1/api/auth/login"), { auth: harness.auth, readBody: null, json: harness.json }), /requires readBody/);
});
