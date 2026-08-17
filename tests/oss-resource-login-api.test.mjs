import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-oss-login-api-"));
const { startServer } = await import("../src/server.mjs");
const { OssNgbClient } = await import("../src/oss-ngb-client.mjs");

function dwrReply(value) {
  return `throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleCallback('0','0',${JSON.stringify(value)});`;
}

function json(res, body, headers = {}) {
  res.writeHead(200, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
}

async function startOssFixture() {
  const requests = [];
  let treeCalls = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, url: url.toString(), body, headers: req.headers });

      if (url.pathname.endsWith("/loginCheck")) {
        return json(res, { data: { orgList: [{ RELATED_ORG_CUID: "LOGIN-ORG", DB_NAME: "db" }] } });
      }
      if (url.pathname.endsWith("/login")) {
        const payload = JSON.parse(body || "{}");
        if (payload.password !== createHash("md5").update("test-only-secret").digest("hex")) {
          return json(res, { status: "error", message: "invalid password" });
        }
        return json(res, { data: { uid: "uid-only-in-memory", token: "token-only-in-memory" } }, { "set-cookie": ["auth=memory-only; HttpOnly"] });
      }
      if (url.pathname.endsWith("/transfer.do")) {
        res.writeHead(302, { location: "/ngb/;jsessionid=memory-only" });
        return res.end();
      }
      if (url.pathname === "/ngb/;jsessionid=memory-only" && !String(req.headers.cookie || "").includes("JSESSIONID=memory-only")) {
        res.writeHead(401);
        return res.end("session cookie required");
      }
      if (url.pathname === "/ngb/;jsessionid=memory-only" || url.pathname.endsWith("/FrameAction/index.do") || url.pathname.endsWith("/devconfig.jsp")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("shell");
      }
      if (url.pathname.endsWith("/engine.js")) {
        res.writeHead(200, { "content-type": "text/javascript", "set-cookie": ["JSESSIONID=memory-only; Path=/"] });
        return res.end("dwr.engine._origScriptSessionId = 'ORIGINAL-SESSION';");
      }
      if (url.pathname.includes("TreePanelAction.loadData")) {
        treeCalls += 1;
        const level = (treeCalls - 1) % 4;
        const value = level === 0
          ? [{ cuid: "PROVINCE", text: "省", leaf: false }]
          : level === 1
            ? [{ cuid: "ORG-CUID", text: "测试分公司", leaf: false }]
            : [{ cuid: "ROOM-CUID", text: "测试机房", leaf: true }];
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply(value));
      }
      if (url.pathname.includes("getGridPageInfo")) {
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply({ totalCount: 1 }));
      }
      if (url.pathname.includes("getGridData") && body.includes("res.logic.RES_DEV.OLT")) {
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(dwrReply({ list: [{ IP: "192.0.2.10", CUID: "OLT-CUID", N_RELATED_ROOM_CUID: "测试机房", PASSWORD: "must-discard" }] }));
      }
      res.writeHead(404);
      return res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, requests };
}

test("OSS 登录 API follows the successful page session baseline through OLT discovery", async (t) => {
  const app = await startServer({ port: 0 });
  const oss = await startOssFixture();
  t.after(() => app.server.close());
  t.after(() => oss.server.close());

  const config = await requestJson(app.url, "/api/admin/oss-resource/config", {
    method: "PUT",
    body: JSON.stringify({
      authBaseUrl: oss.url,
      ngbBaseUrl: oss.url,
      username: "operator",
      organizationName: "测试分公司",
      roomName: "测试机房"
    })
  });
  assert.equal(config.response.status, 200);

  const login = await requestJson(app.url, "/api/admin/oss-resource/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-secret", migrationMasterPassword: "migration-master-only" })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  assert.deepEqual(login.data, {
    ok: true,
    credentialConfigured: true,
    oltCount: 1,
    olts: [{ resourceIp: "192.0.2.10", roomName: "测试机房" }]
  });
  assert.doesNotMatch(JSON.stringify(login.data), /test-only-secret|token-only-in-memory|uid-only-in-memory/);
  assert.doesNotMatch(JSON.stringify(login.data), /ROOM-CUID|ORG-CUID/);

  const configAfterSave = await requestJson(app.url, "/api/admin/oss-resource/config");
  assert.equal(configAfterSave.response.status, 200);
  assert.equal(configAfterSave.data.credentialConfigured, true);
  assert.doesNotMatch(JSON.stringify(configAfterSave.data), /test-only-secret|migration-master-only|ciphertext|salt|authTag/);

  await requestJson(app.url, "/api/admin/oss-resource/logout", { method: "POST" });
  const reusedLogin = await requestJson(app.url, "/api/admin/oss-resource/login", {
    method: "POST",
    body: JSON.stringify({ migrationMasterPassword: "migration-master-only" })
  });
  assert.equal(reusedLogin.response.status, 200, JSON.stringify(reusedLogin.data));
  assert.equal(reusedLogin.data.credentialConfigured, true);

  const backup = await fetch(`${app.url}/api/admin/backup`);
  const backupBytes = Buffer.from(await backup.arrayBuffer());
  assert.equal(backup.status, 200);
  assert.equal(backupBytes.includes(Buffer.from("test-only-secret")), false);
  assert.equal(backupBytes.includes(Buffer.from("migration-master-only")), false);

  const restored = await fetch(`${app.url}/api/admin/restore`, {
    method: "POST",
    headers: { "content-type": "application/vnd.sqlite3" },
    body: backupBytes
  });
  assert.equal(restored.status, 200);
  const configAfterRestore = await requestJson(app.url, "/api/admin/oss-resource/config");
  assert.equal(configAfterRestore.data.credentialConfigured, true);

  const pageRequests = oss.requests.filter((item) => /FrameAction\/index\.do|devconfig\.jsp/.test(item.url));
  assert.equal(pageRequests.length, 4);
  assert.equal(new Set(pageRequests.map((item) => new URL(item.url).searchParams.get("_version")).filter(Boolean)).size, 2);
  assert.equal(pageRequests[0].headers["user-agent"], "OLT-Manager OSS read-only client");

  const dwrRequests = oss.requests.filter((item) => item.url.includes("/dwr/call/"));
  assert.ok(dwrRequests.length >= 5);
  assert.match(dwrRequests[0].body, /batchId=0/);
  assert.match(dwrRequests[0].body, /^httpSessionId=$/m);
  assert.match(dwrRequests[0].body, /scriptSessionId=ORIGINAL-SESSION\d+/);
  assert.match(dwrRequests[1].body, /batchId=1/);
  assert.match(dwrRequests[2].body, /batchId=2/);
  const oltDataRequest = dwrRequests.find((item) => item.body.includes("res.logic.RES_DEV.OLT") && item.url.includes("getGridData"));
  assert.ok(oltDataRequest);
  assert.match(oltDataRequest.body, /ROOM-CUID/);
  assert.doesNotMatch(dwrRequests[0].body, /%E6%B5%8B%E8%AF%95%E5%88%86%E5%85%AC%E5%8F%B8/);
  const rewrittenLanding = oss.requests.find((item) => item.url.includes("/ngb/;jsessionid=memory-only"));
  assert.match(rewrittenLanding.headers.cookie || "", /JSESSIONID=memory-only/);
  assert.match(dwrRequests[0].headers.cookie || "", /JSESSIONID=memory-only/);
  assert.doesNotMatch(JSON.stringify(oss.requests), /api\/admin\/user\/(info|auth)|access-token|access-uid|authorization/);
});

test("OSS redirects stay on the original origin before following sensitive URLs", async () => {
  let requestedExternal = false;
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target) => {
      const url = new URL(target);
      if (url.pathname.endsWith("/loginCheck")) {
        return { status: 200, headers: {}, text: JSON.stringify({ data: { orgList: [{ DB_NAME: "db" }] } }) };
      }
      if (url.pathname.endsWith("/login")) {
        return { status: 200, headers: {}, text: JSON.stringify({ data: { uid: "uid", token: "secret" } }) };
      }
      if (new URL(target).origin === "http://external.example.test") requestedExternal = true;
      return { status: 302, headers: { location: "http://external.example.test/leak" }, text: "" };
    }
  });
  await assert.rejects(
    () => client.login({ username: "operator", password: "secret", organizationName: "", roomName: "" }),
    /必须保持在原认证服务器内/
  );
  assert.equal(requestedExternal, false);
});
