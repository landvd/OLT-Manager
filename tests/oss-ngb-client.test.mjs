import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  OssNgbClient,
  buildDwrRequestBody,
  normalizeOssBaseUrl,
  normalizeOssOnuRow,
  parseDwrReply
} from "../src/oss-ngb-client.mjs";

function dwrReply(value) {
  return `throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleCallback('0','0',${JSON.stringify(value)});`;
}

test("OSS base URLs are restricted to HTTP(S) origins", () => {
  assert.equal(normalizeOssBaseUrl(" http://oss.example.test/ "), "http://oss.example.test");
  assert.throws(() => normalizeOssBaseUrl("ftp://oss.example.test"), /http 或 https/);
  assert.throws(() => normalizeOssBaseUrl("http://user:secret@oss.example.test"), /http 或 https/);
  assert.throws(() => normalizeOssBaseUrl("http://oss.example.test/path"), /http 或 https/);
});

test("DWR request builder enforces the fixed read-only method allowlist and shared references", () => {
  const sharedFilter = { alias: "D", key: "PREID", relation: "=", type: "string", value: "OLT-CUID" };
  const body = buildDwrRequestBody({
    page: "/ngb/ResDevAction/config.do",
    scriptName: "GridViewAction",
    methodName: "getGridData",
    args: [false, { count: true, start: 0, limit: 100, totalNum: 100 }, {
      cfgParams: { tplName: "res.logic.pon.olt.grid.OnuList" },
      urlParams: { preid: sharedFilter },
      queryParams: { preid: sharedFilter }
    }]
  });

  assert.match(body, /c0-scriptName=GridViewAction/);
  assert.match(body, /c0-methodName=getGridData/);
  assert.match(body, /tplName:reference:c0-e\d+/);
  assert.match(body, /value:reference:c0-e\d+/);
  const sharedReference = body.match(/preid:reference:(c0-e\d+)/)?.[1];
  assert.ok(sharedReference);
  assert.equal(body.match(new RegExp(`preid:reference:${sharedReference}`, "g"))?.length, 2);
  assert.throws(() => buildDwrRequestBody({
    page: "/ngb/",
    scriptName: "GridViewAction",
    methodName: "deleteGridData",
    args: []
  }), /不在只读白名单/);
});

test("DWR reply parser returns callback data without evaluating generated code", () => {
  assert.deepEqual(parseDwrReply(dwrReply({ totalCount: 1, list: [{ RX_OPTICAL: "-22.5" }] })), {
    totalCount: 1,
    list: [{ RX_OPTICAL: "-22.5" }]
  });
  assert.throws(() => parseDwrReply("<html>login</html>"), /无效响应|会话未建立/);
  assert.throws(
    () => parseDwrReply(`throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleException('0','0',{message:'Invalid parameter'});`),
    /拒绝了只读查询：Invalid parameter/
  );
  assert.throws(
    () => parseDwrReply(`throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleException('0','0',{message:'accessToken=abc uid=def JSESSIONID=ghi'});`),
    /accessToken=\[已隐藏\] uid=\[已隐藏\] JSESSIONID=\[已隐藏\]/
  );
});

test("OSS client logs in, discovers a projected OLT and reads projected optical history", async () => {
  const requests = [];
  let treeCalls = 0;
  const requestImpl = async (target, options = {}) => {
    const url = new URL(target);
    const body = String(options.body || "");
    requests.push({ url: url.toString(), method: options.method || "GET", body, headers: options.headers || {} });

    if (url.pathname.endsWith("/loginCheck")) {
      return { status: 200, headers: {}, text: JSON.stringify({ data: { orgList: [{ RELATED_ORG_CUID: "LOGIN-ORG", DB_NAME: "db" }] } }) };
    }
    if (url.pathname.endsWith("/login")) {
      return { status: 200, headers: { "set-cookie": ["auth=memory-only; HttpOnly"] }, text: JSON.stringify({ data: { uid: "uid", token: "token" } }) };
    }
    if (url.pathname.endsWith("/transfer.do")) {
      return {
        status: 200,
        headers: {},
        text: "ok",
        url: "http://ngb.example.test/ngb/;jsessionid=memory-only"
      };
    }
    if (url.pathname.endsWith("/FrameAction/index.do")) return { status: 200, headers: {}, text: "shell" };
    if (url.pathname.endsWith("/devconfig.jsp")) {
      return {
        status: 200,
        headers: {},
        text: "landing",
        url: "http://ngb.example.test/ngb/modules/res/dev/devconfig/devconfig.jsp?_version=1786542493957"
      };
    }
    if (url.pathname.endsWith("/engine.js")) {
      return { status: 200, headers: { "set-cookie": ["JSESSIONID=memory-only; Path=/"] }, text: "ok" };
    }
    if (!url.pathname.includes("/dwr/")) return { status: 200, headers: {}, text: "ok" };

    if (url.pathname.includes("TreePanelAction.loadData")) {
      treeCalls += 1;
      const parentTreeNode = {
        allowDrag: false,
        allowDrop: false,
        authorityControled: false,
        boName: null,
        checked: null,
        children: null,
        cuid: "ROOT",
        data: { BM_CLASS_ID: "DISTRICT", CUID: "ROOT" },
        disabled: false,
        draggable: false,
        expanded: true,
        handler: null,
        hidden: false,
        href: null,
        hrefTarget: null,
        icon: null,
        iconCls: "tree-root",
        indeterminate: null,
        isRoot: true,
        leaf: false,
        params: { templateIds: "d_lv1" },
        parentTreeNode: null,
        qtip: null,
        queryParams: null,
        system: null,
        text: "根节点",
        treeName: "res.devconfig.DevNavTree",
        treeParams: { userId: "operator" }
      };
      const value = treeCalls === 1
        ? [{
            ...parentTreeNode,
            cuid: "PROVINCE",
            text: "省",
            isRoot: false,
            parentTreeNode,
            params: { bmClassId: "DISTRICT", templateIds: "d_lv1", subTableUrls: "" }
          }]
        : treeCalls === 2
          ? [{ cuid: "ORG-CUID", text: "测试分公司", leaf: false }]
          : [{ cuid: "ROOM-CUID", text: "测试机房", leaf: true }];
      return { status: 200, headers: {}, text: dwrReply(value) };
    }
    if (url.pathname.includes("getGridPageInfo")) {
      return { status: 200, headers: {}, text: dwrReply({ totalCount: 1 }) };
    }
    if (body.includes("res.logic.RES_DEV.OLT")) {
      return { status: 200, headers: {}, text: dwrReply({ list: [{ IP: "192.0.2.10", CUID: "OLT-CUID", N_RELATED_ROOM_CUID: "测试机房", PASSWORD: "discard-me" }] }) };
    }
    if (body.includes("res.logic.pon.olt.grid.OnuList")) {
      return { status: 200, headers: {}, text: dwrReply({ list: [{ CUID: "ONU-CUID", ONUDEVICEINDEX: "1/12/10:1", USER_NAME: "discard-me" }] }) };
    }
    if (body.includes("res.logic.RES_DEV.ONU.OPTICAL_HIS")) {
      return { status: 200, headers: {}, text: dwrReply({ list: [{
        REPORT_TIME: Date.UTC(2026, 7, 13, 5, 0, 0),
        RX_OPTICAL: "-22.50",
        TX_OPTICAL: null,
        OLT_RX_OPTICAL: "-21.10",
        LIGHTDECAY: "1.40",
        ONU_PASSWORD: "discard-me"
      }] }) };
    }
    throw new Error(`unexpected DWR request: ${url.pathname}`);
  };

  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl
  });
  const session = await client.login({
    username: "operator",
    password: "plain-secret",
    organizationName: "测试分公司",
    roomName: "测试机房"
  });
  assert.deepEqual(session.olts, [{ resourceIp: "192.0.2.10", cuid: "OLT-CUID", roomName: "测试机房" }]);

  const rows = await client.readHistoricalOptical({
    oltCuid: session.olts[0].cuid,
    coordinate: { chassis: 1, board: 12, pon: 10, onuId: 1 },
    startDate: "2026-08-01",
    endDate: "2026-08-13"
  });
  assert.deepEqual(rows, [{
    reportTime: "2026-08-13T05:00:00.000Z",
    rxOptical: -22.5,
    txOptical: null,
    oltRxOptical: -21.1,
    lightDecay: 1.4
  }]);
  assert.equal(Object.hasOwn(rows[0], "ONU_PASSWORD"), false);

  const combinedBodies = requests.map((request) => request.body).join("\n");
  assert.doesNotMatch(combinedBodies, /plain-secret/);
  assert.match(combinedBodies, new RegExp(createHash("md5").update("plain-secret").digest("hex")));
  const dwrBodies = requests.filter((request) => request.url.includes("/dwr/call/")).map((request) => request.body);
  const scriptSessions = dwrBodies.map((body) => body.match(/^scriptSessionId=(.*)$/m)?.[1]);
  assert.equal(new Set(scriptSessions).size, 1);
  assert.equal(scriptSessions[0].length, 35);
  assert.match(dwrBodies[0], /page=\/ngb\/modules\/res\/dev\/devconfig\/devconfig\.jsp\?_version=\d+/);
  assert.match(dwrBodies[0], /^httpSessionId=$/m);
  assert.doesNotMatch(dwrBodies[0], /q:reference:c0-e\d+/);
  assert.match(dwrBodies[0], /batchId=0/);
  assert.match(dwrBodies[1], /batchId=1/);
  assert.match(dwrBodies[2], /batchId=2/);
  const expandedTreeParam = dwrBodies[1].split("\n").find((line) => line.startsWith("c0-param1="));
  assert.match(expandedTreeParam, /Object_Object:\{cuid:.*text:.*leaf:.*parentTreeNode:.*checked:.*isRoot:.*boName:.*params:.*treeParams:.*treeName:.*system:.*queryParams:/);
  assert.doesNotMatch(expandedTreeParam, /allowDrag|data:/);
  const firstDwrRequest = requests.find((request) => request.url.includes("/dwr/call/"));
  assert.match(firstDwrRequest.headers.cookie || "", /JSESSIONID=memory-only/);
  const oltGridRequest = requests.find((request) => request.url.includes("GridViewAction.getGridData") && request.body.includes("res.logic.RES_DEV.OLT"));
  assert.ok(oltGridRequest);
  assert.match(oltGridRequest.body, /^c0-e\d+=string:T0$/m);
  assert.match(oltGridRequest.body, /^c0-e\d+=Object_Object:\{RELATED_ROOM_CUID:reference:c0-e\d+\}$/m);
  assert.match(oltGridRequest.body, /^c0-e\d+=Object_Object:\{DOMAIN:reference:c0-e\d+\}$/m);
  assert.doesNotMatch(oltGridRequest.body, /ROOM\.RELATED_ORG_CUID/);
  assert.doesNotMatch(dwrBodies[0], /%E6%B5%8B%E8%AF%95%E5%88%86%E5%85%AC%E5%8F%B8/);
  assert.match(dwrBodies[0], /page=\/ngb\/modules\/res\/dev\/devconfig\/devconfig\.jsp\?_version=1786542493957/);
  const transferIndex = requests.findIndex((request) => request.url.includes("/transfer.do"));
  const shellIndex = requests.findIndex((request) => request.url.includes("/FrameAction/index.do"));
  const landingIndex = requests.findIndex((request) => request.url.includes("/devconfig.jsp"));
  assert.ok(transferIndex >= 0 && transferIndex < shellIndex && shellIndex < landingIndex);
  assert.doesNotMatch(JSON.stringify(requests), /api\/admin\/user\/(info|auth)/);
  assert.doesNotMatch(JSON.stringify(requests), /access-token|access-uid|authorization/);
  assert.doesNotMatch(JSON.stringify(requests), /plain-secret/);
});

test("login repair exposes the failing DWR stage without exposing response credentials", async () => {
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target) => ({
      status: 200,
      headers: {},
      text: target.pathname.includes("getGridPageInfo")
        ? "throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleException('0','0',{message:'java.lang.NullPointerException'});"
        : dwrReply({ totalCount: 0 })
    })
  });
  await assert.rejects(
    () => client.dwrCall("GridViewAction", "getGridPageInfo", [false, { params: { q: "厚街机房" } }], "/ngb/test.jsp?_version=1234567890"),
    /阶段 GridViewAction\.getGridPageInfo，batch 0，q=厚街机房，状态码 200，响应类型 DWR 异常响应/
  );
});

test("OSS organization discovery retries only the root-node shape after a DWR NPE", async () => {
  const requests = [];
  let treeCalls = 0;
  const requestImpl = async (target, options = {}) => {
    const url = new URL(target);
    const body = String(options.body || "");
    requests.push({ url: url.toString(), body, headers: options.headers || {} });
    if (url.pathname.includes("TreePanelAction.loadData")) {
      treeCalls += 1;
      if (treeCalls === 1) {
        return {
          status: 200,
          headers: {},
          text: "throw 'allowScriptTagRemoting is false.';dwr.engine._remoteHandleException('0','0',{message:'java.lang.NullPointerException'});"
        };
      }
      const value = treeCalls === 2
        ? [{ cuid: "ORG-CUID", text: "测试分公司", leaf: false }]
        : [{ cuid: "ROOM-CUID", text: "测试机房", leaf: true }];
      return { status: 200, headers: {}, text: dwrReply(value) };
    }
    if (url.pathname.includes("getGridPageInfo")) {
      return { status: 200, headers: {}, text: dwrReply({ totalCount: 1 }) };
    }
    if (url.pathname.includes("getGridData")) {
      return { status: 200, headers: {}, text: dwrReply({ list: [{ IP: "192.0.2.10", CUID: "OLT-CUID", N_RELATED_ROOM_CUID: "测试机房" }] }) };
    }
    return { status: 200, headers: {}, text: "ok" };
  };
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl
  });
  client.ngbPageVersion = "1786542493957";

  const session = await client.discoverOlts({
    username: "operator",
    organizationName: "测试分公司",
    roomName: "测试机房"
  });

  assert.deepEqual(session, [{ resourceIp: "192.0.2.10", cuid: "OLT-CUID", roomName: "测试机房" }]);
  const dwrRequests = requests.filter((request) => request.url.includes("/dwr/call/"));
  assert.equal(dwrRequests.length, 6);
  assert.match(dwrRequests[0].body, /batchId=0/);
  assert.match(dwrRequests[1].body, /batchId=1/);
  assert.match(dwrRequests[1].body, /^c0-e\d+=null:null$/m);
  for (const request of dwrRequests) {
    assert.equal(request.headers["content-length"], String(Buffer.byteLength(request.body, "utf8")));
  }
});

test("OSS organization discovery fails closed on duplicate names", async () => {
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target) => {
      const url = new URL(target);
      if (url.pathname.includes("TreePanelAction.loadData")) {
        return { status: 200, headers: {}, text: dwrReply([
          { cuid: "ORG-A", text: "测试分公司", leaf: false },
          { cuid: "ORG-B", text: "测试分公司", leaf: false }
        ]) };
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }
  });
  await assert.rejects(
    () => client.discoverOlts({ organizationName: "测试分公司", roomName: "" }),
    (error) => error.status === 409 && /多个同名节点/.test(error.message)
  );
});

test("normalizes ONU coordinates and projects only approved fields", () => {
  assert.deepEqual(normalizeOssOnuRow({
    DEVNAME: "ZTE-GPON 1/3/12:8",
    STB_SN: "1025001242801035724",
    CUSTNAME: "网管姓名",
    MOBILE: "13800000000",
    WHLADDR: "网管装机地址",
    LOID: "LOID-A",
    ONUMACADDRESS: "00:11:22:33:44:55",
    SN: "ZTEG00000001",
    USER_NAME: "完整姓名",
    CUID: "ONU-CUID-SECRET",
    FDN: "FDN-SECRET",
    PASSWORD: "password-secret",
    RELATED_ORG_CUID: "ORG-SECRET"
  }), {
    onuIndex: "1/3/12:8",
    chassis: "1",
    board: "3",
    pon: "12",
    onuId: "8",
    deviceName: "ZTE-GPON 1/3/12:8",
    deviceNumber: "1025001242801035724",
    loid: "LOID-A",
    mac: "00:11:22:33:44:55",
    serial: "ZTEG00000001",
    username: "完整姓名",
    userPhone: "13800000000",
    installationAddress: "网管装机地址",
    deviceType: "",
    ponType: "",
    phase: "",
    rxPower: "",
    distance: ""
  });
  const serialized = JSON.stringify(normalizeOssOnuRow({
    ONUDEVICEINDEX: "1/3/12:8",
    CUID: "ONU-CUID-SECRET",
    FDN: "FDN-SECRET",
    PASSWORD: "password-secret",
    RELATED_ORG_CUID: "ORG-SECRET"
  }));
  assert.doesNotMatch(serialized, /CUID|FDN|PASSWORD|RELATED_ORG_CUID|SECRET/);
  assert.deepEqual(normalizeOssOnuRow({ OLTCARDIDX: "3", OLTPORTIDX: "12", ONUIDX: "8" }).onuIndex, "1/3/12:8");
  assert.throws(() => normalizeOssOnuRow({ CUID: "missing-coordinate" }), /无法解析/);
});

test("readOnuInventory reads all pages through the fixed read-only ONU grid and deduplicates coordinates", async () => {
  const requests = [];
  let pageCalls = 0;
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target, options = {}) => {
      const url = new URL(target);
      const body = String(options.body || "");
      requests.push({ url: url.toString(), body });
      if (url.pathname === "/ngb/ResDevAction/config.do") return { status: 200, headers: {}, text: "page" };
      if (url.pathname.includes("getGridPageInfo")) return { status: 200, headers: {}, text: dwrReply({ totalCount: 2 }) };
      if (url.pathname.includes("getGridData") && body.includes("res.logic.pon.olt.grid.OnuList")) {
        pageCalls += 1;
        const rows = pageCalls === 1
          ? [{ CUID: "ONU-CUID-1", ONUDEVICEINDEX: "1/3/12:8", LOID: "LOID-A", USER_NAME: "用户甲", PASSWORD: "discard" }]
          : [{ CUID: "ONU-CUID-2", DEVNAME: "ZTE-GPON 1/3/12:9", LOID: "LOID-B", USER_NAME: "用户乙", FDN: "discard" }];
        return { status: 200, headers: {}, text: dwrReply({ list: rows }) };
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }
  });

  const rows = await client.readOnuInventory("OLT-CUID", { pageSize: 1 });
  assert.deepEqual(rows.map((row) => row.onuIndex), ["1/3/12:8", "1/3/12:9"]);
  assert.equal(rows[0].username, "用户甲");
  assert.equal(Object.hasOwn(rows[0], "cuid"), false);
  assert.equal(Object.hasOwn(rows[1], "fdn"), false);
  assert.equal(pageCalls, 2);
  const dwrBodies = requests.filter((request) => request.url.includes("/dwr/call/")).map((request) => request.body);
  assert.equal(dwrBodies.length, 3);
  assert.match(dwrBodies[0], /GridViewAction/);
  assert.match(dwrBodies[1], /batchId=1/);
  assert.match(dwrBodies[2], /batchId=2/);
  assert.doesNotMatch(JSON.stringify(rows), /ONU-CUID|discard|FDN/);
});

test("readOnuInventory fails closed when a page contains an unparseable ONU row", async () => {
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target, options = {}) => {
      const url = new URL(target);
      const body = String(options.body || "");
      if (url.pathname === "/ngb/ResDevAction/config.do") return { status: 200, headers: {}, text: "page" };
      if (url.pathname.includes("getGridPageInfo")) return { status: 200, headers: {}, text: dwrReply({ totalCount: 1 }) };
      if (url.pathname.includes("getGridData") && body.includes("res.logic.pon.olt.grid.OnuList")) {
        return { status: 200, headers: {}, text: dwrReply({ list: [{ CUID: "ONU-CUID-SECRET" }] }) };
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }
  });
  await assert.rejects(() => client.readOnuInventory("OLT-CUID"), (error) => error.status === 502 && /无法解析/.test(error.message));
});
