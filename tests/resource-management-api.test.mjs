import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-resource-api-"));
const { startServer } = await import("../src/server.mjs");

function json(res, body, headers = {}) {
  res.writeHead(200, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function startNmse(host) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/proxy/api/login") return json(res, { header: { opCode: "1", token: "token-only-in-memory" }, body: { data: { loginname: "operator", id: "user-1", type: "admin" } } }, { "set-cookie": "sid=test; HttpOnly" });
    if (url.pathname === "/grid/getGridNode") return json(res, { header: { opCode: "1" }, body: { data: { gridList: [{ rank: "root-1" }] } } });
    if (url.pathname === "/resource/getOltList") return json(res, { header: { opCode: "1" }, body: { data: { list: [{ ip: host, gridRank: "olt-rank-1" }] } } });
    if (url.pathname === "/config/ConfigurationManagement") return res.end("ok");
    if (url.pathname === "/onu/getOnuListByGridRank") return json(res, { header: { opCode: "1" }, body: { data: { TotalCount: 1, list: [{ onuIndexName: "1/1/2:1", loid: "loid-1", mac: "00:11:22:33:44:55", ponNo: "2", username: "测试用户", usertel: "13800000000", useraddr: "广东省东莞市厚街镇4河田片河田村东莞市厚街镇河田村白石坑45号#" }] } } });
    if (url.pathname === "/olt/getOltSvlanRelationList") return json(res, { header: { opCode: "1" }, body: { data: { ponText: JSON.stringify({ slot1: [{ "2": "1062" }] }) } } });
    if (url.pathname === "/olt/getOltCvlanRelation") return json(res, { header: { opCode: "1" }, body: { data: { beginCVlan: "3301", endCVlan: "4000", distributionType: "1" } } });
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  return { response, data: await response.json() };
}

test("resource management API syncs NMSE users and VLANs without exposing credentials", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());
  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const olt = adminOlts.data[0];
  const nmse = await startNmse(olt.host);
  t.after(() => nmse.server.close());

  await requestJson(started.url, "/api/admin/import-pon-ports", { method: "POST", body: JSON.stringify({ rows: [{ oltIp: olt.host, ponPort: "1/1/2", outerVlan: "1000", address: "本地测试" }] }) });
  const save = await requestJson(started.url, "/api/admin/resource-management/config", { method: "PUT", body: JSON.stringify({ serverUrl: nmse.url, username: "operator", password: "secret" }) });
  assert.equal(save.response.status, 200);
  assert.equal(Object.hasOwn(save.data, "password"), false);
  assert.doesNotMatch(JSON.stringify(save.data), /secret|token-only-in-memory/);

  const login = await requestJson(started.url, "/api/admin/resource-management/login", { method: "POST" });
  assert.equal(login.data.ok, true);
  const users = await requestJson(started.url, "/api/admin/resource-management/sync-users", { method: "POST", body: JSON.stringify({ oltId: olt.id }) });
  assert.equal(users.data.count, 1);
  const userProgress = await requestJson(started.url, `/api/admin/resource-management/sync-users/progress?oltId=${olt.id}`);
  assert.equal(userProgress.data.running, false);
  assert.equal(userProgress.data.received, 1);
  assert.equal(userProgress.data.completedPages, 1);
  const snapshots = await requestJson(started.url, `/api/admin/resource-management/users?oltId=${olt.id}`);
  assert.equal(snapshots.data.rows[0].username, "测试用户");
  assert.equal(snapshots.data.rows[0].installationAddress, "广东省东莞市厚街镇河田村白石坑45号");
  const globalSearch = await requestJson(started.url, "/api/admin/resource-management/users?q=%E6%B5%8B%E8%AF%95%E7%94%A8%E6%88%B7");
  assert.equal(globalSearch.data.rows[0].username, "测试用户");

  const vlans = await requestJson(started.url, "/api/admin/resource-management/sync-vlans", { method: "POST", body: JSON.stringify({ oltId: olt.id }) });
  assert.equal(vlans.data.count, 1);
  assert.equal(vlans.data.snapshot.olt.beginCvlan, "3301");
  assert.equal(vlans.data.snapshot.ports[0].outerVlan, "1062");
});
