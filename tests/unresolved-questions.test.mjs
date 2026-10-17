import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isNegativeFeedback, normalizeQuestion } from "../src/question-text.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-unresolved-questions-"));
const db = await import("../src/db.mjs");
const { handleUnresolvedQuestionRoutes } = await import("../src/unresolved-question-routes.mjs");
const { createFeishuQueryApplication } = await import("../src/feishu/application.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");

test("否定反馈与问题规范化", () => {
  assert.equal(isNegativeFeedback("不对，应该是2049"), true);
  assert.equal(isNegativeFeedback("没用"), true);
  assert.equal(isNegativeFeedback("对的"), false);
  assert.equal(normalizeQuestion("请问 怎么查未注册ONU？"), "怎么查未注册ONU");
});

async function call(method, path, body) {
  const res = {};
  const handled = await handleUnresolvedQuestionRoutes({ method, body }, res, new URL(`http://local${path}`), {
    getUnresolvedQuestions: db.getUnresolvedQuestions,
    updateUnresolvedQuestion: db.updateUnresolvedQuestion,
    saveLearnedMemory: db.saveLearnedMemory,
    readBody: async (req) => req.body,
    json: async (response, status, payload) => { response.status = status; response.body = payload; }
  });
  return { handled, ...res };
}

test("未解决问题：重复累计、列表、补答后成为常见问题记忆并能被召回、忽略", async () => {
  await db.initDb();
  await db.recordUnresolvedQuestion({ question: "怎么查 未注册的光猫？", reason: "no-answer", source: "feishu" });
  const again = await db.recordUnresolvedQuestion({ question: "请问怎么查未注册的光猫", reason: "negative-feedback", source: "feishu" });
  assert.equal(again.askCount, 2);
  const other = await db.recordUnresolvedQuestion({ question: "C600 怎么改 VLAN", reason: "no-answer", source: "feishu" });

  const list = await call("GET", "/api/unresolved-questions?status=open");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.rows.map((row) => row.id).sort(), [again.id, other.id].sort());

  const answered = await call("PUT", `/api/unresolved-questions/${again.id}`, { question: again.question, answer: "飞书发“查某某村未注册”即可" });
  assert.equal(answered.body.row.status, "answered");
  assert.ok(answered.body.row.memoryId);
  const recalled = await db.queryLearnedMemories({ questionText: normalizeQuestion("怎么查未注册的光猫？") });
  assert.equal(recalled[0].domain, "faq");
  assert.match(recalled[0].fact_content, /查某某村未注册/);

  const ignored = await call("PUT", `/api/unresolved-questions/${other.id}`, { status: "ignored" });
  assert.equal(ignored.body.row.status, "ignored");
  assert.equal((await call("POST", `/api/unresolved-questions/${other.id}/draft`, { question: "x" })).status, 503);
  assert.equal((await call("GET", "/api/field-archive/events")).handled, false, "抢修档案接口已删除");
});

test("飞书：否定反馈和查不到村名记为未解决问题", async () => {
  const questions = [];
  let state = { ...emptyFeishuState(), enabled: true };
  let current = new Date("2026-10-10T08:00:00.000Z");
  const app = createFeishuQueryApplication({
    stateStore: { async read() { return structuredClone(state); }, async write(next) { state = structuredClone(next); } },
    gateway: {
      async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
      async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async queryVillagePons(request) { return { total: 0, authorizedCount: 0, offset: request.offset, limit: 5, hasMore: false, candidates: [] }; }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "某人" }),
    piAgentEngine: { async chat() { return { reply: "这是回答" }; } },
    fieldRecorder: { recordQuestion: async (input) => { questions.push(input); } },
    now: () => current.toISOString(),
    send: async () => {}
  });
  const ask = async (eventId, text) => {
    current = new Date(current.getTime() + 60_000);
    return app.handleMessage({ eventId, openId: "ou-1", chatId: "oc-1", text });
  };
  await ask("q1", "C600 怎么看光功率");
  await ask("q2", "不对，不是这个");
  await ask("q3", "查不存在村抢修情况");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(questions.map((item) => [item.question, item.reason]), [
    ["C600 怎么看光功率", "negative-feedback"],
    ["查不存在村抢修情况", "village-no-match"]
  ]);
});
