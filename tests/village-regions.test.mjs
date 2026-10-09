import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  addressMatchesRegion,
  countRegionCoverage,
  discoverVillageSubgroups,
  isSparsePon,
  resolveVillageRegion
} from "../src/village-regions.mjs";
import { createOltDataGateway } from "../src/olt-data-gateway.mjs";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";
import { handleFieldRepairRoutes } from "../src/field-repair-routes.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-village-regions-"));
const db = await import("../src/db.mjs");
const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

// 合成地址：示例村分上坊、下坊两个小组，地址前缀有重复写法；另有一户“示例镇上坊”不带村名。
function syntheticUsers() {
  const users = [];
  const add = (count, address, pon) => {
    for (let index = 0; index < count; index += 1) {
      users.push({ oltIp: "192.0.2.1", onuIndex: `1/1/${pon}:${users.length + 1}`, username: `用户${users.length + 1}`, installationAddress: address(index) });
    }
  };
  add(6, (index) => `合成省合成市示例镇示例村上坊一巷${index}号`, 1);
  add(5, (index) => `合成省合成市示例镇1示例片2示例村合成市示例镇示例村下坊新村${index}号`, 2);
  add(2, (index) => `合成省合成市示例镇示例村零散路${index}号`, 3);
  add(1, () => "合成省合成市示例镇上坊麻园1号", 1);
  add(3, (index) => `合成省合成市示例镇别的村上坊大道${index}号`, 4);
  return users;
}

test("自动发现小组：取最后一次村名之后的地名，按一致度延伸，去掉道路后缀", () => {
  const result = discoverVillageSubgroups(syntheticUsers(), "示例村");
  assert.equal(result.matchedUsers, 13);
  assert.deepEqual(result.candidates.map((item) => item.name), ["上坊", "下坊新村"]);
  assert.deepEqual(result.candidates[1].includeKeywords, ["示例村下坊新村"]);
  // “示例镇上坊”不带村名，需管理员补别名；“零散路”不足 5 户不成组。
  assert.equal(result.uncoveredUsers, 2);
});

test("区域匹配支持别名和排除关键词", () => {
  const region = { village: "示例村", name: "上坊", includeKeywords: ["示例村上坊", "示例镇上坊"], excludeKeywords: ["别的村"] };
  assert.equal(addressMatchesRegion("示例镇示例村上坊一巷1号", region), true);
  assert.equal(addressMatchesRegion("示例镇上坊麻园1号", region), true);
  assert.equal(addressMatchesRegion("示例镇别的村上坊大道1号", { ...region, includeKeywords: ["上坊"] }), false);
  const [counted] = countRegionCoverage(syntheticUsers(), [region]);
  assert.equal(counted.userCount, 7);
  assert.equal(counted.ponCount, 1);
});

test("查询词解析为区域：村名+小组名，或唯一的小组名；驳回的不参与", () => {
  const regions = [
    { id: 1, village: "示例村", name: "上坊", status: "active" },
    { id: 2, village: "另一村", name: "上坊", status: "candidate" },
    { id: 3, village: "示例村", name: "下坊", status: "rejected" }
  ];
  assert.equal(resolveVillageRegion("示例村上坊", regions)?.id, 1);
  assert.equal(resolveVillageRegion("上坊", regions), null);
  assert.equal(resolveVillageRegion("示例村下坊", regions), null);
  assert.equal(resolveVillageRegion("示例村", regions), null);
});

test("零星沾边口：命中 1–2 户且占比低于 30%", () => {
  assert.equal(isSparsePon({ matchedUserCount: 2, ponUserCount: 40 }), true);
  assert.equal(isSparsePon({ matchedUserCount: 2, ponUserCount: 4 }), false);
  assert.equal(isSparsePon({ matchedUserCount: 3, ponUserCount: 60 }), false);
});

test("区域字典持久化：候选不覆盖已审核条目，可编辑、驳回和删除", async () => {
  await db.initDb();
  const saved = await db.saveVillageRegionCandidates("示例村", [
    { name: "上坊", includeKeywords: ["示例村上坊"] },
    { name: "下坊", includeKeywords: ["示例村下坊"] }
  ]);
  assert.deepEqual(saved.map((item) => [item.name, item.status, item.source]), [["上坊", "candidate", "auto"], ["下坊", "candidate", "auto"]]);
  const upper = saved.find((item) => item.name === "上坊");
  const approved = await db.updateVillageRegion(upper.id, { status: "active", includeKeywords: "示例村上坊，示例镇上坊", excludeKeywords: ["别的村"] });
  assert.deepEqual(approved.includeKeywords, ["示例村上坊", "示例镇上坊"]);
  await db.saveVillageRegionCandidates("示例村", [{ name: "上坊", includeKeywords: ["示例村上坊X"] }]);
  const [again] = await db.getVillageRegions({ village: "示例村" }).then((rows) => rows.filter((row) => row.name === "上坊"));
  assert.equal(again.status, "active");
  assert.deepEqual(again.includeKeywords, ["示例村上坊", "示例镇上坊"]);
  const manual = await db.createVillageRegion({ village: "示例村", name: "零散" });
  assert.deepEqual(manual.includeKeywords, ["示例村零散"]);
  await assert.rejects(() => db.createVillageRegion({ village: "示例村", name: "零散" }), /同名/);
  await assert.rejects(() => db.updateVillageRegion(upper.id, { status: "bogus" }), /状态无效/);
  await db.deleteVillageRegion(manual.id);
  assert.deepEqual((await db.getVillageRegionVillages()), [{ village: "示例村", total: 2, active: 1, candidate: 1 }]);
});

test("夜间采样持久化：同一晚覆盖写入，按 PON 读取", async () => {
  await db.initDb();
  const rows = [
    { chassis: "1", board: "1", pon: "1", onuId: "1", phase: "online", rxPower: "-20.5" },
    { chassis: "1", board: "1", pon: "1", onuId: "2", phase: "offline", rxPower: "" },
    { chassis: "1", board: "1", pon: "2", onuId: "1", phase: "online", rxPower: "-19" }
  ];
  assert.deepEqual(await db.recordOpticalNightlySamples({ oltId: "olt-a", sampleDate: "2026-10-08", rows }), { count: 3 });
  await db.recordOpticalNightlySamples({ oltId: "olt-a", sampleDate: "2026-10-08", rows: [{ ...rows[0], rxPower: "-21" }] });
  const samples = await db.getOpticalNightlySamples({ oltId: "olt-a", chassis: "1", board: "1", pon: "1" });
  assert.deepEqual(samples, [
    { onuId: "1", sampleDate: "2026-10-08", phase: "online", rxDbm: -21 },
    { onuId: "2", sampleDate: "2026-10-08", phase: "offline", rxDbm: null }
  ]);
  const runId = await db.beginOpticalBaselineRun({ sampleDate: "2026-10-08", trigger: "manual" });
  await db.finishOpticalBaselineRun({ id: runId, status: "success", oltCount: 1, onuCount: 3 });
  const [run] = await db.getOpticalBaselineRuns();
  assert.equal(run.status, "success");
  assert.equal(run.trigger, "manual");
  assert.deepEqual(await db.getOpticalBaselineSettings().then(({ enabled, runHour }) => ({ enabled, runHour })), { enabled: true, runHour: 2 });
  assert.equal((await db.saveOpticalBaselineSettings({ runHour: 3 })).runHour, 3);
  await assert.rejects(() => db.saveOpticalBaselineSettings({ runHour: 24 }), /0–23/);
  assert.equal((await db.getOpticalBaselineCoverage()).nights, 1);
});

const olts = [{ id: "olt-a", name: "A", vendor: "zte", model: "C300", host: "192.0.2.1", enabled: true }];

function buildGateway({ regions = [], samples = [], live = null, saved = [] } = {}) {
  const users = syntheticUsers();
  return createOltDataGateway({
    getOlts: async () => olts,
    getUsers: async () => users,
    getPonPorts: async () => [],
    getDatasetRevision: async () => "rev",
    listOnus: async (_olt, pon) => live ? live(pon) : [],
    getOpticalNightlySamples: async () => samples,
    getVillageRegions: async () => regions,
    saveVillageRegionCandidates: async (village, candidates) => {
      saved.push({ village, candidates });
      return candidates.map((candidate, index) => ({ ...candidate, id: index + 1, status: "candidate" }));
    },
    now: () => new Date(2026, 9, 9, 12, 0)
  });
}

test("网关：村级查询区分主要口和零星口，命中区域时按区域关键词匹配", async () => {
  const gateway = buildGateway();
  const all = await gateway.queryVillagePons({ value: "示例村", oltIds: ["olt-a"] });
  assert.equal(all.total, 3);
  assert.equal(all.mainCount, 3);
  const regionGateway = buildGateway({ regions: [{ id: 9, village: "示例村", name: "上坊", status: "active", includeKeywords: ["示例村上坊", "示例镇上坊"], excludeKeywords: [] }] });
  const region = await regionGateway.queryVillagePons({ value: "示例村上坊", oltIds: ["olt-a"], ponScope: "main" });
  assert.deepEqual(region.region, { id: 9, village: "示例村", name: "上坊" });
  assert.deepEqual(region.candidates.map((item) => [item.pon.pon, item.matchedUserCount]), [["1", 7]]);
});

test("网关：大村首次查询时自动发现并保存小组候选", async () => {
  const saved = [];
  const gateway = buildGateway({ saved });
  const menu = await gateway.villageRegionMenu({ value: "示例村", oltIds: ["olt-a"] });
  assert.equal(menu.discovered, true);
  assert.equal(saved[0].village, "示例村");
  assert.deepEqual(menu.regions.map((item) => [item.name, item.userCount, item.ponCount]), [["上坊", 6, 1], ["下坊新村", 5, 1]]);
});

test("网关：逐户对比读取夜间采样和实时数据，附带台账姓名", async () => {
  const samples = ["1", "2"].flatMap((onuId) => ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((sampleDate) => ({ onuId, sampleDate, phase: "online", rxDbm: -20 })));
  const gateway = buildGateway({
    samples,
    live: (pon) => [
      { ...pon, onuId: "1", phase: "online", rxPower: "-23.5" },
      { ...pon, onuId: "2", phase: "offline", rxPower: "" }
    ]
  });
  const result = await gateway.readPonRepairComparison({ oltId: "olt-a", pon: { chassis: "1", board: "1", pon: "1" }, oltIds: ["olt-a"] });
  assert.equal(result.status, "compared");
  assert.equal(result.counts.degraded, 1);
  assert.equal(result.degraded[0].name, "用户1");
  assert.equal(result.notRecovered[0].name, "用户2");
  const empty = await buildGateway().readPonRepairComparison({ oltId: "olt-a", pon: { chassis: "1", board: "1", pon: "1" }, oltIds: ["olt-a"] });
  assert.equal(empty.status, "no-baseline");
});

function feishuStore() {
  let value = { ...emptyFeishuState(), enabled: true };
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); } };
}

function villageGateway({ mainTotal = 20, regions = [], repair = null, calls = [] } = {}) {
  const candidates = (offset, total) => Array.from({ length: Math.max(0, Math.min(5, total - offset)) }, (_, index) => ({
    candidateId: `olt-1:1/1/${offset + index + 1}`, oltId: "olt-1", oltName: "OLT 1", address: "一级地址",
    pon: { chassis: "1", board: "1", pon: String(offset + index + 1) }, matchedUserCount: 5
  }));
  return {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async queryVillagePons(request) {
      calls.push(request);
      const regionHit = request.value !== "示例村";
      const total = regionHit ? 2 : request.ponScope === "sparse" ? 1 : mainTotal;
      return { total, authorizedCount: total, offset: request.offset, limit: 5, hasMore: request.offset + 5 < total,
        mainCount: total, sparseCount: regionHit ? 1 : 3, region: regionHit ? { id: 1, village: "示例村", name: "上坊" } : null,
        candidates: candidates(request.offset, total) };
    },
    async villageRegionMenu() { return { village: "示例村", region: null, discovered: true, regions }; },
    async readPonRepairComparison(request) { return repair ? repair(request) : { status: "no-baseline" }; },
    async sampleVillagePonOnlineUser() { return { candidate: null, liveStatus: null, ponStatus: { status: "no-configured-data" } }; }
  };
}

function waitFor(sent, kind) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const found = sent.find((reply) => reply.kind === kind);
      if (found) { clearInterval(timer); resolve(found); }
    }, 1);
  });
}

test("飞书：大村抢修查询先回复小组菜单，选择小组后只检查该小组主要口", async () => {
  const sent = [];
  const calls = [];
  const regions = [
    { id: 1, village: "示例村", name: "上坊", status: "active", userCount: 30, ponCount: 2 },
    { id: 2, village: "示例村", name: "下坊", status: "candidate", userCount: 12, ponCount: 1 }
  ];
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(), gateway: villageGateway({ regions, calls }),
    interpret: async () => { throw new Error("应由本地规则识别"); },
    now: () => "2026-10-09T04:00:00.000Z", send: async (_chatId, reply) => { sent.push(reply); }
  });
  const menu = await app.handleMessage({ eventId: "e1", openId: "ou-1", chatId: "oc-1", text: "查示例村抢修情况" });
  assert.equal(menu.kind, "village-region-menu");
  assert.equal(menu.total, 20);
  assert.deepEqual(menu.regions.map((item) => [item.name, item.index]), [["上坊", 0], ["下坊", 1]]);
  const card = JSON.stringify(renderReply(menu).content);
  assert.match(card, /上坊（30户\/2口）/);
  assert.match(card, /仍然检查全部 20 口/);
  assert.match(card, /尚待管理员审核/);

  const loading = await app.handleCallback({ eventId: "e2", openId: "ou-1", chatId: "oc-1", verifiedByTransport: true,
    binding: { token: menu.selection.token, index: 0, action: "village-region-select", expiresAt: menu.selection.expiresAt } });
  assert.equal(loading.kind, "village-pon-summary-loading");
  assert.equal(loading.total, 2);
  const summary = await waitFor(sent, "village-pon-summary");
  assert.equal(summary.village, "示例村上坊");
  assert.equal(summary.ponScope, "main");
  assert.equal(summary.sparseCount, 1);
  assert.ok(calls.some((request) => request.value === "示例村上坊" && request.ponScope === "main"));
  assert.match(JSON.stringify(renderReply(summary).content), /检查零星相关口/);
});

test("飞书：有夜间基线时按逐户对比给出熔接判定和名单", async () => {
  const sent = [];
  const repair = ({ pon }) => pon.pon === "1"
    ? { status: "compared", counts: { total: 4, recovered: 3, normal: 0, slight: 0, degraded: 3, offlineBefore: 0, notRecovered: 1, offlineUnknown: 0, noBaseline: 0 },
      pattern: "trunk", patternText: "整口用户普遍变差，多半是主干光缆熔接点问题，建议开盒重熔该口对应纤芯", medianDelta: -3,
      baselineFrom: "2026-10-01", baselineTo: "2026-10-07", outageNight: "2026-10-08",
      degraded: [{ onuId: "1", name: "甲", address: "示例村上坊1号", phone: "", before: -20, after: -23.5, delta: -3.5 }],
      notRecovered: [{ onuId: "4", name: "丁", address: "示例村上坊4号", phone: "13800000004", before: -21 }] }
    : { status: "compared", counts: { total: 2, recovered: 2, normal: 2, slight: 0, degraded: 0, offlineBefore: 0, notRecovered: 0, offlineUnknown: 0, noBaseline: 0 },
      pattern: "none", patternText: "", medianDelta: 0, baselineFrom: "2026-10-01", baselineTo: "2026-10-07", degraded: [], notRecovered: [] };
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(), gateway: villageGateway({ repair }),
    interpret: async () => { throw new Error("应由本地规则识别"); },
    now: () => "2026-10-09T04:00:00.000Z", send: async (_chatId, reply) => { sent.push(reply); }
  });
  const loading = await app.handleMessage({ eventId: "e3", openId: "ou-1", chatId: "oc-1", text: "查示例村上坊抢修情况" });
  assert.equal(loading.kind, "village-pon-summary-loading");
  const summary = await waitFor(sent, "village-pon-summary");
  assert.equal(summary.village, "示例村上坊");
  assert.equal(summary.repairVerdict, "warning");
  assert.match(summary.repairVerdictText, /3 户比断纤前差 2 dB 以上/);
  assert.match(summary.repairVerdictText, /主干光缆熔接点/);
  assert.equal(summary.repairSummary.totals.total, 6);
  assert.equal(summary.repairDegraded[0].name, "甲");
  assert.deepEqual(summary.repairDegraded[0].pon, { chassis: "1", board: "1", pon: "1" });
  const card = JSON.stringify(renderReply(summary).content);
  assert.match(card, /示例村上坊 · 抢修验收/);
  assert.match(card, /需复核熔接（户）/);
  assert.match(card, /10-01 至 10-07/);
  assert.match(card, /-20.00 dBm → <font color='red'>-23.50 dBm<\/font>/);
  assert.match(card, /tel:13800000004/);
  assert.doesNotMatch(card, /随机抽样仅代表/);
});

test("飞书：逐户对比全部正常时给出可以封盒的结论", async () => {
  const sent = [];
  const repair = () => ({ status: "compared", counts: { total: 3, recovered: 3, normal: 3, slight: 0, degraded: 0, offlineBefore: 0, notRecovered: 0, offlineUnknown: 0, noBaseline: 0 },
    pattern: "none", patternText: "", medianDelta: -0.2, baselineFrom: "2026-10-02", baselineTo: "2026-10-08", degraded: [], notRecovered: [] });
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(), gateway: villageGateway({ mainTotal: 2, repair }),
    interpret: async () => { throw new Error("应由本地规则识别"); },
    now: () => "2026-10-09T04:00:00.000Z", send: async (_chatId, reply) => { sent.push(reply); }
  });
  await app.handleMessage({ eventId: "e4", openId: "ou-1", chatId: "oc-1", text: "示例村断纤情况" });
  const summary = await waitFor(sent, "village-pon-summary");
  assert.equal(summary.repairVerdict, "pass");
  assert.match(summary.repairVerdictText, /已恢复 6\/6 户/);
});

test("区域字典接口：识别、编辑后返回覆盖统计；基线手动采集在进行中时拒绝", async () => {
  const users = syntheticUsers();
  const store = new Map();
  let nextId = 1;
  const deps = {
    opticalBaselineScheduler: {
      running: false,
      async status() { return { enabled: true, runHour: 2, running: this.running, nextRunAt: "", recentRuns: [] }; },
      async runNow() { this.running = true; },
      async reschedule() {}
    },
    getOpticalBaselineCoverage: async () => ({ nights: 0 }),
    saveOpticalBaselineSettings: async (input) => input,
    getMergedOnuSnapshots: async () => users,
    getVillageRegions: async ({ village }) => [...store.values()].filter((item) => item.village === village),
    getVillageRegionVillages: async () => [{ village: "示例村", total: store.size, active: 0, candidate: store.size }],
    saveVillageRegionCandidates: async (village, candidates) => {
      for (const candidate of candidates) {
        const id = nextId++;
        store.set(id, { ...candidate, id, village, status: "candidate" });
      }
      return [...store.values()];
    },
    createVillageRegion: async () => { throw new Error("unused"); },
    updateVillageRegion: async (id, body) => {
      const next = { ...store.get(id), ...body, includeKeywords: String(body.includeKeywords).split("，") };
      store.set(id, next);
      return next;
    },
    deleteVillageRegion: async (id) => store.delete(id),
    readBody: async (req) => req.body,
    json: async (res, status, body) => { res.status = status; res.body = body; }
  };
  const call = async (method, path, body) => {
    const res = {};
    const handled = await handleFieldRepairRoutes({ method, body }, res, new URL(`http://local${path}`), deps);
    return { handled, ...res };
  };
  const discovered = await call("POST", "/api/village-regions/discover", { village: "示例村" });
  assert.equal(discovered.status, 200);
  assert.equal(discovered.body.villageUsers, 13);
  assert.equal(discovered.body.discoveredCount, 2);
  const missing = await call("POST", "/api/village-regions/discover", { village: "不存在村" });
  assert.equal(missing.status, 404);
  const upper = discovered.body.regions.find((item) => item.name === "上坊");
  const updated = await call("PUT", `/api/village-regions/${upper.id}`, { includeKeywords: "示例村上坊，示例镇上坊", status: "active" });
  assert.equal(updated.body.region.userCount, 7);
  const listed = await call("GET", `/api/village-regions?village=${encodeURIComponent("示例村")}`);
  assert.equal(listed.body.villageUsers, 13);
  assert.equal(listed.body.regions.length, 2);
  assert.equal((await call("POST", "/api/optical-baseline/run")).status, 202);
  assert.equal((await call("POST", "/api/optical-baseline/run")).status, 409);
  assert.equal((await call("GET", "/api/projects")).handled, false);
});

test("飞书经进程内适配层调用真实网关：大村出小组菜单，逐户对比与资料时间都能到达", async () => {
  const { createInProcessFeishuGateway } = await import("../src/feishu/gateway-contract.mjs");
  // 20 个 PON 口，每口 6 户“大村上坊”，另 1 口“大村下坊”。
  const users = [];
  for (let pon = 1; pon <= 20; pon += 1) {
    for (let onu = 1; onu <= 6; onu += 1) {
      users.push({ oltIp: "192.0.2.1", onuIndex: `1/1/${pon}:${onu}`, username: `用户${pon}-${onu}`, installationAddress: `合成镇大村${pon === 20 ? "下坊" : "上坊"}${onu}号` });
    }
  }
  const nights = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
  const inner = createOltDataGateway({
    getOlts: async () => [{ id: "olt-a", name: "A", vendor: "zte", model: "C300", host: "192.0.2.1", enabled: true }],
    getUsers: async () => users,
    getPonPorts: async () => [],
    getDatasetRevision: async () => "rev",
    listOnus: async (_olt, pon) => Array.from({ length: 6 }, (_, index) => ({ ...pon, onuId: String(index + 1), phase: "online", rxPower: index === 0 ? "-24" : "-20" })),
    getOpticalNightlySamples: async () => Array.from({ length: 6 }, (_, index) => nights.map((sampleDate) => ({ onuId: String(index + 1), sampleDate, phase: "online", rxDbm: -20 }))).flat(),
    getVillageRegions: async () => [
      { id: 1, village: "大村", name: "上坊", status: "active", includeKeywords: ["大村上坊"], excludeKeywords: [] },
      { id: 2, village: "大村", name: "下坊", status: "candidate", includeKeywords: ["大村下坊"], excludeKeywords: [] }
    ],
    getDatasetFreshness: async () => ({ syncedAt: "2026-10-09T03:00:00.000Z", latestRun: { status: "success", completedAt: "2026-10-09T03:00:00.000Z" } }),
    now: () => new Date(2026, 9, 9, 12, 0)
  });
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(),
    gateway: createInProcessFeishuGateway({ gateway: inner }),
    interpret: async () => { throw new Error("应由本地规则识别"); },
    now: () => "2026-10-09T04:00:00.000Z",
    send: async (_chatId, reply) => { sent.push(reply); }
  });
  const menu = await app.handleMessage({ eventId: "g1", openId: "ou-1", chatId: "oc-1", text: "查大村抢修情况" });
  assert.equal(menu.kind, "village-region-menu");
  assert.deepEqual(menu.regions.map((region) => [region.name, region.ponCount]), [["上坊", 19], ["下坊", 1]]);

  await app.handleCallback({ eventId: "g2", openId: "ou-1", chatId: "oc-1", verifiedByTransport: true,
    binding: { token: menu.selection.token, index: 1, action: "village-region-select", expiresAt: menu.selection.expiresAt } });
  const summary = await waitFor(sent, "village-pon-summary");
  assert.equal(summary.village, "大村下坊");
  assert.equal(summary.repairSummary.totals.total, 6);
  assert.equal(summary.repairSummary.totals.degraded, 1);
  assert.equal(summary.repairVerdict, "warning");
  assert.equal(summary.dataFreshness.stale, false);
});

test("小组 PON 口归属：分光地址命中且有本村用户的口纳入，零星口不纳入，手动勾选 / 剔除优先", async () => {
  const { resolveRegionPons, regionLedgerKeywords } = await import("../src/village-regions.mjs");
  const region = { village: "示例村", name: "上坊", includeKeywords: ["示例村上坊", "示例镇上坊"], excludeKeywords: ["别的村"] };
  assert.deepEqual(regionLedgerKeywords(region), ["上坊"]);
  const users = [
    // 1/1/1：上坊用户为主
    ...Array.from({ length: 6 }, (_, i) => ({ oltIp: "10.0.0.1", onuIndex: `1/1/1:${i + 1}`, installationAddress: `示例镇示例村上坊${i}号` })),
    // 1/1/2：只有 1 户上坊（零星），但一级分光地址在上坊，且有本村用户
    { oltIp: "10.0.0.1", onuIndex: "1/1/2:1", installationAddress: "示例镇示例村上坊9号" },
    ...Array.from({ length: 9 }, (_, i) => ({ oltIp: "10.0.0.1", onuIndex: `1/1/2:${i + 2}`, installationAddress: `示例镇示例村下坊${i}号` })),
    // 1/1/3：1 户上坊混在别村大口里，分光点不在上坊 → 零星
    { oltIp: "10.0.0.1", onuIndex: "1/1/3:1", installationAddress: "示例镇示例村上坊8号" },
    ...Array.from({ length: 20 }, (_, i) => ({ oltIp: "10.0.0.1", onuIndex: `1/1/3:${i + 2}`, installationAddress: `示例镇别处${i}号` })),
    // 1/1/4：分光地址叫“上坊”，但没有本村用户（别村同名） → 不纳入
    ...Array.from({ length: 5 }, (_, i) => ({ oltIp: "10.0.0.1", onuIndex: `1/1/4:${i + 1}`, installationAddress: `示例镇别的村上坊大道${i}号` }))
  ];
  const ponPorts = [
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "2", address: "上坊二巷3号" },
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "3", address: "别处一巷" },
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "4", address: "上坊大道" },
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "5", address: "空口" }
  ];
  const resolved = resolveRegionPons(region, { users, ponPorts });
  const summary = (list) => list.map((pon) => `${pon.board}/${pon.pon}:${pon.included ? "Y" : "N"}${pon.ledgerMatch ? "*" : ""}`);
  assert.deepEqual(summary(resolved), ["1/2:Y*", "1/1:Y", "1/3:N"]);
  assert.equal(resolved.find((pon) => pon.pon === "2").ledgerAddress, "上坊二巷3号");

  const manual = resolveRegionPons({ ...region, ponInclude: ["10.0.0.1|1/1/3", "10.0.0.1|1/1/5"], ponExclude: ["10.0.0.1|1/1/1"] }, { users, ponPorts });
  assert.deepEqual(summary(manual), ["1/2:Y*", "1/3:Y", "1/5:Y", "1/1:N"]);
  assert.equal(manual.find((pon) => pon.pon === "1").manual, "exclude");
  assert.equal(manual.find((pon) => pon.pon === "5").manual, "include");
});

test("小组 PON 口勾选：数据库保存键并过滤非法值，接口返回纳入口数", async () => {
  await db.initDb();
  const [region] = await db.saveVillageRegionCandidates("勾选村", [{ name: "东坊", includeKeywords: ["勾选村东坊"] }]);
  const saved = await db.updateVillageRegionPons(region.id, { include: ["10.0.0.1|1/1/9", "bad key", "10.0.0.1|1/1/9"], exclude: ["10.0.0.1|1/1/1", "10.0.0.1|1/1/9"] });
  assert.deepEqual(saved.ponInclude, ["10.0.0.1|1/1/9"]);
  assert.deepEqual(saved.ponExclude, ["10.0.0.1|1/1/1"]);

  const calls = [];
  const res = {};
  await handleFieldRepairRoutes({ method: "PUT", body: { include: ["10.0.0.1|1/1/9"], exclude: [] } }, res, new URL(`http://local/api/village-regions/${region.id}/pons`), {
    opticalBaselineScheduler: { status: async () => ({}) },
    getMergedOnuSnapshots: async () => [{ oltIp: "10.0.0.1", onuIndex: "1/1/1:1", installationAddress: "勾选村东坊1号" }],
    getVillageRegions: db.getVillageRegions,
    updateVillageRegionPons: async (id, input) => { calls.push(input); return db.updateVillageRegionPons(id, input); },
    getPonPorts: async () => [{ oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "9", address: "东坊口" }],
    getOlts: async () => [{ host: "10.0.0.1", vendor: "zte" }],
    readBody: async (req) => req.body,
    json: async (response, status, body) => { response.status = status; response.body = body; }
  });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ include: ["10.0.0.1|1/1/9"], exclude: [] }]);
  assert.equal(res.body.region.ponCount, 2);
  assert.deepEqual(res.body.pons.map((pon) => [pon.pon, pon.included, pon.manual]), [["9", true, "include"], ["1", true, null]]);
});
