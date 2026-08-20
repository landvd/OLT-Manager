import test from "node:test";
import assert from "node:assert/strict";
import { createServerRequestHandler } from "../src/server-request-handler.mjs";

function harness(overrides = {}) {
  const calls = [];
  const responses = [];
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  const handler = createServerRequestHandler({
    auth: { async authenticate() { calls.push("authenticate"); return { ok: true }; }, ...overrides.auth },
    handleAuthRoutes: async (_req, _res, url) => calls.push(["auth", url.pathname]),
    handleApi: async (_req, _res, url) => calls.push(["api", url.pathname]),
    serveStatic: async (_req, _res, url) => calls.push(["static", url.pathname]),
    json: (target, status, body) => responses.push({ target, status, body })
  });
  return { handler, calls, responses, res };
}

test("server request handler preserves auth-first and API-before-static ordering", async () => {
  const state = harness();
  await state.handler({ method: "GET", url: "/api/auth/session", headers: { host: "127.0.0.1" } }, state.res);
  await state.handler({ method: "GET", url: "/api/status", headers: { host: "127.0.0.1" } }, state.res);
  await state.handler({ method: "GET", url: "/index.html", headers: { host: "127.0.0.1" } }, state.res);
  assert.deepEqual(state.calls, [["auth", "/api/auth/session"], "authenticate", ["api", "/api/status"], ["static", "/index.html"]]);
});

test("server request handler rejects unauthenticated APIs and converts errors to JSON", async () => {
  const state = harness({ auth: { async authenticate() { return { ok: false, code: "AUTH_REQUIRED" }; } } });
  await state.handler({ method: "GET", url: "/api/status", headers: { host: "127.0.0.1" } }, state.res);
  assert.equal(state.res.headers["www-authenticate"], "Bearer");
  assert.deepEqual(state.responses[0], { target: state.res, status: 401, body: { ok: false, code: "AUTH_REQUIRED", error: "请先登录本地管理系统。" } });

  const failed = harness();
  failed.handler = createServerRequestHandler({
    auth: { async authenticate() { throw Object.assign(new Error("请求失败"), { statusCode: 503 }); } },
    handleAuthRoutes: async () => {},
    handleApi: async () => {},
    serveStatic: async () => {},
    json: (target, status, body) => failed.responses.push({ target, status, body })
  });
  await failed.handler({ method: "GET", url: "/api/status", headers: { host: "127.0.0.1" } }, failed.res);
  assert.equal(failed.responses[0].status, 503);
  assert.deepEqual(failed.responses[0].body, { error: "请求失败" });
  assert.throws(() => createServerRequestHandler({}), /requires handleAuthRoutes/);
});
