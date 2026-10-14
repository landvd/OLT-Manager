import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-conversation-logs-"));

const db = await import("../src/db.mjs");
const { createFeishuQueryApplication, replyLogText } = await import("../src/feishu/application.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");
const { turnTrace } = await import("../src/pi-agent/pi-sdk-adapter.mjs");
const { createPiAgentEngine } = await import("../src/pi-agent/pi-agent-engine.mjs");

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("调试日志：写入、按来源和关键词筛选、详情带出同一请求的 Pi 记录", async () => {
  await db.initDb();
  await db.recordConversationLog({ channel: "feishu", requestId: "feishu:e1", openId: "ou-1", userName: "外勤乙", input: "顺景大厦", replyKind: "candidate-set", replyText: "共 26 条", durationMs: 1200 });
  await db.recordConversationLog({ channel: "pi-feishu", requestId: "feishu:e1", input: "顺景大厦", replyText: "查到 26 户", trace: [{ type: "toolCall", name: "olt_search_records", arguments: { query: "顺景大厦" } }, { type: "toolResult", name: "olt_search_records", result: "{\"total\":26}" }], source: "pi-sdk-agent" });
  await db.recordConversationLog({ channel: "feishu-callback", requestId: "feishu:e2", input: "按钮：onu-edit-submit", replyText: "已提交", error: "" });
  const all = await db.getConversationLogs({ days: 1 });
  assert.equal(all.total, 3);
  assert.equal(all.rows[0].channel, "feishu-callback");
  const pi = await db.getConversationLogs({ channel: "pi", days: 1 });
  assert.deepEqual(pi.rows.map((row) => [row.channel, row.toolCount]), [["pi-feishu", 2]]);
  const searched = await db.getConversationLogs({ q: "外勤乙", days: 1 });
  assert.equal(searched.total, 1);
  const detail = await db.getConversationLog(searched.rows[0].id);
  assert.equal(detail.related.length, 1);
  assert.equal(detail.related[0].trace[0].arguments.query, "顺景大厦");
});

test("导出所选：带出同一请求的 Pi 记录，按时间正序，忽略无效编号", async () => {
  const feishu = (await db.getConversationLogs({ channel: "feishu", days: 1 })).rows[0];
  const exported = await db.getConversationLogsForExport([feishu.id, "x", -1]);
  assert.deepEqual(exported.map((item) => item.channel), ["feishu", "pi-feishu"]);
  assert.equal(exported[1].trace.length, 2);
  assert.deepEqual(await db.getConversationLogsForExport([]), []);
});

test("Pi 本轮过程：模型说明、工具调用参数、工具返回和用量", () => {
  const trace = turnTrace([
    { role: "assistant", content: [{ type: "text", text: "我先查一下" }, { type: "toolCall", id: "c1", name: "olt_find_weak_light", arguments: { place: "双岗村" } }], usage: { input: 1000, output: 50 }, stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "c1", toolName: "olt_find_weak_light", content: [{ type: "text", text: "{\"weakCount\":17}" }], isError: false, durationMs: 320 },
    { role: "assistant", content: [{ type: "text", text: "双岗村有 17 户弱光" }], usage: { input: 1200, output: 80 }, stopReason: "stop" }
  ]);
  assert.deepEqual(trace.map((step) => step.type), ["text", "toolCall", "usage", "toolResult", "text", "usage"]);
  assert.deepEqual(trace[1].arguments, { place: "双岗村" });
  assert.equal(trace[3].durationMs, 320);
  assert.equal(trace[3].result, "{\"weakCount\":17}");
});

test("Pi 引擎每轮问答写调试日志：SDK 结果带工具过程，SDK 出错时记下原因并照常回退", async () => {
  const logs = [];
  const sdk = {
    chat: async ({ messages }) => messages.at(-1).content === "出错"
      ? { reply: "Pi SDK 暂不可用：超时", source: "pi-sdk-error", toolsUsed: [] }
      : { reply: "双岗村有 17 户弱光", source: "pi-sdk-agent", toolsUsed: [{ name: "olt_find_weak_light" }], trace: [{ type: "toolCall", name: "olt_find_weak_light", arguments: { place: "双岗村" } }], model: "glm" }
  };
  const engine = createPiAgentEngine({
    piSdkAdapter: sdk,
    getLanguageConfig: async () => null,
    queryLearnedMemories: async () => [],
    saveLearnedMemory: null,
    recordConversationLog: (entry) => { logs.push(entry); }
  });
  const answer = await engine.chat({ messages: [{ role: "user", content: "双岗村弱光" }], context: { piSdk: true, channel: "feishu", conversationKey: "feishu:oc|ou", requestId: "feishu:e9", readonlyScope: { oltIds: ["olt-1"] } } });
  assert.equal(answer.reply, "双岗村有 17 户弱光");
  await settle();
  assert.equal(logs[0].channel, "pi-feishu");
  assert.equal(logs[0].requestId, "feishu:e9");
  assert.equal(logs[0].trace[0].name, "olt_find_weak_light");
  assert.match(logs[0].source, /pi-sdk-agent · glm/);
  const fallback = await engine.chat({ messages: [{ role: "user", content: "出错" }], context: { piSdk: true, channel: "desktop", readonlyScope: { oltIds: ["olt-1"] } } });
  assert.notEqual(fallback.source, "pi-sdk-error");
  await settle();
  assert.equal(logs[1].channel, "pi-desktop");
  assert.match(logs[1].error, /超时/);
});

test("飞书消息和按钮都写调试日志：记下识别结果和这次发出的全部回复，不记按钮令牌", async () => {
  const logs = [];
  let state = { ...emptyFeishuState(), enabled: true };
  const app = createFeishuQueryApplication({
    stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
    gateway: {
      listOlts: async () => [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }],
      queryUsers: async () => ({ authorizedCount: 2, candidates: [1, 2].map((index) => ({
        candidateId: `olt-1:1/7/8:${index}`, oltId: "olt-1", name: `用户${index}`, phone: "", address: "顺景大厦", loid: "", mac: "",
        onu: { chassis: "1", board: "7", pon: "8", onuId: String(index) }, snapshotAt: null
      })) }),
      queryPons: async () => ({ authorizedCount: 0, candidates: [] })
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_address", value: "顺景大厦" }),
    conversationLog: (entry) => { logs.push(entry); },
    send: async () => {},
    now: () => "2026-10-13T06:00:00.000Z"
  });
  const reply = await app.handleMessage({ eventId: "m1", openId: "ou-1", chatId: "oc-1", text: "顺景大厦", senderName: "外勤乙" });
  assert.equal(reply.kind, "candidate-set");
  await settle();
  assert.equal(logs[0].channel, "feishu");
  assert.equal(logs[0].requestId, "feishu:m1");
  assert.equal(logs[0].userName, "外勤乙");
  assert.match(logs[0].interpretation, /find_by_address=顺景大厦/);
  assert.match(logs[0].replyText, /【回复 1 · candidate-set】/);
  assert.match(logs[0].replyText, /用户1/);
  assert.equal(logs[0].replyText.includes(reply.selection.token), false);
  await app.handleCallback({ eventId: "c1", kind: "callback", verifiedByTransport: true, openId: "ou-1", chatId: "oc-1", binding: { token: "nope", index: 0, action: "onu-edit-submit" }, formValue: { place: "新塘村" } });
  await settle();
  assert.equal(logs[1].channel, "feishu-callback");
  assert.match(logs[1].input, /按钮：onu-edit-submit #0 表单：\{"place":"新塘村"\}/);
  assert.match(logs[1].replyText, /候选绑定不存在或已失效/);
  assert.equal(replyLogText({ kind: "x", message: "你好" }), "你好");
});
