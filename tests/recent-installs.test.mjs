import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-recent-installs-"));

const db = await import("../src/db.mjs");
const { overlayRecentInstalls } = await import("../src/db/recent-installs.mjs");
const { createRecentInstallSync, todayBossWindow } = await import("../src/recent-install-sync.mjs");
const { createNmseBossIncrementalRuntime } = await import("../src/nmse-boss-runtime.mjs");
const { createSourceManifest } = await import("../src/merged-onu-manifest.mjs");
const { createOltDataGateway } = await import("../src/olt-data-gateway.mjs");
const { createFeishuQueryApplication, isRecentInstallListRequest, shouldSyncRecentInstalls } = await import("../src/feishu/application.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");
const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

const install = (overrides = {}) => ({
  loid: "NEW1", operation: "install", oltIp: "10.0.0.9", onuIndex: "1/7/8:5",
  coordinate: { chassis: "1", board: "7", pon: "8", onuId: "5" },
  username: "新用户", userPhone: "13800000000", installationAddress: "厚街镇新装路1号", mac: "", deviceType: "",
  receivedIso: "2026-10-13T02:00:00.000Z",
  ...overrides
});
const ledger = (overrides = {}) => ({
  oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "8", onuId: "1", onuIndex: "1/7/8:1",
  loid: "OLD1", username: "老用户", installationAddress: "厚街镇老路", syncedAt: "2026-10-09 12:00:00",
  ...overrides
});

test("当天工单叠加到台账：新装加上，移机换坐标，销户去掉，台账更新的以台账为准", () => {
  const base = [ledger(), ledger({ onuId: "2", onuIndex: "1/7/8:2", loid: "MOVE1", username: "移机户" }), ledger({ onuId: "3", onuIndex: "1/7/8:3", loid: "GONE1" })];
  const rows = overlayRecentInstalls(base, [
    install(),
    install({ loid: "MOVE1", operation: "move", onuIndex: "1/7/9:4", coordinate: { chassis: "1", board: "7", pon: "9", onuId: "4" }, username: "移机户" }),
    install({ loid: "GONE1", operation: "cancel", onuIndex: "", coordinate: null }),
    // 工单早于台账同步：以台账为准。
    install({ loid: "OLD1", operation: "move", onuIndex: "1/7/9:9", coordinate: { chassis: "1", board: "7", pon: "9", onuId: "9" }, receivedIso: "2026-10-01T00:00:00.000Z" })
  ], { oltIp: "10.0.0.9" });
  const byLoid = new Map(rows.map((row) => [row.loid, row]));
  assert.equal(byLoid.get("OLD1").onuIndex, "1/7/8:1");
  assert.equal(byLoid.get("NEW1").source, "boss-recent");
  assert.equal(byLoid.get("NEW1").onuId, "5");
  assert.equal(byLoid.get("MOVE1").onuIndex, "1/7/9:4");
  assert.equal(rows.filter((row) => row.loid === "MOVE1").length, 1);
  assert.equal(byLoid.has("GONE1"), false);
  // 同坐标原来是别人、工单更新：原来的户去掉。
  const replaced = overlayRecentInstalls([ledger()], [install({ onuIndex: "1/7/8:1", coordinate: { chassis: "1", board: "7", pon: "8", onuId: "1" } })], { oltIp: "10.0.0.9" });
  assert.deepEqual(replaced.map((row) => row.loid), ["NEW1"]);
  // 其它 OLT 的工单不叠加。
  assert.deepEqual(overlayRecentInstalls([ledger()], [install({ oltIp: "10.0.0.10" })], { oltIp: "10.0.0.9" }).map((row) => row.loid), ["OLD1"]);
});

test("保存当天工单：同 LOID 取最新，返回新增条数，7 天前的清掉；叠加数据可读回", async () => {
  await db.initDb();
  const first = await db.saveBossRecentInstalls([
    { loid: "new1", operation: "install", workOrder: "W1", receivedAt: "2026-10-13 09:00:00", idempotencyKey: "W1|NEW1|2026-10-13 09:00:00", oltIp: "10.0.0.9", onuIndex: "1/7/8:5", username: "新用户" },
    { loid: "OLD9", operation: "install", workOrder: "W0", receivedAt: "2026-10-01 09:00:00", idempotencyKey: "W0", oltIp: "10.0.0.9", onuIndex: "1/7/8:6" }
  ], { fetchedAt: "2026-10-13T03:00:00.000Z" });
  assert.equal(first.newCount, 2);
  const again = await db.saveBossRecentInstalls([
    { loid: "NEW1", operation: "install", workOrder: "W1", receivedAt: "2026-10-13 09:00:00", idempotencyKey: "W1|NEW1|2026-10-13 09:00:00", oltIp: "10.0.0.9", onuIndex: "1/7/8:5" }
  ], { fetchedAt: "2026-10-13T03:05:00.000Z" });
  assert.equal(again.newCount, 0);
  const overlay = await db.getBossRecentInstallOverlay();
  assert.deepEqual(overlay.map((row) => row.loid), ["NEW1"]);
  assert.equal(overlay[0].receivedIso, "2026-10-13T01:00:00.000Z");
  assert.deepEqual(overlay[0].coordinate, { chassis: "1", board: "7", pon: "8", onuId: "5" });
  assert.equal((await db.getBossRecentInstallKeys()).has("W1|NEW1|2026-10-13 09:00:00"), true);
  const list = await db.getBossRecentInstalls();
  assert.equal(list[0].inLedger, false);
});

test("当天装机同步：窗口为当天 0 点到此刻，两分钟内不重复读取，失败记录原因", async () => {
  let clock = Date.parse("2026-10-13T02:30:00.000Z");
  const reads = [];
  const runs = [];
  let fail = false;
  const sync = createRecentInstallSync({
    readRecentChanges: async ({ window, skipRow }) => {
      reads.push({ window, skipRow });
      if (fail) throw new Error("NMSE 超时");
      return { rows: [{ loid: "A" }], skipped: 1 };
    },
    saveRecentInstalls: async (rows) => ({ newCount: rows.length }),
    getKnownKeys: async () => new Set(["K"]),
    recordRun: async (run) => { runs.push(run); },
    now: () => new Date(clock)
  });
  assert.deepEqual(todayBossWindow(new Date(clock)), { start: "2026-10-13 00:00:00", end: "2026-10-13 10:30:00" });
  assert.equal(sync.canFetch(), true);
  const result = await sync.syncToday({ trigger: "feishu" });
  assert.equal(result.newCount, 1);
  assert.deepEqual(reads[0].window, { start: "2026-10-13 00:00:00", end: "2026-10-13 10:30:00" });
  assert.equal(typeof reads[0].skipRow, "function");
  assert.equal(sync.canFetch(), false);
  assert.equal((await sync.syncToday()).status, "skipped");
  assert.equal(reads.length, 1);
  clock += 3 * 60 * 1000;
  fail = true;
  await assert.rejects(sync.syncToday({ force: true }), /NMSE 超时/);
  assert.equal(runs.at(-1).status, "failed");
  assert.equal(runs.at(-1).error, "NMSE 超时");
});

test("BOSS 运行时：按配置的镇区查询；当天读取跳过不完整的工单且不推进水位", async () => {
  const calls = [];
  const raw = [
    { serviceName: "报装", recTime: "2026-10-13 09:00:00", serialNo: "W1", loid: "new1", opResult: "1", oltIp: "10.0.0.9", onuIndex: "1/7/8:5", username: "新用户" },
    { serviceName: "报装", recTime: "2026-10-13 09:10:00", serialNo: "W2", loid: "NEW2", opResult: "1" }
  ];
  let applied = 0;
  const runtime = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-10-12 10:00:00", nameHistoryCompletedAt: "2026-09-01" }),
    getSession: async () => ({ auth: {}, client: { getBossOperations: async (_auth, options) => { calls.push(options); return raw; } } }),
    applyChanges: async () => { applied += 1; return { watermark: "x" }; },
    getQueryContent: async () => "虎门镇",
    now: () => new Date("2026-10-13T02:30:00.000Z")
  });
  const recent = await runtime.readRecentChanges({ window: { start: "2026-10-13 00:00:00", end: "2026-10-13 10:30:00" } });
  assert.equal(calls[0].queryStr, "虎门镇");
  assert.deepEqual(recent.rows.map((row) => row.loid), ["NEW1"]);
  assert.equal(recent.skipped, 1);
  assert.equal(applied, 0);
  assert.equal(runtime.state().status, "idle");

  const missing = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-10-12 10:00:00", nameHistoryCompletedAt: "2026-09-01" }),
    getSession: async () => { throw new Error("不应登录"); },
    applyChanges: async () => ({}),
    getQueryContent: async () => { throw Object.assign(new Error("请先填写查询镇区"), { status: 400 }); }
  });
  await assert.rejects(missing.run(), /查询镇区/);
});

test("来源清单接受配置的镇区，拒绝空的或带空格的镇区", () => {
  const base = {
    source: "nmse", sourceKind: "nmse-boss-incremental-overlay",
    collectionStartedAt: "2026-10-13T01:00:00.000Z", collectionCompletedAt: "2026-10-13T01:05:00.000Z",
    windowStart: "2026-10-12T00:00:00.000Z", windowEnd: "2026-10-13T01:00:00.000Z",
    sourceRevision: "source:abc", targetOltIds: ["olt-1"], rowCount: 1, status: "complete", runId: "run-1", idempotencyKey: "",
    exclusiveWatermark: "2026-10-13T01:00:00.000Z", coverageThrough: "2026-10-12"
  };
  const ok = createSourceManifest({ ...base, scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "虎门镇" } });
  assert.equal(ok.scope.content, "虎门镇");
  const scopeError = (content) => (error) => JSON.stringify(error.errors || error.detail || error.result || error).includes("scope") || /scope/.test(error.message);
  assert.throws(() => createSourceManifest({ ...base, scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "" } }), scopeError(""));
  assert.throws(() => createSourceManifest({ ...base, scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "虎门 镇" } }), scopeError("虎门 镇"));
});

test("飞书查不到用户时同步当天装机后再查，候选标为今日装机", async () => {
  let installed = false;
  const users = () => installed ? [{
    ...ledger({ onuId: "5", onuIndex: "1/7/8:5", loid: "DG2142NEW1X", username: "新用户", installationAddress: "厚街镇新装路1号", syncedAt: "2026-10-13T01:00:00.000Z" }),
    source: "boss-recent"
  }] : [];
  const gateway = createOltDataGateway({
    getOlts: async () => [{ id: "olt-1", name: "厚街C300", vendor: "zte", model: "C300", host: "10.0.0.9", enabled: true }],
    getUsers: async () => users(),
    getPonPorts: async () => [],
    getDatasetRevision: async () => "rev",
    listOnus: async () => []
  });
  const direct = await gateway.queryUsers({ intent: "find_by_loid", value: "DG2142NEW1X", oltIds: ["olt-1"], limit: 10 });
  assert.equal(direct.authorizedCount, 0);
  installed = true;
  const found = await gateway.queryUsers({ intent: "find_by_loid", value: "DG2142NEW1X", oltIds: ["olt-1"], limit: 10 });
  assert.equal(found.candidates[0].recentInstall, true);
  installed = false;

  let state = { ...emptyFeishuState(), enabled: true };
  const sent = [];
  let syncs = 0;
  const app = createFeishuQueryApplication({
    stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
    gateway: {
      ...gateway,
      listOlts: async () => [{ oltId: "olt-1", name: "厚街C300", vendor: "zte", model: "C300", enabled: true }],
      queryUsers: (request) => gateway.queryUsers(request),
      queryPons: async () => ({ authorizedCount: 0, candidates: [] }),
      readOnuDetail: async (request) => ({
        oltId: request.oltId, onu: request.coordinate, observedAt: "2026-10-13T02:31:00.000Z", unsupportedFields: [],
        status: { phase: "online", rxPower: "-19 dBm", distance: "1 km", serial: "SN", name: "新用户" },
        detail: { interface: "1/7/8/5", name: "新用户", phaseState: "在线", serialNumber: "SN", opticalRxPower: "-19 dBm", distance: "1 km", lastOnlineTime: null, lastOfflineTime: null, lastOfflineCause: null, lastOfflineCauseCode: null }
      })
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_loid", value: "DG2142NEW1X" }),
    recentInstalls: {
      canFetch: () => syncs === 0,
      syncToday: async () => { syncs += 1; installed = true; return { status: "success", newCount: 1 }; }
    },
    send: async (chatId, reply) => { sent.push(reply); },
    now: () => "2026-10-13T02:31:00.000Z"
  });
  const reply = await app.handleMessage({ eventId: "e1", openId: "ou-1", chatId: "oc-1", text: "DG2142NEW1X" });
  assert.equal(syncs, 1);
  assert.equal(sent[0].kind, "recent-install-syncing");
  assert.equal(reply.kind, "onu-detail");
  assert.equal(reply.candidate.recentInstall, true);
  assert.match(JSON.stringify(renderReply(reply).content), /新装或移机，台账还没同步到这户/);
});

test("只有明确说新装、或按 LOID / 手机号查不到时才读一期网管当天工单", () => {
  assert.equal(shouldSyncRecentInstalls({ text: "张三", intent: "find_by_name", value: "张三" }), false);
  assert.equal(shouldSyncRecentInstalls({ text: "东宝路1号", intent: "find_by_address", value: "东宝路1号" }), false);
  assert.equal(shouldSyncRecentInstalls({ text: "C600 怎么查未注册 ONU", intent: "find_by_address", value: "C600", useSearchOrder: true }), false);
  assert.equal(shouldSyncRecentInstalls({ text: "DG21422299X", intent: "find_by_loid", value: "DG21422299X" }), true);
  assert.equal(shouldSyncRecentInstalls({ text: "13800138000", intent: "find_by_phone", value: "13800138000" }), true);
  assert.equal(shouldSyncRecentInstalls({ text: "1380", intent: "find_by_phone", value: "1380" }), false);
  assert.equal(shouldSyncRecentInstalls({ text: "张三刚装的", intent: "find_by_name", value: "张三" }), true);
  assert.equal(shouldSyncRecentInstalls({ text: "查一下新装的李四", intent: "find_by_name", value: "李四", useSearchOrder: true }), true);
  for (const text of ["今天新装", "今日装机", "查今天新装", "今天装了哪些", "今天的装机工单", "今日新装用户名单"]) assert.equal(isRecentInstallListRequest(text), true, text);
  for (const text of ["新装路1号", "张三今天新装的", "今天厚街村抢修"]) assert.equal(isRecentInstallListRequest(text), false, text);
});

test("飞书“今天新装”列出当天工单", async () => {
  let state = { ...emptyFeishuState(), enabled: true };
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
    gateway: {
      listOlts: async () => [{ oltId: "olt-1", name: "厚街C300", vendor: "zte", model: "C300", enabled: true }],
      queryUsers: async () => ({ authorizedCount: 0, candidates: [] }),
      queryPons: async () => ({ authorizedCount: 0, candidates: [] })
    },
    interpret: async () => { throw new Error("不应调用大模型"); },
    recentInstalls: {
      canFetch: () => true,
      syncToday: async () => ({ status: "success", newCount: 1 }),
      listToday: async () => [{ operation: "install", receivedAt: "2026-10-13 09:05:00", username: "新用户", installationAddress: "厚街镇新装路1号", loid: "DG2142NEW1X", inLedger: false, oltIp: "10.0.0.9" }]
    },
    send: async (chatId, reply) => { sent.push(reply); },
    now: () => "2026-10-13T02:31:00.000Z"
  });
  const reply = await app.handleMessage({ eventId: "e-list", openId: "ou-1", chatId: "oc-1", text: "今天新装" });
  assert.equal(reply.kind, "recent-install-list");
  assert.equal(reply.total, 1);
  assert.equal(JSON.stringify(reply).includes("10.0.0.9"), false);
  const card = JSON.stringify(renderReply(reply).content);
  assert.match(card, /今日装机 · 1 条/);
  assert.match(card, /09:05 · 新装 · \*\*新用户\*\*/);
});

test("机器人菜单“今天新装”（recent-installs）把当天工单发到用户单聊", async () => {
  const { RECENT_INSTALL_MENU_KEY } = await import("../src/feishu/application.mjs");
  assert.equal(RECENT_INSTALL_MENU_KEY, "recent-installs");
  let state = { ...emptyFeishuState(), enabled: true };
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
    gateway: { listOlts: async () => [], queryUsers: async () => ({ authorizedCount: 0, candidates: [] }), queryPons: async () => ({ authorizedCount: 0, candidates: [] }) },
    interpret: async () => null,
    recentInstalls: {
      canFetch: () => true,
      syncToday: async () => ({ status: "success", newCount: 0 }),
      listToday: async () => [{ operation: "install", receivedAt: "2026-10-14 09:05:00", username: "新用户", installationAddress: "厚街镇新装路1号", loid: "DG2142NEW1X", inLedger: false }]
    },
    send: async (chatId, reply, options) => { sent.push({ chatId, reply, options }); },
    now: () => "2026-10-14T02:00:00.000Z"
  });
  const reply = await app.handleMenu({ eventId: "menu-1", openId: "ou-1", eventKey: "recent-installs" });
  assert.equal(reply.kind, "recent-install-list");
  assert.deepEqual(sent.map((item) => [item.chatId, item.reply.kind, item.options?.receiveIdType]), [
    ["ou-1", "recent-install-syncing", "open_id"],
    ["ou-1", "recent-install-list", "open_id"]
  ]);
});
