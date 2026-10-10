import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { detectPonOutage, groupOutageEvents, inferCableGroups, isNegativeFeedback, normalizeQuestion } from "../src/outage-events.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-field-archive-"));
const db = await import("../src/db.mjs");
const { createFieldArchiveService } = await import("../src/field-archive-service.mjs");
const { handleFieldArchiveRoutes } = await import("../src/field-archive-routes.mjs");
const { createOpticalBaselineScheduler } = await import("../src/optical-baseline-scheduler.mjs");
const { createFeishuQueryApplication } = await import("../src/feishu/application.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");
const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

const onu = (onuId, phase, cause = "", time = "") => ({ chassis: "1", board: "2", pon: "3", onuId: String(onuId), phase, lastOfflineCause: cause, lastOfflineTime: time });

test("断纤识别：整口 100% 离线为进行中；C300 全部 ONU 同一时段 LOS 离线后已恢复也能补记；掉电、部分离线和单户口不算", () => {
  const now = new Date("2026-10-10T20:00:00");
  const ongoing = detectPonOutage([onu(1, "offline"), onu(2, "LOS"), onu(3, "offline"), onu(4, "DyingGasp")], { now });
  assert.equal(ongoing.kind, "ongoing");
  assert.equal(ongoing.affected, 4);
  // 用户少的口：只要还有一户在线就不算断纤。
  assert.equal(detectPonOutage([onu(1, "offline"), onu(2, "offline"), onu(3, "offline"), onu(4, "offline"), onu(5, "online")], { now }), null);
  assert.equal(detectPonOutage([onu(1, "offline"), onu(2, "online")], { now }), null);
  assert.equal(detectPonOutage([onu(1, "offline"), onu(2, "LOS")], { now }).kind, "ongoing");
  assert.equal(detectPonOutage([onu(1, "offline")], { now }), null);
  // 全口都是掉电属于停电。
  assert.equal(detectPonOutage([onu(1, "DyingGasp"), onu(2, "dyinggasp"), onu(3, "掉电")], { now }), null);
  // 只有部分 ONU 在同一窗口 LOS 离线，不补记。
  assert.equal(detectPonOutage([1, 2, 3, 4].map((id) => onu(id, "online", "LOS", `2026-10-10 14:0${id}:30`)).concat(onu(5, "online")), { now }), null);
  const recovered = detectPonOutage([1, 2, 3, 4, 5].map((id) => onu(id, "online", "LOS", `2026-10-10 14:0${id}:30`)), { now });
  assert.equal(recovered.kind, "recovered");
  assert.equal(recovered.affected, 5);
  assert.equal(new Date(recovered.startedAt).getTime(), new Date("2026-10-10T14:01:30").getTime());
  assert.equal(detectPonOutage([1, 2, 3, 4, 5].map((id) => onu(id, "online", "DyingGasp", "2026-10-10 14:00:00")), { now }), null);
  assert.equal(detectPonOutage([1, 2, 3, 4, 5].map((id) => onu(id, "online", "LOS", `2026-10-0${id} 14:00:00`)), { now }), null);
  assert.equal(detectPonOutage([1, 2, 3, 4, 5].map((id) => onu(id, "online", "LOS", "2026-10-08 14:00:00")), { now }), null);
});

test("事件归并与同缆组推断：多次一起断的口成组，只断过一次的不算", () => {
  const at = (day, minute) => `2026-10-0${day}T06:${String(minute).padStart(2, "0")}:00.000Z`;
  const events = groupOutageEvents([
    { ponKey: "A", startedAt: at(1, 0) }, { ponKey: "B", startedAt: at(1, 5) }, { ponKey: "C", startedAt: at(1, 8) },
    { ponKey: "A", startedAt: at(4, 0) }, { ponKey: "B", startedAt: at(4, 20) },
    { ponKey: "A", startedAt: at(7, 0) }, { ponKey: "B", startedAt: at(7, 1) }, { ponKey: "D", startedAt: at(7, 2) },
    { ponKey: "E", startedAt: at(8, 0) }
  ]);
  assert.equal(events.length, 4);
  assert.deepEqual(inferCableGroups(events), [{ ponKeys: ["A", "B"], together: 3, maxTogether: 3 }]);
});

test("否定反馈与问题规范化", () => {
  assert.equal(isNegativeFeedback("不对，应该是2049"), true);
  assert.equal(isNegativeFeedback("没用"), true);
  assert.equal(isNegativeFeedback("对的"), false);
  assert.equal(normalizeQuestion("请问 怎么查未注册ONU？"), "怎么查未注册ONU");
});

function archive(overrides = {}) {
  return createFieldArchiveService({
    getOlts: async () => [{ id: "olt-a", name: "A", host: "10.0.0.1", vendor: "zte" }, { id: "olt-b", name: "B", host: "10.0.0.2", vendor: "huawei" }],
    getPonPorts: async () => [{ oltIp: "10.0.0.1", chassis: "1", board: "2", pon: "4", address: "菊塘五巷6号" }],
    recordOutageOccurrences: db.recordOutageOccurrences,
    closeOutageOccurrences: db.closeOutageOccurrences,
    getOutageOccurrences: db.getOutageOccurrences,
    recordRepairInspection: db.recordRepairInspection,
    getRepairInspections: db.getRepairInspections,
    saveCableGroupCandidates: db.saveCableGroupCandidates,
    getCableGroups: db.getCableGroups,
    recordUnresolvedQuestion: db.recordUnresolvedQuestion,
    ...overrides
  });
}

test("抢修档案：夜间采集记录断纤、恢复后关闭；飞书验收存档；同缆组确认后给出提示", async () => {
  await db.initDb();
  let clock = new Date("2026-10-01T02:00:00");
  const service = archive({ now: () => clock });
  const olt = { id: "olt-a", name: "A", host: "10.0.0.1", vendor: "zte" };
  const ponRows = (pon, phase) => [1, 2, 3].map((id) => ({ ...onu(id, phase), pon: String(pon) }));
  // 第一次：3 口和 4 口同时整口离线
  await service.afterOltCapture(olt, [...ponRows(3, "offline"), ...ponRows(4, "offline"), ...ponRows(5, "online")]);
  let occurrences = await db.getOutageOccurrences();
  assert.deepEqual(occurrences.map((item) => [item.ponKey, item.recoveredAt === ""]), [["10.0.0.1|1/2/3", true], ["10.0.0.1|1/2/4", true]]);
  // 恢复后关闭
  clock = new Date("2026-10-02T02:00:00");
  await service.afterOltCapture(olt, [...ponRows(3, "online"), ...ponRows(4, "online")]);
  occurrences = await db.getOutageOccurrences();
  assert.ok(occurrences.every((item) => item.recoveredAt));
  // 第二次：飞书抢修查询发现两口整口离线
  clock = new Date("2026-10-05T10:00:00");
  await service.recordInspection({
    queryValue: "示例村菊塘",
    pons: [{ oltId: "olt-a", pon: { chassis: "1", board: "2", pon: "3" } }, { oltId: "olt-a", pon: { chassis: "1", board: "2", pon: "4" } }],
    outagePons: [{ oltId: "olt-a", pon: { chassis: "1", board: "2", pon: "3" }, configuredCount: 8 }, { oltId: "olt-a", pon: { chassis: "1", board: "2", pon: "4" }, configuredCount: 9 }],
    verdict: "outage",
    summary: { total: 2 }
  });
  const inspections = await db.getRepairInspections();
  assert.deepEqual(inspections[0].ponKeys, ["10.0.0.1|1/2/3", "10.0.0.1|1/2/4"]);
  const groups = await db.getCableGroups({ status: "candidate" });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ponKeys, ["10.0.0.1|1/2/3", "10.0.0.1|1/2/4"]);
  assert.deepEqual(await service.cableHints([{ oltId: "olt-a", pon: { chassis: "1", board: "2", pon: "3" } }]), []);
  await db.reviewCableGroup(groups[0].id, { status: "active" });
  const hints = await service.cableHints([{ oltId: "olt-a", pon: { chassis: "1", board: "2", pon: "3" } }]);
  assert.equal(hints[0].together, 2);
  assert.deepEqual(hints[0].partners, [{ ponKey: "10.0.0.1|1/2/4", oltIp: "10.0.0.1", coordinate: "1/2/4", address: "菊塘五巷6号" }]);

  const events = await service.listEvents({ days: 3650 });
  assert.equal(events.length, 2);
  assert.equal(events[0].inspections.length, 1);
  assert.equal(events[0].pons[1].address, "菊塘五巷6号");
});

test("未解决问题：重复累计、补答后成为常见问题规约并能被召回", async () => {
  await db.initDb();
  await db.recordUnresolvedQuestion({ question: "怎么查 未注册的光猫？", reason: "no-answer", source: "feishu" });
  const again = await db.recordUnresolvedQuestion({ question: "请问怎么查未注册的光猫", reason: "negative-feedback", source: "feishu" });
  assert.equal(again.askCount, 2);
  const res = {};
  await handleFieldArchiveRoutes({ method: "PUT", body: { question: again.question, answer: "飞书发“查某某村未注册”即可" } }, res,
    new URL(`http://local/api/field-archive/questions/${again.id}`), {
      fieldArchive: {},
      updateUnresolvedQuestion: db.updateUnresolvedQuestion,
      saveLearnedMemory: db.saveLearnedMemory,
      readBody: async (req) => req.body,
      json: async (response, status, body) => { response.status = status; response.body = body; }
    });
  assert.equal(res.body.row.status, "answered");
  assert.ok(res.body.row.memoryId);
  const recalled = await db.queryLearnedMemories({ questionText: normalizeQuestion("怎么查未注册的光猫？") });
  assert.equal(recalled[0].domain, "faq");
  assert.match(recalled[0].fact_content, /查某某村未注册/);
});

test("夜间采集调度在每台 OLT 后和整轮结束后调用抢修档案回调", async () => {
  const calls = [];
  const scheduler = createOpticalBaselineScheduler({
    getSettings: async () => ({ enabled: true, runHour: 2 }),
    getOlts: async () => [{ id: "a", name: "A", enabled: true }],
    readOltRows: async () => [{ chassis: "1", board: "1", pon: "1", onuId: "1", phase: "online", rxPower: "-20" }],
    recordSamples: async ({ rows }) => ({ count: rows.length }),
    beginRun: async () => 1,
    finishRun: async () => {},
    getRuns: async () => [],
    onOltRows: async (olt, rows) => { calls.push(["olt", olt.id, rows.length]); },
    onRunComplete: async () => { calls.push(["done"]); },
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {}
  });
  await scheduler.runNow();
  assert.deepEqual(calls, [["olt", "a", 1], ["done"]]);
});

function feishuStore() {
  let value = { ...emptyFeishuState(), enabled: true };
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); } };
}

test("飞书：否定反馈和查不到村名记为未解决问题；抢修验收存档并显示同缆提示", async () => {
  const questions = [];
  const inspections = [];
  const recorder = {
    recordQuestion: async (input) => { questions.push(input); },
    recordInspection: async (input) => { inspections.push(input); },
    cableHints: async (pons) => pons.map((item) => ({ ponKey: "k", pon: item.pon, together: 3, partners: [{ ponKey: "p", oltIp: "10.0.0.1", coordinate: "1/2/9", address: "菊塘十巷" }] }))
  };
  let current = new Date("2026-10-10T08:00:00.000Z");
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(),
    gateway: {
      async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
      async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async queryVillagePons(request) {
        if (request.value.startsWith("不存在")) return { total: 0, authorizedCount: 0, offset: request.offset, limit: 5, hasMore: false, candidates: [] };
        return { total: 1, authorizedCount: 1, offset: request.offset, limit: 5, hasMore: false,
          candidates: [{ candidateId: "olt-1:1/2/3", oltId: "olt-1", oltName: "OLT 1", address: "菊塘五巷", pon: { chassis: "1", board: "2", pon: "3" } }] };
      },
      async sampleVillagePonOnlineUser() { return { candidate: null, liveStatus: null, ponStatus: { status: "all-offline", configuredCount: 8 } }; }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "某人" }),
    piAgentEngine: { async chat() { return { reply: "这是回答" }; } },
    fieldRecorder: recorder,
    now: () => current.toISOString(),
    send: async (_chatId, reply) => { sent.push(reply); }
  });
  const ask = async (eventId, text) => {
    current = new Date(current.getTime() + 60_000);
    return app.handleMessage({ eventId, openId: "ou-1", chatId: "oc-1", text });
  };
  await ask("q1", "C600 怎么看光功率");
  await ask("q2", "不对，不是这个");
  await ask("q3", "查不存在村抢修情况");
  await ask("q4", "查示例村抢修情况");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(questions.map((item) => [item.question, item.reason]), [
    ["C600 怎么看光功率", "negative-feedback"],
    ["查不存在村抢修情况", "village-no-match"]
  ]);
  assert.equal(inspections.length, 1);
  assert.equal(inspections[0].queryValue, "示例村");
  assert.deepEqual(inspections[0].outagePons, [{ oltId: "olt-1", pon: { chassis: "1", board: "2", pon: "3" }, configuredCount: 8 }]);
  const summary = sent.find((reply) => reply.kind === "village-pon-summary");
  assert.equal(summary.cableHints.length, 1);
  assert.match(JSON.stringify(renderReply(summary).content), /同缆提示.*1\/2\/9（菊塘十巷）.*一并检查/);
});
