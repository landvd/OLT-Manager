import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-agent-review-"));

const db = await import("../src/db.mjs");
const { createPiAgentEngine } = await import("../src/pi-agent/pi-agent-engine.mjs");
const { handlePiAgentRoutes } = await import("../src/pi-agent/routes.mjs");
const { applyUserCorrections } = await import("../src/merged-onu-sync.mjs");
const { createFeishuQueryApplication } = await import("../src/feishu/application.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");

const backup = { path: "/b.sqlite", bytes: 1, sha256: "s" };

async function seedMergedUsers() {
  const row = (onuId, loid, username, userPhone) => ({
    oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "1", onuId: String(onuId), onuIndexDisplay: `1/1/1:${onuId}`,
    loid, loidDisplay: loid, username, usernameSource: "nmse", userPhone, installationAddress: "示例村1号",
    deviceType: "", ponType: "", phase: "", rxPower: "", distance: "", nmseOltIp: "", nmseOnuIndex: ""
  });
  await db.replaceMergedOnuDataset({
    runId: `seed-${Date.now()}`, operation: "merge", backup, conflicts: [], networkCount: 3, nmseCount: 3,
    rows: [row(1, "LOID-A", "张三", "13800000001"), row(2, "LOID-B", "李四", "13800000002"), row(3, "LOID-C", "李四", "13800000003")]
  });
}

function engineWith({ sdkReply = null, prompts = [] } = {}) {
  return createPiAgentEngine({
    saveLearnedMemory: db.saveLearnedMemory,
    queryLearnedMemories: db.queryLearnedMemories,
    incrementMemoryHitCount: db.incrementMemoryHitCount,
    getLearnedMemories: db.getLearnedMemories,
    deleteLearnedMemory: db.deleteLearnedMemory,
    reviewLearnedMemory: db.reviewLearnedMemory,
    saveUserCorrection: db.saveUserCorrection,
    getMergedOnuRecords: () => db.getMergedOnuSnapshots(),
    piSdkAdapter: sdkReply === null ? null : {
      async chat({ messages, context }) {
        prompts.push({ messages, context });
        return { reply: sdkReply, source: "pi-sdk-agent", toolsUsed: [] };
      }
    }
  });
}

test("飞书走 SDK 路径：注入已审核的记忆，回答后做错误写法检查并学习候选", async () => {
  await db.initDb();
  const active = await db.saveLearnedMemory({ domain: "command", entityKey: "zte-c600", topic: "端口视图命令语法",
    factContent: "C600 使用 interface gpon_olt-1/<槽位>/<PON口>", antiPattern: "gpon-olt_1/", status: "active", source: "manual" });
  assert.equal(active.status, "active");
  const prompts = [];
  const engine = engineWith({ sdkReply: "请执行 interface gpon-olt_1/2/5", prompts });
  const result = await engine.chat({
    messages: [{ role: "user", content: "C600 怎么进端口视图？记住：华为 MA5800 查看光功率用 display ont optical-info" }],
    context: { piSdk: true, channel: "feishu", readonlyScope: { oltIds: ["olt-1"] } }
  });
  assert.equal(result.source, "pi-sdk-agent");
  assert.match(prompts[0].context.memoryPrompt, /interface gpon_olt-1/);
  assert.match(result.reply, /记忆守护系统提示/);
  const candidates = await db.getLearnedMemories({ status: "candidate" });
  const learned = candidates.find((row) => row.topic === "工程师指定规约");
  assert.ok(learned);
  assert.equal(learned.source, "feishu");
  assert.match(learned.source_context, /上一轮回答|用户：/);
});

test("用户资料纠正生成按 LOID 的修正建议：唯一匹配自动带出 LOID，重名需确认；通过后写入台账并在合并时套用", async () => {
  await db.initDb();
  await seedMergedUsers();
  const engine = engineWith();
  await engine.chat({ messages: [{ role: "user", content: "用户张三电话改成13900000009" }], context: { channel: "feishu" } });
  await engine.chat({ messages: [{ role: "user", content: "用户李四电话改成13900000008" }], context: { channel: "feishu" } });

  // 用户资料不再写成记忆
  assert.equal((await db.getLearnedMemories()).some((row) => row.domain === "user"), false);
  const corrections = await db.getUserCorrections({ status: "candidate" });
  const zhang = corrections.find((item) => item.username === "张三");
  const li = corrections.find((item) => item.username === "李四");
  assert.equal(zhang.loid, "LOID-A");
  assert.equal(zhang.previousValue, "13800000001");
  assert.equal(zhang.value, "13900000009");
  assert.equal(li.loid, "");
  assert.equal(li.matchCount, 2);

  await assert.rejects(() => db.reviewUserCorrection(li.id, { status: "active" }), /LOID/);
  await db.reviewUserCorrection(zhang.id, { status: "active" });
  await db.reviewUserCorrection(li.id, { status: "active", loid: "loid-c" });
  const merged = await db.getMergedOnuSnapshots();
  assert.equal(merged.find((row) => row.loid === "LOID-A").userPhone, "13900000009");
  assert.equal(merged.find((row) => row.loid === "LOID-B").userPhone, "13800000002");
  assert.equal(merged.find((row) => row.loid === "LOID-C").userPhone, "13900000008");

  // 下次同步合并时重新套用
  const applied = applyUserCorrections([{ loid: "loid-a", userPhone: "13800000001" }, { loid: "LOID-X", userPhone: "1" }], await db.getActiveUserCorrections());
  assert.equal(applied.applied, 1);
  assert.equal(applied.rows[0].userPhone, "13900000009");
  assert.equal(applied.rows[1].userPhone, "1");
});

test("审核接口：记忆按状态列出与审核，修正建议可查同名候选", async () => {
  await db.initDb();
  await seedMergedUsers();
  const engine = engineWith();
  const memory = await db.saveLearnedMemory({ domain: "site", entityKey: "双岗机房", topic: "外层SVLAN规划", factContent: "外层 SVLAN 为 3000" });
  const correction = await db.saveUserCorrection({ username: "李四", field: "installationAddress", value: "示例村9号", matchCount: 2, source: "feishu" });
  const call = async (method, path, body) => {
    const res = {};
    const responses = [];
    const fakeRes = { writeHead() {}, end() {}, setHeader() {} };
    await handlePiAgentRoutes({ method, body, headers: {}, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } },
      { ...fakeRes, writeHead(status) { res.status = status; }, end(text) { responses.push(text); } },
      new URL(`http://local${path}`),
      {
        piAgentEngine: engine,
        getUserCorrections: db.getUserCorrections,
        getUserCorrection: db.getUserCorrection,
        reviewUserCorrection: db.reviewUserCorrection,
        deleteUserCorrection: db.deleteUserCorrection,
        getMergedOnuSnapshots: db.getMergedOnuSnapshots
      });
    return { status: res.status, body: JSON.parse(responses.at(-1) || "{}") };
  };
  const listed = await call("GET", "/api/pi-agent/memories?status=candidate");
  assert.ok(listed.body.rows.some((row) => row.id === memory.id));
  const reviewed = await call("PUT", `/api/pi-agent/memories/${memory.id}`, { status: "active" });
  assert.equal(reviewed.body.row.status, "active");
  const manual = await call("POST", "/api/pi-agent/memories", { domain: "site", entityKey: "桥头机房", topic: "外层SVLAN规划", factContent: "外层 SVLAN 为 3100" });
  assert.equal(manual.body.row.status, "active");
  assert.equal(manual.body.row.source, "manual");
  const matches = await call("GET", `/api/pi-agent/corrections/${correction.id}/matches`);
  assert.deepEqual(matches.body.matches.map((item) => item.loid).sort(), ["LOID-B", "LOID-C"]);
  const approved = await call("PUT", `/api/pi-agent/corrections/${correction.id}`, { status: "active", loid: "LOID-B" });
  assert.equal(approved.body.row.status, "active");
  assert.equal((await db.getMergedOnuSnapshots()).find((row) => row.loid === "LOID-B").installationAddress, "示例村9号");
});

test("飞书为 Pi Agent 保留同一人 30 分钟内最近 3 轮问答", async () => {
  const calls = [];
  let current = "2026-10-10T08:00:00.000Z";
  const app = createFeishuQueryApplication({
    stateStore: { value: { ...emptyFeishuState(), enabled: true }, async read() { return structuredClone(this.value); }, async write(next) { this.value = structuredClone(next); } },
    gateway: {
      async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
      async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "不存在的人" }),
    piAgentEngine: { async chat(input) { calls.push(input); return { reply: `回答${calls.length}` }; } },
    now: () => current,
    send: async () => {}
  });
  // 每条消息间隔 1 分钟（避开每人每分钟的限流），仍在 30 分钟上下文窗口内。
  let minute = 0;
  const ask = (eventId, text, openId = "ou-1") => {
    current = new Date(Date.parse("2026-10-10T08:00:00.000Z") + (minute++) * 60_000).toISOString();
    return app.handleMessage({ eventId, openId, chatId: "oc-1", text });
  };
  await ask("a1", "第一问");
  await ask("a2", "不对，应该是另一个");
  assert.equal(calls[1].context.channel, "feishu");
  assert.deepEqual(calls[1].messages.map((message) => message.content), ["第一问", "回答1", "不对，应该是另一个"]);
  await ask("a3", "别人的问题", "ou-2");
  assert.deepEqual(calls[2].messages.map((message) => message.content), ["别人的问题"]);
  for (let index = 4; index <= 6; index += 1) await ask(`a${index}`, `追问${index}`);
  assert.equal(calls.at(-1).messages.length, 7);
  minute += 31;
  await ask("a7", "过了半小时");
  assert.deepEqual(calls.at(-1).messages.map((message) => message.content), ["过了半小时"]);
});
