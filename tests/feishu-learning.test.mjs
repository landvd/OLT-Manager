import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-feishu-learning-"));

import { aliasCandidate, createFeishuLearningService, feishuQueryOutcome, phraseTemplate } from "../src/feishu-learning-service.mjs";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";
import { handleFeishuLearningRoutes } from "../src/feishu-learning-routes.mjs";
const db = await import("../src/db.mjs");
const require = createRequire(import.meta.url);
const { createFeishuProductionRuntime } = require("../src/feishu/production-runtime.cjs");

function feishuStore() {
  let value = { ...emptyFeishuState(), enabled: true };
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); } };
}

function waitUntil(check) {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const value = await check();
      if (value) { clearInterval(timer); resolve(value); }
    }, 5);
  });
}

test("结果分类：没查到、帮助、出错、查到", () => {
  assert.equal(feishuQueryOutcome({ replyKind: "village-pon-empty" }), "no-result");
  assert.equal(feishuQueryOutcome({ replyKind: "help", replyTopic: "no-result" }), "no-result");
  assert.equal(feishuQueryOutcome({ replyKind: "help", replyTopic: "main" }), "help");
  assert.equal(feishuQueryOutcome({ replyKind: "retry-later" }), "error");
  assert.equal(feishuQueryOutcome({ replyKind: "candidate-set", resultCount: 0 }), "no-result");
  assert.equal(feishuQueryOutcome({ replyKind: "candidate-set", resultCount: 3 }), "answered");
});

test("别名候选：取两句不同的部分并带上相同的字", () => {
  assert.deepEqual(aliasCandidate("查厚接村抢修情况", "查厚街村抢修情况"), { from: "厚接", to: "厚街" });
  assert.deepEqual(aliasCandidate("曹家抢修情况", "厚街村曹家抢修情况"), null);
  assert.deepEqual(aliasCandidate("厚接抢修情况", "厚街村抢修情况"), { from: "厚接", to: "厚街村" });
  assert.equal(aliasCandidate("甲村抢修情况", "甲村抢修情况"), null);
  assert.equal(aliasCandidate("张三", "李四"), null);
});

test("说法模板：把查询值换成 {value}，只有查询值本身时不算", () => {
  assert.equal(phraseTemplate("帮我看看张三的光", "张三"), "帮我看看{value}的光");
  assert.equal(phraseTemplate("张三", "张三"), null);
  assert.equal(phraseTemplate("张三和张三", "张三"), null);
  assert.equal(phraseTemplate("看看李四", "张三"), null);
});

test("日志与学习：记录提问、标记没用、学别名和说法，审核后生效", async () => {
  await db.initDb();
  const service = createFeishuLearningService({
    recordFeishuQueryLog: db.recordFeishuQueryLog,
    markFeishuQueryNegative: db.markFeishuQueryNegative,
    getPreviousFeishuQuery: db.getPreviousFeishuQuery,
    upsertFeishuLearningSuggestion: db.upsertFeishuLearningSuggestion,
    getFeishuLearningSuggestions: db.getFeishuLearningSuggestions,
    now: () => new Date("2026-10-10T01:05:00.000Z")
  });
  const base = { openId: "ou-a", userName: "王工", chatId: "oc-a", chatType: "direct" };
  const t0 = Date.parse("2026-10-10T01:00:00.000Z");
  const at = (minutes) => new Date(t0 + minutes * 60000).toISOString();
  await service.record({ ...base, occurredAt: at(0), text: "查厚接村抢修情况", replyKind: "village-pon-empty", queryType: "find_pons_by_village", resultCount: 0 });
  await service.record({ ...base, occurredAt: at(1), text: "查厚街村抢修情况", replyKind: "village-pon-summary-loading", queryType: "find_pons_by_village", resultCount: 8 });
  await service.record({ ...base, occurredAt: at(2), text: "帮我看看张三的光", replyKind: "candidate-set", queryType: "find_by_name", resultCount: 1, source: "llm", intent: "find_by_name", value: "张三" });
  await service.record({ ...base, occurredAt: at(3), text: "帮我看看李四的光", replyKind: "candidate-set", queryType: "find_by_name", resultCount: 2, source: "llm", intent: "find_by_name", value: "李四" });
  await service.markNegative({ openId: "ou-a", chatId: "oc-a" });

  const suggestions = await db.getFeishuLearningSuggestions({ status: "candidate" });
  const alias = suggestions.find((row) => row.kind === "alias");
  assert.deepEqual([alias.key, alias.target], ["厚接", "厚街"]);
  assert.deepEqual(alias.examples, ["查厚接村抢修情况 → 查厚街村抢修情况"]);
  const phrase = suggestions.find((row) => row.kind === "phrase");
  assert.deepEqual([phrase.key, phrase.target, phrase.hits, phrase.examples], ["帮我看看{value}的光", "find_by_name", 2, ["张三", "李四"]]);
  assert.deepEqual(await service.activeAliases(), []);

  await db.reviewFeishuLearningSuggestion(alias.id, { status: "active" });
  await db.reviewFeishuLearningSuggestion(phrase.id, { status: "active" });
  service.invalidate();
  assert.deepEqual(await service.activeAliases(), [{ from: "厚接", to: "厚街" }]);
  assert.deepEqual(await service.activePhraseRules(), [{ template: "帮我看看{value}的光", intent: "find_by_name" }]);
  await assert.rejects(() => db.reviewFeishuLearningSuggestion(phrase.id, { key: "没有占位" }), /\{value\}/);

  const logs = await db.getFeishuQueryLogs({ days: 3650 });
  assert.equal(logs.total, 4);
  assert.equal(logs.rows[0].feedback, "negative", "“没用”标在最近一条上");
  assert.equal(logs.rows.at(-1).outcome, "no-result");
  assert.equal(logs.rows[0].userName, "王工");
  await db.setFeishuUserName("ou-a", "王师傅");
  assert.equal((await db.getFeishuQueryLogs({ days: 3650 })).rows[0].userName, "王师傅");
  const stats = await db.getFeishuQueryStats({ days: 3650 });
  assert.equal(stats.total, 4);
  assert.equal(stats.noResult, 1);
  assert.equal(stats.negative, 1);
  assert.equal(stats.llmTimes, 2);
  assert.equal(stats.people[0].name, "王师傅");
  assert.ok(stats.problems.some((row) => row.text === "查厚接村抢修情况"));
});

test("飞书应用：按已生效别名改写提问、按已学说法直出，并写入日志", async () => {
  const records = [];
  const queries = [];
  let interpretCalls = 0;
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(),
    gateway: {
      async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
      async queryUsers(request) { queries.push(request); return { authorizedCount: 0, candidates: [] }; },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async queryVillagePons(request) { queries.push(request); return { total: 0, authorizedCount: 0, candidates: [] }; }
    },
    interpret: async () => { interpretCalls += 1; return { type: "query", version: "1", intent: "find_by_name", value: "王五" }; },
    queryLearning: {
      record: async (entry) => { records.push(entry); },
      activeAliases: async () => [{ from: "厚接", to: "厚街" }],
      activePhraseRules: async () => [{ template: "帮我看看{value}的光", intent: "find_by_phone" }]
    },
    now: () => "2026-10-10T01:00:00.000Z",
    send: async () => {}
  });
  await app.handleMessage({ eventId: "l1", openId: "ou-1", chatId: "oc-1", text: "厚接村抢修情况", senderName: "王工" });
  assert.equal(queries[0].value, "厚街村");
  await waitUntil(() => records.length >= 1);
  assert.equal(records[0].text, "厚接村抢修情况");
  assert.equal(records[0].rewrittenText, "厚街村抢修情况");
  assert.equal(records[0].userName, "王工");
  assert.equal(records[0].replyKind, "village-pon-empty");

  await app.handleMessage({ eventId: "l2", openId: "ou-1", chatId: "oc-1", text: "帮我看看13800000000的光" });
  assert.equal(interpretCalls, 0, "已学说法不再调用大模型");
  assert.deepEqual([queries[1].intent, queries[1].value], ["find_by_phone", "13800000000"]);
  await waitUntil(() => records.length >= 2);
  assert.equal(records[1].source, "learned");

  const ignored = await app.handleMessage({ eventId: "l3", kind: "group", openId: "ou-1", chatId: "oc-g", text: "闲聊" });
  assert.deepEqual(ignored, { ignored: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(records.length, 2, "没有 @ 的群消息不记日志");
});

test("机器人菜单：按菜单 key 发对应说明到用户单聊", async () => {
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: feishuStore(),
    gateway: {
      async listOlts() { return []; },
      async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; }
    },
    interpret: async () => null,
    now: () => "2026-10-10T01:00:00.000Z",
    send: async (target, reply, options) => { sent.push({ target, reply, options }); }
  });
  const reply = await app.handleMenu({ eventId: "m1", openId: "ou-9", eventKey: "help-repair" });
  assert.equal(reply.topic, "repair");
  assert.deepEqual(sent[0].options, { receiveIdType: "open_id" });
  assert.equal(sent[0].target, "ou-9");
  assert.deepEqual(await app.handleMenu({ eventId: "m2", openId: "ou-9", eventKey: "unknown" }), { ignored: true });
  assert.deepEqual(await app.handleMenu({ eventId: "m1", openId: "ou-9", eventKey: "help" }), { duplicate: true });
});

test("运行时：菜单事件分派到应用，回复按 open_id 发送；群消息被 @ 时补上姓名和群名", async () => {
  const handlers = {};
  const requests = [];
  const created = [];
  const dispatched = [];
  const sdk = {
    Client: class { constructor() { this.im = { message: { create: async (input) => { created.push(input); return { data: { message_id: "m" } }; } } }; }
      async request(input) { requests.push(input.url); if (input.url.includes("/bot/v3/info")) return { bot: { open_id: "ou-bot" } }; if (input.url.includes("/contact/")) return { data: { user: { name: "王工" } } }; if (input.url.includes("/chats/")) return { data: { name: "抢修群" } }; return {}; } },
    WSClient: class { async start() {} close() {} },
    EventDispatcher: class { register(map) { Object.assign(handlers, map); return this; } },
    LoggerLevel: { info: 2 }
  };
  const runtime = createFeishuProductionRuntime({
    sdk,
    readSecret: async () => "secret",
    onMessage: async ({ kind, event }) => { dispatched.push({ kind, event }); return { kind: "ok" }; },
    log: () => {}
  });
  await runtime.start({ appId: "cli_0123456789abcdef", credentialReference: "ref" });
  await handlers["application.bot.menu_v6"]({ event_id: "e-menu", operator: { operator_id: { open_id: "ou-1" } }, event_key: "help" });
  assert.deepEqual([dispatched[0].kind, dispatched[0].event.openId, dispatched[0].event.eventKey], ["menu", "ou-1", "help"]);
  await runtime.sendReply("ou-1", { kind: "help", message: "x" }, { receiveIdType: "open_id" });
  assert.equal(created[0].params.receive_id_type, "open_id");

  await handlers["im.message.receive_v1"]({
    event_id: "e-group", sender: { sender_id: { open_id: "ou-2" } },
    message: { chat_id: "oc-g", chat_type: "group", message_type: "text", content: JSON.stringify({ text: "@_user_1 帮助" }), mentions: [{ key: "@_user_1", id: { open_id: "ou-bot" } }] }
  });
  const groupEvent = dispatched.at(-1).event;
  assert.equal(groupEvent.mentioned, true);
  assert.equal(groupEvent.senderName, "王工");
  assert.equal(groupEvent.chatName, "抢修群");
});

test("日志接口：查询、统计、备注名、手动添加别名", async () => {
  await db.initDb();
  let invalidated = 0;
  const responses = [];
  const call = async (method, path, body) => {
    const url = new URL(`http://local${path}`);
    await handleFeishuLearningRoutes({ method }, {}, url, {
      getFeishuQueryLogs: db.getFeishuQueryLogs,
      getFeishuQueryStats: db.getFeishuQueryStats,
      setFeishuUserName: db.setFeishuUserName,
      getFeishuLearningSuggestions: db.getFeishuLearningSuggestions,
      upsertFeishuLearningSuggestion: db.upsertFeishuLearningSuggestion,
      reviewFeishuLearningSuggestion: db.reviewFeishuLearningSuggestion,
      deleteFeishuLearningSuggestion: db.deleteFeishuLearningSuggestion,
      feishuLearning: { invalidate() { invalidated += 1; } },
      readBody: async () => body || {},
      json: async (_res, status, payload) => { responses.push({ status, payload }); }
    });
    return responses.at(-1);
  };
  const added = await call("POST", "/api/feishu-learning/suggestions", { kind: "alias", key: "三屯", target: "三屯村" });
  assert.equal(added.payload.row.status, "active");
  assert.equal(invalidated, 1);
  const bad = await call("POST", "/api/feishu-learning/suggestions", { kind: "phrase", key: "没有占位", target: "find_by_name" });
  assert.equal(bad.status, 400);
  const listed = await call("GET", "/api/feishu-learning/suggestions?kind=alias&status=active");
  assert.ok(listed.payload.rows.some((row) => row.key === "三屯"));
  const logs = await call("GET", "/api/feishu-logs?days=3650&outcome=negative");
  assert.equal(logs.status, 200);
  const stats = await call("GET", "/api/feishu-logs/stats?days=7");
  assert.equal(stats.status, 200);
  const named = await call("PUT", "/api/feishu-users/ou-z", { name: "李工" });
  assert.deepEqual(named.payload.user, { openId: "ou-z", name: "李工" });
});
