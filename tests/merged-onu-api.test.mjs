import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-merged-api-"));
const { startServer } = await import("../src/server.mjs");
const db = await import("../src/db.mjs");

function json(res, body, headers = {}) {
  res.writeHead(200, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function dwrReply(value) {
  return `throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleCallback('0','0',${JSON.stringify(value)});`;
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
}

async function startNmseFixture(host, events) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/proxy/api/login") return json(res, { header: { opCode: "1", token: "NMSE-TOKEN-SHOULD-NOT-RETURN" }, body: { data: { loginname: "synthetic-operator", id: "NMSE-USER-CUID", type: "admin" } } }, { "set-cookie": "sid=nmse-memory-only; HttpOnly" });
    if (url.pathname === "/grid/getGridNode") return json(res, { header: { opCode: "1" }, body: { data: { gridList: [{ rank: "root-1" }] } } });
    if (url.pathname === "/resource/getOltList") return json(res, { header: { opCode: "1" }, body: { data: { list: [{ ip: host, gridRank: "nmse-grid-1" }] } } });
    if (url.pathname === "/config/ConfigurationManagement") return res.end("ok");
    if (url.pathname === "/onu/getOnuListByGridRank") {
      events.push("nmse");
      return json(res, { header: { opCode: "1" }, body: { data: { TotalCount: 1, list: [{ onuIndexName: "1/8/4:56", loid: "LOID-MOVED", username: "黄雁", mac: "NMSE-MAC-MUST-NOT-WIN", usertel: "NMSE-PHONE-MUST-NOT-WIN", useraddr: "NMSE-ADDRESS-MUST-NOT-WIN" }] } } });
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function startOssFixture(events) {
  let treeCalls = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (url.pathname.endsWith("/loginCheck")) return json(res, { data: { orgList: [{ RELATED_ORG_CUID: "OSS-ORG-CUID", DB_NAME: "synthetic-db" }] } });
      if (url.pathname.endsWith("/login")) return json(res, { data: { uid: "OSS-UID-SHOULD-NOT-RETURN", token: "OSS-TOKEN-SHOULD-NOT-RETURN" } }, { "set-cookie": ["auth=oss-memory-only; HttpOnly"] });
      if (url.pathname.endsWith("/transfer.do")) {
        res.writeHead(302, { location: "/ngb/;jsessionid=oss-memory-only" });
        return res.end();
      }
      if (url.pathname === "/ngb/;jsessionid=oss-memory-only" && !String(req.headers.cookie || "").includes("JSESSIONID=oss-memory-only")) {
        res.writeHead(401);
        return res.end("session cookie required");
      }
      if (url.pathname === "/ngb/;jsessionid=oss-memory-only" || url.pathname.endsWith("/FrameAction/index.do") || url.pathname.endsWith("/devconfig.jsp") || url.pathname.endsWith("/ResDevAction/config.do")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("shell");
      }
      if (url.pathname.endsWith("/engine.js")) {
        res.writeHead(200, { "content-type": "text/javascript", "set-cookie": ["JSESSIONID=oss-memory-only; Path=/"] });
        return res.end("dwr.engine._origScriptSessionId = 'OSS-SESSION';");
      }
      if (url.pathname.includes("TreePanelAction.loadData")) {
        const level = (treeCalls++) % 4;
        const value = level === 0
          ? [{ cuid: "OSS-PROVINCE", text: "省", leaf: false }]
          : level === 1
            ? [{ cuid: "OSS-ORG-CUID", text: "测试分公司", leaf: false }]
            : [{ cuid: "OSS-ROOM-CUID", text: "测试机房", leaf: true }];
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply(value));
      }
      if (url.pathname.includes("getGridPageInfo")) {
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply({ totalCount: 1 }));
      }
      if (url.pathname.includes("getGridData") && body.includes("OnuGridBO")) {
        events.push("network");
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply({ list: [{ DEVNAME: "ZTE-GPON 1/3/6:7", STB_SN: "1025001242801035724", LOID: "LOID-MOVED", USER_NAME: "残缺姓名", ONUMACADDRESS: "NETWORK-MAC", CUID: "ONU-CUID-SHOULD-NOT-RETURN", FDN: "ONU-FDN-SHOULD-NOT-RETURN", PASSWORD: "ONU-PASSWORD-SHOULD-NOT-RETURN" }] }));
      }
      if (url.pathname.includes("getGridData") && body.includes("res.logic.RES_DEV.OLT")) {
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply({ list: [{ IP: "198.51.100.10", CUID: "REMOTE-OLT-CUID", N_RELATED_ROOM_CUID: "测试机房" }] }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("merged ONU API reads network first, merges NMSE by LOID, and keeps old snapshots on failure", async (t) => {
  const events = [];
  const app = await startServer({ port: 0 });
  const oss = await startOssFixture(events);
  t.after(() => app.server.close());
  t.after(() => oss.server.close());

  const olt = (await requestJson(app.url, "/api/admin/olts")).data[0];
  const allOlts = await db.getOlts();
  await db.replaceOlts(allOlts.map((item) => ({ ...item, enabled: item.id === olt.id })), "test-merged-full-sync");
  const nmse = await startNmseFixture(olt.host, events);
  t.after(() => nmse.server.close());
  await db.replaceResourceOltIpMappings([{ resourceIp: "198.51.100.10", oltIp: olt.host }]);
  await db.replaceResourceUsers({ oltIp: olt.host, gridRank: "old-grid", rows: [{ onuIndexName: "1/3/6:7", username: "旧表用户" }] });

  await requestJson(app.url, "/api/admin/resource-management/config", {
    method: "PUT",
    body: JSON.stringify({ serverUrl: nmse.url, username: "synthetic-operator", password: "synthetic-password", migrationMasterPassword: "synthetic-master-password" })
  });
  await requestJson(app.url, "/api/admin/oss-resource/config", {
    method: "PUT",
    body: JSON.stringify({ authBaseUrl: oss.url, ngbBaseUrl: oss.url, username: "synthetic-operator", organizationName: "测试分公司", roomName: "测试机房" })
  });
  assert.equal((await requestJson(app.url, "/api/admin/resource-management/login", { method: "POST" })).response.status, 200);
  assert.equal((await requestJson(app.url, "/api/admin/oss-resource/login", { method: "POST", body: JSON.stringify({ password: "synthetic-password", migrationMasterPassword: "synthetic-master-password" }) })).response.status, 200);

  const networkOnly = await requestJson(app.url, "/api/admin/merged-onu/sync/network", { method: "POST", body: JSON.stringify({}) });
  assert.equal(networkOnly.response.status, 200, JSON.stringify(networkOnly.data));
  assert.equal(networkOnly.data.count, 1);
  assert.deepEqual(events, ["network"]);
  await db.replaceResourceOltIpMappings([]);
  const nmseOnly = await requestJson(app.url, "/api/admin/merged-onu/sync/nmse", { method: "POST", body: JSON.stringify({}) });
  assert.equal(nmseOnly.response.status, 200, JSON.stringify(nmseOnly.data));
  assert.equal(nmseOnly.data.count, 1);
  assert.deepEqual(events, ["network", "nmse"]);
  const rawUsers = await db.getResourceUsers({ oltIp: olt.host });
  assert.equal(rawUsers[0].username, "黄雁");
  assert.equal(rawUsers[0].userPhone, "NMSE-PHONE-MUST-NOT-WIN");
  assert.equal(rawUsers[0].installationAddress, "NMSE-ADDRESS-MUST-NOT-WIN");
  assert.equal(rawUsers[0].onuIndex, "1/8/4:56");
  const manualMerge = await requestJson(app.url, "/api/admin/merged-onu/merge", { method: "POST", body: JSON.stringify({}) });
  assert.equal(manualMerge.response.status, 200, JSON.stringify(manualMerge.data));
  assert.equal(manualMerge.data.mergedCount, 1);
  const mergedRows = await db.getMergedOnuSnapshots({ oltIp: olt.host });
  assert.equal(mergedRows[0].userPhone, "NMSE-PHONE-MUST-NOT-WIN");
  assert.equal(mergedRows[0].installationAddress, "NMSE-ADDRESS-MUST-NOT-WIN");
  const mergedSnapshots = await requestJson(app.url, "/api/admin/merged-onu/snapshots?q=1025001242801035724");
  assert.equal(mergedSnapshots.response.status, 200);
  assert.equal(mergedSnapshots.data.rows[0].deviceNumber, "1025001242801035724");
  assert.deepEqual(events, ["network", "nmse"]);
  const sourceStatus = (await requestJson(app.url, "/api/admin/merged-onu/status")).data.sources;
  assert.equal(sourceStatus.network.synced, true);
  assert.equal(sourceStatus.nmse.synced, true);

  await db.replaceResourceOltIpMappings([{ resourceIp: "198.51.100.10", oltIp: olt.host }]);
  const eventCountBeforeScopedRequest = events.length;
  const scopedSync = await requestJson(app.url, "/api/admin/merged-onu/sync", { method: "POST", body: JSON.stringify({ oltId: olt.id }) });
  assert.equal(scopedSync.response.status, 400);
  assert.match(scopedSync.data.error, /仅支持全量同步/);
  assert.equal(events.length, eventCountBeforeScopedRequest);
  const sync = await requestJson(app.url, "/api/admin/merged-onu/sync", { method: "POST", body: JSON.stringify({}) });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.data));
  assert.equal(sync.data.mergedCount, 1);
  assert.equal(sync.data.conflictCount, 0);
  assert.deepEqual(events.slice(-2), ["network", "nmse"]);
  assert.doesNotMatch(JSON.stringify(sync.data), /CUID|FDN|PASSWORD|TOKEN|COOKIE|REMOTE-OLT|ONU-CUID/i);

  const gatewayResult = await app.gateway.queryUsers({ intent: "find_by_name", value: "黄雁", oltIds: [olt.id] });
  assert.equal(gatewayResult.candidates[0].name, "黄雁");
  assert.equal(gatewayResult.candidates[0].onu.onuId, "7");
  assert.equal(gatewayResult.candidates[0].mac, "NETWORK-MAC");
  assert.equal(gatewayResult.candidates[0].phone, "NMSE-PHONE-MUST-NOT-WIN");
  assert.equal(gatewayResult.candidates[0].address, "NMSE-ADDRESS-MUST-NOT-WIN");
  assert.doesNotMatch(JSON.stringify(gatewayResult), /NMSE-MAC|CUID|FDN|TOKEN|COOKIE/i);

  const status = await requestJson(app.url, "/api/admin/merged-onu/status");
  assert.equal(status.data.synced, true);
  assert.equal(status.data.snapshotCount, 1);
  const progress = await requestJson(app.url, "/api/admin/merged-onu/sync/progress");
  assert.equal(progress.data.status, "success");
  const runs = await requestJson(app.url, "/api/admin/merged-onu/runs");
  assert.equal(runs.data.rows[0].status, "success");
  assert.doesNotMatch(JSON.stringify(runs.data), /REMOTE-OLT|CUID|FDN|TOKEN|COOKIE/i);

  await db.replaceResourceOltIpMappings([]);
  const failed = await requestJson(app.url, "/api/admin/merged-onu/sync", { method: "POST", body: JSON.stringify({}) });
  assert.equal(failed.response.status, 409);
  assert.match(failed.data.error, /IP 映射/);
  const afterFailure = await db.getMergedOnuSnapshots({ oltIp: olt.host });
  assert.equal(afterFailure[0].username, "黄雁");
  assert.equal((await requestJson(app.url, "/api/admin/merged-onu/status")).data.synced, true);
});
