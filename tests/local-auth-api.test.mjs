import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-auth-"));
const { startServer } = await import("../src/server.mjs");

async function jsonRequest(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
}

test("local auth blocks API access until a valid bearer session is established", async (t) => {
  const started = await startServer({ port: 0, authRequired: true, authPassword: "synthetic-local-password" });
  t.after(() => started.server.close());

  const blocked = await jsonRequest(started.url, "/api/admin/olts");
  assert.equal(blocked.response.status, 401);
  assert.equal(blocked.data.code, "AUTH_REQUIRED");

  const wrong = await jsonRequest(started.url, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password" })
  });
  assert.equal(wrong.response.status, 401);

  const login = await jsonRequest(started.url, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: "synthetic-local-password" })
  });
  assert.equal(login.response.status, 200);
  assert.match(login.data.token, /^[A-Za-z0-9_-]{40,}$/);

  const allowed = await jsonRequest(started.url, "/api/admin/olts", {
    headers: { authorization: `Bearer ${login.data.token}` }
  });
  assert.equal(allowed.response.status, 200);
  assert.equal(Array.isArray(allowed.data), true);
  for (const row of allowed.data) {
    assert.equal("readCommunity" in row, false);
    assert.equal("telnetUsername" in row, false);
    assert.equal("telnetPassword" in row, false);
  }
  const bootstrap = await jsonRequest(started.url, "/api/bootstrap", {
    headers: { authorization: `Bearer ${login.data.token}` }
  });
  assert.equal(bootstrap.response.status, 200);
  for (const row of bootstrap.data.olts || []) {
    assert.equal("readCommunity" in row, false);
    assert.equal("telnetUsername" in row, false);
    assert.equal("telnetPassword" in row, false);
  }

  await jsonRequest(started.url, "/api/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${login.data.token}` }
  });
  const afterLogout = await jsonRequest(started.url, "/api/admin/olts", {
    headers: { authorization: `Bearer ${login.data.token}` }
  });
  assert.equal(afterLogout.response.status, 401);
});

test("first-run setup creates the local password without exposing it in the response", async (t) => {
  const authDataDir = await mkdtemp(join(tmpdir(), "olt-manager-auth-setup-"));
  const started = await startServer({ port: 0, authRequired: true, authDataDir });
  t.after(() => started.server.close());

  const session = await jsonRequest(started.url, "/api/auth/session");
  assert.equal(session.data.configured, false);

  const setup = await jsonRequest(started.url, "/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ password: "synthetic-first-run-password" })
  });
  assert.equal(setup.response.status, 200);
  assert.equal("password" in setup.data, false);
  assert.match(setup.data.token, /^[A-Za-z0-9_-]{40,}$/);
});

test("non-loopback startup fails closed until a password is configured", async () => {
  const authDataDir = await mkdtemp(join(tmpdir(), "olt-manager-auth-network-"));
  await assert.rejects(
    () => startServer({ host: "0.0.0.0", port: 0, authRequired: true, authDataDir }),
    /非回环地址启动前必须先配置本地登录密码/
  );
});

test("non-loopback startup cannot opt out of authentication", async () => {
  const authDataDir = await mkdtemp(join(tmpdir(), "olt-manager-auth-network-optout-"));
  await assert.rejects(
    () => startServer({ host: "0.0.0.0", port: 0, authRequired: false, testBypass: false, authDataDir }),
    /非回环地址禁止关闭本地登录认证/
  );
});

test("loopback debug mode can disable and re-enable the local password", async (t) => {
  const authDataDir = await mkdtemp(join(tmpdir(), "olt-manager-auth-toggle-"));
  const started = await startServer({ port: 0, authRequired: true, authPassword: "synthetic-toggle-password", authDataDir });
  t.after(() => started.server.close());

  const login = await jsonRequest(started.url, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: "synthetic-toggle-password" })
  });
  const token = login.data.token;
  const blockedToggle = await jsonRequest(started.url, "/api/auth/settings", { method: "POST", body: JSON.stringify({ enabled: false }) });
  assert.equal(blockedToggle.response.status, 401);

  const disabled = await jsonRequest(started.url, "/api/auth/settings", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: false })
  });
  assert.deepEqual(disabled.data, { ok: true, required: false });
  const openSession = await jsonRequest(started.url, "/api/auth/session");
  assert.equal(openSession.data.required, false);
  assert.equal(openSession.data.authenticated, true);
  assert.equal((await jsonRequest(started.url, "/api/admin/olts")).response.status, 200);

  const enabled = await jsonRequest(started.url, "/api/auth/settings", { method: "POST", body: JSON.stringify({ enabled: true }) });
  assert.deepEqual(enabled.data, { ok: true, required: true });
  const closedSession = await jsonRequest(started.url, "/api/auth/session");
  assert.equal(closedSession.data.required, true);
  assert.equal(closedSession.data.authenticated, false);
  assert.equal((await jsonRequest(started.url, "/api/admin/olts")).response.status, 401);
  assert.equal(JSON.parse(await readFile(join(authDataDir, "auth.json"))).enabled, true);
});

test("disabled debug mode cannot start on a non-loopback host", async () => {
  const authDataDir = await mkdtemp(join(tmpdir(), "olt-manager-auth-toggle-network-"));
  const local = await startServer({ port: 0, authRequired: true, authPassword: "synthetic-toggle-password", authDataDir });
  const login = await jsonRequest(local.url, "/api/auth/login", { method: "POST", body: JSON.stringify({ password: "synthetic-toggle-password" }) });
  await jsonRequest(local.url, "/api/auth/settings", {
    method: "POST",
    headers: { authorization: `Bearer ${login.data.token}` },
    body: JSON.stringify({ enabled: false })
  });
  await new Promise((resolve) => local.server.close(resolve));
  await assert.rejects(
    () => startServer({ host: "0.0.0.0", port: 0, authRequired: true, authDataDir }),
    /非回环地址禁止使用免登录调试模式/
  );
});
