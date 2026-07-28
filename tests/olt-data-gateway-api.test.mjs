import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-gateway-api-"));
const { replaceResourceUsers } = await import("../src/db.mjs");
const { startServer } = await import("../src/server.mjs");

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  return { response, body: await response.json() };
}

test("versioned gateway is disabled without a token and rejects missing credentials", async (t) => {
  const disabled = await startServer({ port: 0 });
  t.after(() => disabled.server.close());
  assert.equal((await request(disabled.url, "/api/gateway/v1/status")).response.status, 503);

  const enabled = await startServer({ port: 0, gatewayToken: "synthetic-test-token" });
  t.after(() => enabled.server.close());
  assert.equal((await request(enabled.url, "/api/gateway/v1/status")).response.status, 401);
  const accepted = await request(enabled.url, "/api/gateway/v1/status", { headers: { authorization: "Bearer synthetic-test-token" } });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.contractVersion, "1");
  assert.equal(accepted.body.readOnly, true);
});

test("gateway remains disabled when the general UI server listens beyond loopback", async (t) => {
  const started = await startServer({ host: "0.0.0.0", port: 0, gatewayToken: "synthetic-test-token" });
  t.after(() => started.server.close());
  const baseUrl = `http://127.0.0.1:${started.port}`;
  const result = await request(baseUrl, "/api/gateway/v1/status", {
    headers: { authorization: "Bearer synthetic-test-token" }
  });
  assert.equal(result.response.status, 503);
});

test("gateway query accepts only scoped searches and exposes no infrastructure secrets", async (t) => {
  const started = await startServer({ port: 0, gatewayToken: "synthetic-test-token" });
  t.after(() => started.server.close());
  const auth = { authorization: "Bearer synthetic-test-token" };
  const inventory = await request(started.url, "/api/gateway/v1/olts", { headers: auth });
  const olt = inventory.body.olts[0];
  const adminOlts = await request(started.url, "/api/bootstrap");
  const host = adminOlts.body.olts.find((item) => item.id === olt.oltId).host;
  await replaceResourceUsers({
    oltIp: host,
    gridRank: "synthetic-grid",
    rows: [{ onuIndexName: "1/1/2:1", username: "合成测试用户", usertel: "13800000000", useraddr: "合成测试地址", loid: "SYNTHETIC-LOID", mac: "00:00:00:00:00:01" }]
  });

  const result = await request(started.url, "/api/gateway/v1/users/query", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ intent: "find_by_name", value: "合成测试", oltIds: [olt.oltId] })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.authorizedCount, 1);
  assert.equal(result.body.candidates[0].name, "合成测试用户");
  assert.doesNotMatch(JSON.stringify(result.body), /192\.168|community|password|gridRank/);

  const unscoped = await request(started.url, "/api/gateway/v1/users/query", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ intent: "find_by_name", value: "合成测试", oltIds: [] })
  });
  assert.equal(unscoped.response.status, 400);
  assert.match(unscoped.body.error, /OLT scope/);
});
