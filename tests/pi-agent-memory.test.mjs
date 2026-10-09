import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-agent-memory-"));

const db = await import("../src/db.mjs");
const {
  extractMemoriesHeuristics,
  recallMemoriesForPrompt,
  inspectWatchdogAntiPatterns,
  silentExtractAndSaveMemories
} = await import("../src/pi-agent/memory-engine.mjs");
const { createPiAgentEngine } = await import("../src/pi-agent/pi-agent-engine.mjs");

test("extractMemoriesHeuristics extracts multi-domain facts silently (site, command, user)", () => {
  // 1. 机房 VLAN 规约提取
  const siteMems = extractMemoriesHeuristics("厚街机房外层VLAN是2048，不要用1000");
  assert.equal(siteMems.length, 1);
  assert.equal(siteMems[0].domain, "site");
  assert.equal(siteMems[0].entityKey, "厚街机房");
  assert.match(siteMems[0].factContent, /2048/);

  // 2. 机房光衰门限提取
  const optMems = extractMemoriesHeuristics("双岗机房光衰在-28.5以内都正常");
  assert.equal(optMems.length, 1);
  assert.equal(optMems[0].domain, "site");
  assert.equal(optMems[0].entityKey, "双岗机房");
  assert.match(optMems[0].factContent, /-28\.5/);

  // 3. 中兴 C600 命令语法避坑规约
  const cmdMems = extractMemoriesHeuristics("不对，C600不能用 gpon-olt_1/2/5，必须用 interface gpon_olt-1/2/5");
  assert.ok(cmdMems.length >= 1);
  const c600 = cmdMems.find((m) => m.entityKey === "zte-c600");
  assert.ok(c600);
  assert.equal(c600.domain, "command");
  assert.match(c600.factContent, /interface gpon_olt/);
  assert.match(c600.antiPattern, /gpon-olt/);

  // 4. 用户资料手机号与地址修正
  const userMems = extractMemoriesHeuristics("用户张三电话改成13800138000，实际地址是厚街村东路88号");
  assert.equal(userMems.length, 2);
  const phoneMem = userMems.find((m) => m.topic.includes("电话"));
  const addrMem = userMems.find((m) => m.topic.includes("地址"));
  assert.ok(phoneMem);
  assert.match(phoneMem.factContent, /13800138000/);
  assert.ok(addrMem);
  assert.match(addrMem.factContent, /厚街村东路88号/);
});

test("SQLite agent_learned_memories supports upsert and query by entity/keywords", async () => {
  await db.initDb();

  // 1. 首次入库
  const saved1 = await db.saveLearnedMemory({
    domain: "site",
    entityKey: "厚街机房",
    topic: "外层SVLAN规划",
    factContent: "外层 SVLAN 为 2048",
    antiPattern: "1000",
    reason: "现场规划"
  });
  assert.ok(saved1.id);
  assert.equal(saved1.fact_content, "外层 SVLAN 为 2048");

  // 2. 演进更新（Upsert，覆盖旧认知）
  const saved2 = await db.saveLearnedMemory({
    domain: "site",
    entityKey: "厚街机房",
    topic: "外层SVLAN规划",
    factContent: "外层 SVLAN 统一变更为 2049",
    antiPattern: "2048",
    reason: "二次规约变更"
  });
  assert.equal(saved1.id, saved2.id); // 相同ID直接更新
  assert.equal(saved2.fact_content, "外层 SVLAN 统一变更为 2049");
  // 自动学到的内容是候选，审核通过前不会被召回。
  assert.equal(saved2.status, "candidate");
  assert.deepEqual(await db.queryLearnedMemories({ entityKeys: ["厚街机房"] }), []);
  const approved = await db.reviewLearnedMemory(saved2.id, { status: "active" });
  assert.equal(approved.status, "active");
  // 已生效的记忆被新对话改写内容后重新回到候选。
  const rewritten = await db.saveLearnedMemory({ domain: "site", entityKey: "厚街机房", topic: "外层SVLAN规划", factContent: "外层 SVLAN 为 2050" });
  assert.equal(rewritten.status, "candidate");
  await db.reviewLearnedMemory(saved2.id, { status: "active", factContent: "外层 SVLAN 统一变更为 2049" });

  // 3. 多维度检索
  const queried = await db.queryLearnedMemories({
    entityKeys: ["厚街机房"],
    keywords: ["vlan"]
  });
  assert.equal(queried.length, 1);
  assert.equal(queried[0].entity_key, "厚街机房");
  assert.equal(queried[0].fact_content, "外层 SVLAN 统一变更为 2049");

  // 4. 计数命中
  await db.incrementMemoryHitCount(saved2.id);
  const memoriesList = await db.getLearnedMemories({ domain: "site" });
  assert.equal(memoriesList[0].hit_count, 1);
});

test("recallMemoriesForPrompt formats high priority prompt section", async () => {
  const queryLearned = async () => [
    {
      id: 1,
      domain: "site",
      entity_key: "厚街机房",
      topic: "外层SVLAN规划",
      fact_content: "外层 SVLAN 为 2048",
      anti_pattern: "1000"
    },
    {
      id: 2,
      domain: "command",
      entity_key: "zte-c600",
      topic: "端口视图命令语法",
      fact_content: "必须使用 interface gpon_olt-1/x/x 格式",
      anti_pattern: "gpon-olt_1/"
    }
  ];

  const result = await recallMemoriesForPrompt({
    context: { oltId: "olt-1", vendor: "zte", model: "c600" },
    userQuery: "厚街机房的C600配置怎么写？",
    queryLearnedMemories: queryLearned
  });

  assert.equal(result.memories.length, 2);
  assert.match(result.promptSection, /工程师现场已沉淀专属资料与避坑铁律/);
  assert.match(result.promptSection, /厚街机房/);
  assert.match(result.promptSection, /2048/);
  assert.match(result.promptSection, /interface gpon_olt/);
  assert.match(result.promptSection, /严禁使用或套用旧模式：`1000`/);
});

test("inspectWatchdogAntiPatterns appends warning when antiPattern is present in output", () => {
  const memories = [
    {
      domain: "command",
      entity_key: "zte-c600",
      topic: "端口视图",
      fact_content: "使用 interface gpon_olt-1/2/5",
      anti_pattern: "gpon-olt_1/2/5"
    }
  ];

  const rawBadReply = "请在终端执行：gpon-olt_1/2/5 进行配置。";
  const guarded = inspectWatchdogAntiPatterns(rawBadReply, memories);
  assert.match(guarded, /记忆守护系统提示/);
  assert.match(guarded, /检测到回复中包含已知踩坑特征/);
});

test("Pi Agent Engine end-to-end: learns facts silently and prevents stepping on landmines next call", async () => {
  await db.initDb();

  const engine = createPiAgentEngine({
    saveLearnedMemory: db.saveLearnedMemory,
    queryLearnedMemories: db.queryLearnedMemories,
    incrementMemoryHitCount: db.incrementMemoryHitCount,
    getLearnedMemories: db.getLearnedMemories,
    deleteLearnedMemory: db.deleteLearnedMemory
  });

  // 第一轮：工程师对 Agent 说出事实 / 进行纠错
  const res1 = await engine.chat({
    messages: [
      { role: "user", content: "注意：厚街机房外层VLAN是2048，不要用1000" }
    ],
    context: {}
  });

  assert.ok(res1.reply);

  // 静默写入的是候选，审核前不会被召回。
  const candidates = await db.getLearnedMemories({ status: "candidate" });
  const learned = candidates.find((row) => row.entity_key === "厚街机房");
  assert.ok(learned);
  assert.match(learned.fact_content, /2048/);
  assert.deepEqual(await db.queryLearnedMemories({ entityKeys: ["厚街机房"] }), []);

  // 管理员在“Pi 知识审核”页通过后生效。
  await db.reviewLearnedMemory(learned.id, { status: "active" });

  // 第二轮（全新会话/下次调用）：询问厚街机房
  const res2 = await engine.chat({
    messages: [
      { role: "user", content: "查询厚街机房的外层SVLAN规划" }
    ],
    context: {}
  });

  // 成功唤醒历史沉淀规约，且不再踩坑！
  assert.match(res2.reply, /已唤醒历史沉淀现场规约/);
  assert.match(res2.reply, /2048/);
  assert.match(res2.reply, /1000/);
  assert.ok(res2.memoriesUsed.length >= 1);
  assert.equal(res2.memoriesUsed[0].entityKey, "厚街机房");
});
