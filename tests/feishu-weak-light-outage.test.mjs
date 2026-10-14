import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createOltDataGateway } from "../src/olt-data-gateway.mjs";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { createInProcessFeishuGateway } from "../src/feishu/gateway-contract.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

// 合成数据：甲村 1/1/1 口 6 户、1/1/2 口 6 户，另有 1/1/3 口只有 1 户甲村（零星）。
function users() {
  const rows = [];
  for (const pon of ["1", "2"]) {
    for (let onu = 1; onu <= 6; onu += 1) {
      rows.push({ oltIp: "192.0.2.1", onuIndex: `1/1/${pon}:${onu}`, username: `用户${pon}-${onu}`, userPhone: onu === 1 ? "13800000001" : "", installationAddress: `合成镇甲村东坊${pon}-${onu}号` });
    }
  }
  rows.push({ oltIp: "192.0.2.1", onuIndex: "1/1/3:1", username: "零星", installationAddress: "合成镇甲村西坊1号" });
  for (let onu = 2; onu <= 8; onu += 1) rows.push({ oltIp: "192.0.2.1", onuIndex: `1/1/3:${onu}`, username: `别村${onu}`, installationAddress: `合成镇乙村${onu}号` });
  return rows;
}

const latestSamples = [
  ...Array.from({ length: 6 }, (_, index) => ({ chassis: "1", board: "1", pon: "1", onuId: String(index + 1), sampleDate: "2026-10-09", phase: "online", rxDbm: index < 3 ? -28.5 + index * 0.2 : -20 })),
  ...Array.from({ length: 6 }, (_, index) => ({ chassis: "1", board: "1", pon: "2", onuId: String(index + 1), sampleDate: "2026-10-09", phase: index === 0 ? "offline" : "online", rxDbm: index === 0 ? null : index === 1 ? -27 : -19 }))
];

const occurrences = [
  { ponKey: "192.0.2.1|1/1/1", startedAt: "2026-09-01T02:00:00.000Z", recoveredAt: "2026-09-01T08:00:00.000Z", source: "nightly-offline" },
  { ponKey: "192.0.2.1|1/1/2", startedAt: "2026-09-01T02:10:00.000Z", recoveredAt: "2026-09-01T08:00:00.000Z", source: "nightly-offline" },
  { ponKey: "192.0.2.1|1/1/1", startedAt: "2026-10-05T03:00:00.000Z", recoveredAt: "", source: "feishu-query" },
  { ponKey: "192.0.2.1|1/1/3", startedAt: "2026-10-06T03:00:00.000Z", recoveredAt: "", source: "nightly-offline" }
];

function buildApp({ withSamples = true } = {}) {
  const inner = createOltDataGateway({
    getOlts: async () => [{ id: "olt-a", name: "A", vendor: "zte", model: "C300", host: "192.0.2.1", enabled: true }],
    getUsers: async () => users(),
    getPonPorts: async () => [],
    getDatasetRevision: async () => "rev",
    listOnus: async () => [],
    getLatestOpticalSamples: withSamples ? async ({ oltId }) => (oltId === "olt-a" ? latestSamples : []) : null,
    getOutageOccurrences: async () => occurrences,
    getVillageRegions: async () => [],
    now: () => new Date("2026-10-09T12:00:00.000Z")
  });
  let state = { ...emptyFeishuState(), enabled: true };
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: { async read() { return structuredClone(state); }, async write(next) { state = structuredClone(next); } },
    gateway: createInProcessFeishuGateway({ gateway: inner }),
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "张三" }),
    now: () => "2026-10-09T12:00:00.000Z",
    send: async (_chatId, reply) => { sent.push(reply); }
  });
  return { app, sent, auditTypes: () => state.auditArchive.map((item) => item.queryType) };
}

test("飞书弱光查询：按最近一晚夜间采样列出 ≤ -27 dBm 的用户，最差在前", async () => {
  const { app, auditTypes } = buildApp();
  const reply = await app.handleMessage({ eventId: "w1", openId: "ou-1", chatId: "oc-1", text: "查甲村弱光用户" });
  assert.equal(reply.kind, "weak-light");
  assert.equal(reply.place, "甲村");
  assert.equal(reply.totalUsers, 13);
  assert.equal(reply.sampled, 12);
  assert.equal(reply.offline, 1);
  assert.equal(reply.weakCount, 4);
  assert.deepEqual(reply.users.map((user) => user.rxDbm), [-28.5, -28.3, -28.1, -27]);
  assert.equal(reply.users[0].phone, "13800000001");
  assert.deepEqual(reply.pons.map((pon) => [pon.pon.pon, pon.weakCount]), [["1", 3], ["2", 1]]);
  assert.equal(auditTypes().at(-1), "weak_light");
  const card = JSON.stringify(renderReply(reply).content);
  assert.match(card, /甲村 · 弱光用户/);
  assert.match(card, /-28.50 dBm/);
  assert.match(card, /弱光最集中的口/);
  assert.match(card, /2026-10-09 夜间采集/);
  assert.match(card, /tel:13800000001/);
});

test("飞书弱光查询：没有夜间采样时提示，地名查不到时按普通查询处理", async () => {
  const { app } = buildApp({ withSamples: false });
  const none = await app.handleMessage({ eventId: "w2", openId: "ou-1", chatId: "oc-1", text: "甲村光衰情况" });
  assert.equal(none.kind, "weak-light");
  assert.equal(none.status, "no-baseline");
  assert.match(JSON.stringify(renderReply(none).content), /夜间采集跑过一晚/);

  const { app: other } = buildApp();
  const person = await other.handleMessage({ eventId: "w3", openId: "ou-1", chatId: "oc-1", text: "张三光衰" });
  assert.notEqual(person.kind, "weak-light");
});

test("飞书断纤记录：只看地名的主要口，按事件归并，统计经常断的口", async () => {
  const { app, auditTypes } = buildApp();
  const reply = await app.handleMessage({ eventId: "o1", openId: "ou-1", chatId: "oc-1", text: "甲村最近断过几次" });
  assert.equal(reply.kind, "outage-history");
  assert.equal(reply.ponCount, 2, "零星口 1/1/3 不算");
  assert.equal(reply.eventCount, 2);
  assert.equal(reply.events[0].startedAt, "2026-10-05T03:00:00.000Z");
  assert.deepEqual(reply.events[1].pons.map((pon) => pon.pon.pon).sort(), ["1", "2"]);
  assert.deepEqual(reply.frequentPons[0], { oltName: "A", pon: { chassis: "1", board: "1", pon: "1" }, count: 2 });
  assert.equal(auditTypes().at(-1), "outage_history");
  const card = JSON.stringify(renderReply(reply).content);
  assert.match(card, /甲村 · 断纤记录/);
  assert.match(card, /断纤 \*\*2\*\* 次/);
  assert.match(card, /经常断的口/);
  assert.match(card, /未记录恢复/);
});
