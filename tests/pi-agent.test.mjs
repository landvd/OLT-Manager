import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { queryKnowledgeBase, getCommandDifferences, OLT_KNOWLEDGE_BASE } from "../src/pi-agent/knowledge-base.mjs";
import {
  PI_AGENT_TOOL_DEFINITIONS,
  createPiAgentToolExecutor,
  analyzePonWeakSignalsImpl,
  diagnoseOfflineCauseImpl
} from "../src/pi-agent/agent-tools.mjs";
import { createPiAgentEngine } from "../src/pi-agent/pi-agent-engine.mjs";
import {
  PI_PLACE_TOOL_NAMES,
  PI_SDK_READONLY_TOOL_NAMES,
  createPiReadonlyTools,
  createPiSdkAdapter,
  projectPiContext,
  requireExplicitOltScope,
  requirePiChatScope,
  sanitizeTerminalContext
} from "../src/pi-agent/pi-sdk-adapter.mjs";
import { matchOltCandidate, normalizeOltIdentity } from "../src/pi-agent/olt-command-matcher.mjs";

test("Pi OLT candidate matcher requires complete identity, coordinate, and verified command evidence", () => {
  assert.deepEqual(normalizeOltIdentity({ vendor: "中兴", model: "ZXA10 C600", version: "v2.0.10" }), {
    vendor: "zte",
    model: "zxa10c600",
    deviceProfile: "",
    version: "2.0.10"
  });

  const snapshot = {
    vendor: "zte",
    model: "ZXA10 C600",
    deviceProfile: "zte-c600",
    version: "2.0.10",
    capabilities: { coordinate: { chassis: "1", board: "2", pon: "5" } }
  };
  const verifiedCommands = [{ command: "show gpon onu state gpon_olt-1/2/5", verified: true }];
  const matched = matchOltCandidate({
    snapshot,
    verifiedCommands,
    candidate: {
      vendor: "中兴",
      model: "ZXA10 C600",
      deviceProfile: "zte-c600",
      version: "v2.0.10",
      coordinate: { chassis: "1", board: "2", pon: "5" },
      command: "show gpon onu state gpon_olt-1/2/5"
    }
  });
  assert.equal(matched.status, "matched");
  assert.equal(matched.matched, true);
  assert.equal(matched.command.verified, true);

  const incomplete = matchOltCandidate({
    snapshot,
    verifiedCommands,
    candidate: { vendor: "zte", model: "ZXA10 C600", command: verifiedCommands[0].command }
  });
  assert.notEqual(incomplete.status, "matched");
  assert.ok(incomplete.missing.includes("candidate.coordinate"));

  const incompatible = matchOltCandidate({
    snapshot,
    verifiedCommands,
    candidate: {
      vendor: "huawei",
      model: "MA5800",
      deviceProfile: "huawei-ma5800",
      version: "2.0.10",
      coordinate: { chassis: "0", board: "2", pon: "5" },
      command: verifiedCommands[0].command
    }
  });
  assert.equal(incompatible.status, "incompatible");
});

async function durableSdk() {
  const [durable, ai, chord] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/pi-ai"),
    import("@earendil-works/chord/context")
  ]);
  return { durable, ai, context: chord.BACKGROUND_CONTEXT, apis: {} };
}

function offeredTools(transcript) {
  return transcript.messages.filter((m) => m.role === "system").flatMap((m) => (m.toolsAdded || []).map((tool) => tool.name));
}

function systemText(transcript) {
  return JSON.stringify(transcript.systemPrompt ?? transcript.messages?.filter((m) => m.role === "system") ?? "");
}

function durableAdapter({ sdk, faux, storageFactory, ...options }) {
  return createPiSdkAdapter({
    enabled: true,
    sdkLoader: async () => sdk,
    storageFactory: storageFactory || (() => new sdk.durable.MemoryStorage()),
    providerFactory: () => faux.provider,
    getLanguageConfig: async () => ({ endpoint: "http://127.0.0.1:8080/v1/chat/completions", model: "qwen-test", apiKey: "sk-local" }),
    ...options
  });
}

test("Pi SDK adapter enforces explicit OLT scope and projects no credentials or host data", async () => {
  assert.throws(
    () => requireExplicitOltScope({ oltId: "olt-a" }, {}),
    /必须显式提供非空 readonlyScope/
  );
  assert.deepEqual(
    requirePiChatScope({ readonlyScope: { oltIds: ["olt-a", "olt-b"] } }),
    { oltId: "", scope: { oltIds: ["olt-a", "olt-b"] } }
  );
  assert.deepEqual(
    requirePiChatScope({}),
    { oltId: "", scope: { oltIds: [] } }
  );
  assert.throws(
    () => requirePiChatScope({ oltId: "olt-c", readonlyScope: { oltIds: ["olt-a"] } }),
    /不在显式 readonlyScope/
  );

  const projected = projectPiContext({
    oltId: "olt-a",
    vendor: "zte",
    host: "192.168.1.1",
    telnetPassword: "secret",
    coordinate: { chassis: "1", board: "2", pon: "5" },
    readonlyScope: { oltIds: ["olt-a"] }
  });
  assert.equal(projected.host, undefined);
  assert.equal(projected.telnetPassword, undefined);
  assert.deepEqual(projected.readonlyScope.oltIds, ["olt-a"]);

  const sdk = await durableSdk();
  const tools = createPiReadonlyTools({
    sdk,
    executeTool: async () => ({ host: "192.168.1.1", password: "secret", status: "online", username: "张三", userPhone: "13800000001" }),
    getOltSnapshot: async () => ({ vendor: "zte", model: "C600", version: "2.0.10", capabilities: {} }),
    verifiedCommands: []
  });
  assert.deepEqual(tools.map((tool) => tool.name), [...PI_SDK_READONLY_TOOL_NAMES]);
  assert.ok(tools.every((tool) => tool.replay === "safe"));
  const queried = await tools.find((tool) => tool.name === "olt_query_onus").execute({ oltId: "olt-a", scope: { oltIds: ["olt-a"] } });
  assert.doesNotMatch(queried.content[0].text, /192\.168\.1\.1|secret/);
  // 本地模型：用户资料不再脱敏。
  assert.match(queried.content[0].text, /online/);
  assert.match(queried.content[0].text, /张三/);
  assert.match(queried.content[0].text, /13800000001/);

  const rejected = await tools.find((tool) => tool.name === "olt_read_unregistered").execute({ oltId: "olt-x", scope: { oltIds: ["olt-a"] } });
  assert.match(rejected.content[0].text, /rejected/);

  const commands = await tools.find((tool) => tool.name === "olt_search_commands").execute({ oltId: "olt-a", scope: { oltIds: ["olt-a"] }, keyword: "光功率" });
  const commandPayload = JSON.parse(commands.content[0].text);
  assert.ok(commandPayload.entries.length > 0);
  assert.ok(commandPayload.entries.every((entry) => entry.verified === true && entry.readOnly === true));
});

test("Pi Durable adapter runs read-only tools, keeps one conversation per key and sanitizes terminal context", async () => {
  const sdk = await durableSdk();
  const faux = sdk.ai.fauxProvider({ provider: "olt-manager", models: [{ id: "qwen-test" }] });
  const seen = [];
  const toolCalls = [];
  faux.setResponses([
    (transcript) => {
      seen.push(transcript);
      return sdk.ai.fauxAssistantMessage([sdk.ai.fauxToolCall("olt_search_records", { query: "张三" })], { stopReason: "toolUse" });
    },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("张三在 1/2/5 口，状态在线"); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("刚才那位用户光功率 -21 dBm"); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("另一位用户的新对话"); }
  ]);
  const adapter = durableAdapter({
    sdk,
    faux,
    executeTool: async (name, params) => { toolCalls.push({ name, params }); return { count: 1, rows: [{ username: "张三" }] }; },
    getOlts: async () => [{ id: "olt-a", vendor: "zte", model: "C600", version: "2.0.10", host: "192.168.1.1" }]
  });
  const context = {
    piSdk: true,
    oltId: "olt-a",
    readonlyScope: { oltIds: ["olt-a"] },
    conversationKey: "feishu:chat-1|user-1",
    terminalContext: "password=secret 192.168.1.1\r\n%Error 20200: Invalid command",
    memoryPrompt: "C600 使用 gpon_olt-1/x/y"
  };
  const first = await adapter.chat({ messages: [{ role: "user", content: "张三在哪个口" }], context });
  assert.equal(first.source, "pi-sdk-agent");
  assert.equal(first.reply, "张三在 1/2/5 口，状态在线");
  assert.deepEqual(first.toolsUsed, [{ name: "olt_search_records" }]);
  assert.equal(toolCalls[0].name, "search_resource_users");
  assert.equal(toolCalls[0].params.query, "张三");
  const firstSystem = systemText(seen[0]);
  assert.match(firstSystem, /只读网络助手/);
  assert.match(firstSystem, /最近终端输出/);
  assert.match(firstSystem, /gpon_olt-1\/x\/y/);
  assert.doesNotMatch(firstSystem, /secret|192\.168\.1\.1/);

  // 同一个 key：只提交最新一问，模型能看到上一轮问答。
  const second = await adapter.chat({
    messages: [{ role: "user", content: "张三在哪个口" }, { role: "assistant", content: "x" }, { role: "user", content: "他的光功率呢" }],
    context
  });
  assert.equal(second.reply, "刚才那位用户光功率 -21 dBm");
  assert.equal(second.conversationId, first.conversationId);
  const secondUsers = seen[2].messages.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content));
  assert.equal(secondUsers.length, 2);
  assert.match(secondUsers[0], /张三在哪个口/);
  assert.match(secondUsers[1], /他的光功率呢/);

  const other = await adapter.chat({ messages: [{ role: "user", content: "你好" }], context: { ...context, conversationKey: "feishu:chat-2|user-2" } });
  assert.notEqual(other.conversationId, first.conversationId);
  assert.equal(seen[3].messages.filter((m) => m.role === "user").length, 1);

  const status = await adapter.getStatus();
  assert.equal(status.package, "@earendil-works/pi-durable");
  assert.equal(status.sessionPersistence, "durable-sqlite");
  await adapter.close();
});

test("Pi Durable adapter keeps conversations in SQLite across restarts", async () => {
  const sdk = await durableSdk();
  const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "olt-pi-durable-"));
  const file = path.join(dir, "pi-durable.sqlite");
  const context = { piSdk: true, readonlyScope: { oltIds: ["olt-a"] }, conversationKey: "feishu:chat-1|user-1" };
  const run = async (reply, question) => {
    const faux = sdk.ai.fauxProvider({ provider: "olt-manager", models: [{ id: "qwen-test" }] });
    let transcript;
    faux.setResponses([(seen) => { transcript = seen; return sdk.ai.fauxAssistantMessage(reply); }]);
    const adapter = durableAdapter({ sdk, faux, storageFactory: () => openNodeSqliteStorage(file), executeTool: async () => ({}) });
    const result = await adapter.chat({ messages: [{ role: "user", content: question }], context });
    await adapter.close();
    return { result, transcript };
  };
  try {
    const first = await run("第一轮回答", "第一问");
    const second = await run("第二轮回答", "第二问");
    assert.equal(second.result.reply, "第二轮回答");
    assert.equal(second.result.conversationId, first.result.conversationId);
    const history = second.transcript.messages.map((m) => `${m.role}:${JSON.stringify(m.content)}`).join("\n");
    assert.match(history, /第一问/);
    assert.match(history, /第一轮回答/);
    assert.match(history, /第二问/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Pi Durable adapter falls back when the SDK or model config is unavailable", async () => {
  const unavailable = createPiSdkAdapter({ enabled: true, sdkLoader: async () => ({ unavailable: true }), executeTool: async () => ({}) });
  assert.equal(await unavailable.chat({ messages: [{ role: "user", content: "hi" }], context: { piSdk: true } }), null);
  const sdk = await durableSdk();
  const noModel = createPiSdkAdapter({ enabled: true, sdkLoader: async () => sdk, executeTool: async () => ({}), getLanguageConfig: async () => null });
  assert.equal(await noModel.chat({ messages: [{ role: "user", content: "hi" }], context: { piSdk: true } }), null);
  const rejected = await noModel.chat({ messages: [{ role: "user", content: "hi" }], context: { piSdk: true, oltId: "olt-x", readonlyScope: { oltIds: ["olt-a"] } } });
  assert.equal(rejected.source, "pi-sdk-rejected");
});

test("Pi Agent Knowledge Base contains ZTE C300, C600, and Huawei MA5800 entries", () => {
  assert.ok(OLT_KNOWLEDGE_BASE.length >= 10);
  
  // C300
  const c300Entries = queryKnowledgeBase({ model: "zte-c300" });
  assert.ok(c300Entries.length >= 4);
  assert.ok(c300Entries.some((e) => e.command.includes("show gpon onu uncfg")));

  // C600 TITAN
  const c600Entries = queryKnowledgeBase({ model: "zte-c600" });
  assert.ok(c600Entries.length >= 4);
  assert.ok(c600Entries.some((e) => e.command.includes("show this")));
  assert.ok(c600Entries.some((e) => e.command.includes("gpon_olt-")));

  // Huawei
  const huaweiEntries = queryKnowledgeBase({ vendor: "huawei" });
  assert.ok(huaweiEntries.length >= 4);
  assert.ok(huaweiEntries.some((e) => e.command.includes("display ont autofind all")));
  assert.ok(huaweiEntries.some((e) => e.description.includes("原始十六进制 SN")));
});

test("Pi Agent Command Differences highlights C600 vs C300 distinctions", () => {
  const diffs = getCommandDifferences();
  assert.ok(diffs.length >= 4);
  
  const namingDiff = diffs.find((d) => d.feature === "interface_naming");
  assert.ok(namingDiff);
  assert.match(namingDiff.c300, /gpon-olt_/);
  assert.match(namingDiff.c600, /gpon_olt-/);

  const vlanDiff = diffs.find((d) => d.feature === "vlan_service");
  assert.ok(vlanDiff);
  assert.match(vlanDiff.c600, /vport-mode manual/);
});

test("Pi Agent Tools executor executes safe read-only queries with desensitized output", async () => {
  const fakeOlts = [
    {
      id: "zte-c600-106-50",
      name: "ZTE C600 172.19.106.50",
      vendor: "zte",
      model: "ZXA10 C600",
      deviceProfile: "zte-c600",
      host: "172.19.106.50",
      readCommunity: "SECRET_COMMUNITY",
      telnetUsername: "admin",
      telnetPassword: "SECRET_PASSWORD",
      enabled: 1
    }
  ];

  const executor = createPiAgentToolExecutor({
    getOlts: async () => fakeOlts,
    getOnuList: async () => ({ rows: [{ onuIndexDisplay: "1/1/1:1", rxPower: "-19.5 dBm", status: "online", sn: "ZTEG12345678" }] }),
    getUnregisteredOnus: async () => ({ rows: [{ oltId: "zte-c600-106-50", board: "1", pon: "1", sn: "5A544547..." }] }),
    getOnuDetail: async () => ({ rxPower: "-19.2 dBm", txPower: "2.1 dBm", distance: "450m", status: "working" })
  });

  // 1. get_olt_status 必须脱敏
  const statusResult = await executor("get_olt_status", { oltId: "zte-c600-106-50" });
  assert.equal(statusResult.id, "zte-c600-106-50");
  assert.equal(statusResult.readCommunity, undefined);
  assert.equal(statusResult.telnetPassword, undefined);
  assert.equal(statusResult.telnetUsername, undefined);
  assert.equal(statusResult.enabled, true);

  // 2. query_onus
  const onusResult = await executor("query_onus", { oltId: "zte-c600-106-50", board: "1", pon: "1" });
  assert.equal(onusResult.count, 1);
  assert.equal(onusResult.rows[0].rxPower, "-19.5 dBm");

  // 3. get_unregistered_onus
  const unregResult = await executor("get_unregistered_onus", { oltId: "zte-c600-106-50" });
  assert.equal(unregResult.count, 1);

  // 4. lookup_knowledge_base
  const kbResult = await executor("lookup_knowledge_base", { vendor: "zte", model: "zte-c600" });
  assert.ok(kbResult.count > 0);

  // 5. 非法工具必须拒绝
  const illegalResult = await executor("reboot_onu", {});
  assert.match(illegalResult.error, /未授权/);
});

test("Pi Agent resolves user and ONU records before asking for board/PON", async () => {
  const executor = createPiAgentToolExecutor({
    getOlts: async () => [{ id: "olt-a", host: "192.0.2.10", vendor: "zte", enabled: true }],
    getMergedOnuRecords: async () => [{
      oltIp: "192.0.2.10",
      chassis: "1",
      board: "7",
      pon: "8",
      onuId: "12",
      username: "张三",
      userPhone: "13800138000",
      installationAddress: "双岗村一号",
      loid: "LOID-12",
      serial: "ZTEG-12",
      deviceNumber: "DEV-12",
      rxPower: "-20 dBm",
      syncedAt: "2026-09-19T00:00:00Z"
    }],
    getResourceUserRecords: async () => [],
    getPonPorts: async () => [{ oltIp: "192.0.2.10", chassis: "1", board: "7", pon: "8", address: "双岗村光交箱" }],
    getOnuList: async () => ({ rows: [{
      chassis: "1", board: "7", pon: "8", onuId: "12", phase: "working", rxPower: "-19.5 dBm", distance: "420m", serial: "ZTEG-12"
    }] })
  });

  const searched = await executor("search_resource_users", { query: "查张三的光衰" });
  assert.equal(searched.total, 1);
  assert.equal(searched.candidates[0].coordinate.board, "7");
  assert.equal(searched.candidates[0].coordinate.pon, "8");
  assert.equal(searched.candidates[0].primaryAddress, "双岗村光交箱");
  assert.equal(searched.candidates[0].oltIp, undefined);

  const live = await executor("read_resolved_onu", { candidateId: searched.candidates[0].candidateId });
  assert.equal(live.status, "live-verified");
  assert.equal(live.live.rxPower, "-19.5 dBm");

  const routed = await executor("query_onus", { q: "张三" });
  assert.equal(routed.total, 1);
  assert.equal(routed.candidates[0].coordinate.onuId, "12");

  const byPrimaryAddress = await executor("search_resource_users", { query: "双岗村" });
  assert.equal(byPrimaryAddress.total, 1);
  assert.equal(byPrimaryAddress.candidates[0].primaryAddress, "双岗村光交箱");
});

test("Pi Agent Engine falls back gracefully to local deterministic answers when LLM unconfigured", async () => {
  const engine = createPiAgentEngine({
    getLanguageConfig: async () => null // 未配置 LLM
  });

  // 问 C600 区别
  const resDiff = await engine.chat({
    messages: [{ role: "user", content: "C600与C300的区别是什么？" }],
    context: { vendor: "zte", model: "zte-c600" }
  });
  assert.equal(resDiff.source, "local-knowledge-base");
  assert.match(resDiff.reply, /TITAN/);
  assert.match(resDiff.reply, /gpon_olt-/);

  // 问光功率
  const resPower = await engine.chat({
    messages: [{ role: "user", content: "怎么查看光功率？" }],
    context: { vendor: "zte", model: "zte-c300" }
  });
  assert.equal(resPower.source, "local-knowledge-base");
  assert.match(resPower.reply, /show pon power/);
});

test("Pi Agent Engine delegates explicitly scoped terminal requests to the official SDK adapter", async () => {
  const engine = createPiAgentEngine({
    getLanguageConfig: async () => null,
    piSdkAdapter: {
      chat: async ({ context }) => {
        assert.equal(context.piSdk, true);
        assert.deepEqual(context.readonlyScope.oltIds, ["olt-a"]);
        return { source: "pi-sdk-agent", reply: "官方 SDK 只读回答", toolsUsed: ["olt_read_snapshot"] };
      }
    }
  });
  const result = await engine.chat({
    messages: [{ role: "user", content: "忘记了当前型号的查光功率命令" }],
    context: { piSdk: true, oltId: "olt-a", readonlyScope: { oltIds: ["olt-a"] } }
  });
  assert.equal(result.source, "pi-sdk-agent");
  assert.equal(result.reply, "官方 SDK 只读回答");
});

test("Pi Agent Engine completes Function Calling loop when LLM requests tools", async () => {
  let callIndex = 0;
  const mockFetch = async (url, options) => {
    callIndex += 1;
    if (callIndex === 1) {
      // 第一轮：模型决定调用 get_olt_status
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "get_olt_status",
                      arguments: JSON.stringify({ oltId: "mock-olt" })
                    }
                  }
                ]
              }
            }
          ]
        })
      };
    }
    // 第二轮：模型根据工具结果给出回答
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "设备状态正常，型号为中兴 C600。"
            }
          }
        ]
      })
    };
  };

  const engine = createPiAgentEngine({
    getLanguageConfig: async () => ({
      endpoint: "https://api.mock.com/v1",
      model: "mock-model",
      apiKey: "sk-mock"
    }),
    getOlts: async () => [{ id: "mock-olt", name: "Mock OLT", vendor: "zte", model: "C600", host: "1.2.3.4", enabled: 1 }],
    fetchImpl: mockFetch
  });

  const res = await engine.chat({
    messages: [{ role: "user", content: "查看当前设备状态" }],
    context: { oltId: "mock-olt" }
  });

  assert.equal(res.source, "llm-agent");
  assert.equal(res.reply, "设备状态正常，型号为中兴 C600。");
  assert.equal(res.toolsUsed.length, 1);
  assert.equal(res.toolsUsed[0].name, "get_olt_status");
});

test("Pi Agent 不再注册联网搜索工具", async () => {
  const names = PI_AGENT_TOOL_DEFINITIONS.map((t) => t.function.name);
  assert.ok(!names.includes("search_web"));
  assert.ok(!names.includes("extract_web_page"));
});

test("Pi Agent Engine generates hotel quad-play plan and MDU inter-connection plan when requested", async () => {
  const engine = createPiAgentEngine({
    getLanguageConfig: async () => null // 本地回退确定性生成
  });

  // 1. 酒店全光网多业务复合方案（中兴 C300 2/5 槽位口）
  const resHotelZte = await engine.chat({
    messages: [{ role: "user", content: "请给一份酒店全光网方案，一口自营二口IPTV三口内网四口专线，端口是 2/5" }],
    context: { vendor: "zte", model: "zte-c300" }
  });
  assert.equal(resHotelZte.source, "local-knowledge-base");
  assert.match(resHotelZte.reply, /酒店全光网/);
  assert.match(resHotelZte.reply, /gpon-olt_1\/2\/5/);
  assert.match(resHotelZte.reply, /tcont 1 name INTERNET/);
  assert.match(resHotelZte.reply, /tcont 4 name DIA/);
  assert.match(resHotelZte.reply, /service-port 4 vport 4 user-vlan 10 svlan 3500/);
  assert.match(resHotelZte.reply, /show igmp user/);

  // 2. C600 酒店复合方案仅由 PI 助手按需生成，不作为安装查询内置模板
  const resHotelC600 = await engine.chat({
    messages: [{ role: "user", content: "请生成 C600 酒店全光网方案，端口是 2/5" }],
    context: { vendor: "zte", model: "zte-c600" }
  });
  assert.equal(resHotelC600.source, "local-knowledge-base");
  assert.match(resHotelC600.reply, /中兴 C600 TITAN/);
  assert.match(resHotelC600.reply, /interface gpon_olt-1\/2\/5/);
  assert.match(resHotelC600.reply, /interface vport-1\/2\/5\.1:1/);
  assert.match(resHotelC600.reply, /service-port 1 user-vlan 3301 vlan 3301/);
  assert.match(resHotelC600.reply, /service-port 4 user-vlan 10 vlan 10 svlan 3500/);
  assert.match(resHotelC600.reply, /C600\/TITAN 命令层级说明/);
  assert.match(resHotelC600.reply, /每个 `interface vport-\.\.\.` 子视图配置对应的 `service-port`/);
  assert.match(resHotelC600.reply, /分别进入 ONU、各 Vport 和 `pon-onu-mng` 视图执行 `show this`/);
  const c600CommandBlock = resHotelC600.reply.match(/```bash\n([\s\S]*?)\n```/)?.[1] || "";
  assert.notEqual(c600CommandBlock, "");
  assert.doesNotMatch(c600CommandBlock, /show running-config interface|show onu running config|gpon-onu_/);

  // 3. 华为 MA5800 酒店复合方案
  const resHotelHw = await engine.chat({
    messages: [{ role: "user", content: "华为MA5800 酒店全光网配置方案，槽位 3/8" }],
    context: { vendor: "huawei", model: "huawei-ma5800" }
  });
  assert.equal(resHotelHw.source, "local-knowledge-base");
  assert.match(resHotelHw.reply, /华为 MA5800/);
  assert.match(resHotelHw.reply, /0\/3\/8/);
  assert.match(resHotelHw.reply, /translate-and-add/);

  // 4. MDU 跨 OLT 互联方案
  const resMdu = await engine.chat({
    messages: [{ role: "user", content: "不同OLT之间的MDU互联方案怎么做？" }],
    context: { vendor: "zte" }
  });
  assert.equal(resMdu.source, "local-knowledge-base");
  assert.match(resMdu.reply, /MDU 互联方案/);
  assert.match(resMdu.reply, /GPON-MDU/);
  assert.match(resMdu.reply, /switchport mode trunk/);
});

test("analyzePonWeakSignalsImpl correctly clusters trunk, branch, drop, and healthy PONs", () => {
  // 1. 主干级/整口大衰耗（弱光比例 >= 50%）
  const trunkFaultRows = [
    { onuIndexDisplay: "1/1/1:1", rxPower: "-28.5", username: "用户A" },
    { onuIndexDisplay: "1/1/1:2", rxPower: "-29.1", username: "用户B" },
    { onuIndexDisplay: "1/1/1:3", rxPower: "-27.8", username: "用户C" },
    { onuIndexDisplay: "1/1/1:4", rxPower: "-23.5", username: "用户D" }
  ];
  const trunkRes = analyzePonWeakSignalsImpl(trunkFaultRows, { board: "1", pon: "1", chassis: "1" });
  assert.equal(trunkRes.diagnosis.level, "severe_trunk");
  assert.match(trunkRes.diagnosis.conclusion, /整口大面积弱光/);
  assert.match(trunkRes.diagnosis.actionAdvice[0], /切勿盲目入户/);
  assert.equal(trunkRes.stats.weakCount, 3);
  assert.equal(trunkRes.stats.totalOnline, 4);

  // 2. 局部二级分光器/分支级弱光（弱光比例 20%~50%）
  const branchFaultRows = [
    { onuIndexDisplay: "1/2/1:1", rxPower: "-28.2", username: "用户1" },
    { onuIndexDisplay: "1/2/1:2", rxPower: "-21.5", username: "用户2" },
    { onuIndexDisplay: "1/2/1:3", rxPower: "-20.8", username: "用户3" },
    { onuIndexDisplay: "1/2/1:4", rxPower: "-22.0", username: "用户4" }
  ];
  const branchRes = analyzePonWeakSignalsImpl(branchFaultRows, { board: "2", pon: "1", chassis: "1" });
  assert.equal(branchRes.diagnosis.level, "branch_splitter");
  assert.match(branchRes.diagnosis.conclusion, /二级分光器/);
  assert.equal(branchRes.stats.weakCount, 1);

  // 3. 散发性个别入户弱光（主干优良，弱光比例 < 20%）
  const dropFaultRows = [
    { onuIndexDisplay: "1/3/1:1", rxPower: "-28.2", username: "弱光户" },
    ...Array.from({ length: 9 }, (_, i) => ({
      onuIndexDisplay: `1/3/1:${i + 2}`,
      rxPower: "-19.5",
      username: `正常户${i + 1}`
    }))
  ];
  const dropRes = analyzePonWeakSignalsImpl(dropFaultRows, { board: "3", pon: "1", chassis: "1" });
  assert.equal(dropRes.diagnosis.level, "individual_drop");
  assert.match(dropRes.diagnosis.conclusion, /散发性个别入户弱光/);
  assert.match(dropRes.diagnosis.actionAdvice[0], /无需排查机房与主干/);

  // 4. 全口优良
  const healthyRows = [
    { onuIndexDisplay: "1/4/1:1", rxPower: "-21.0", username: "用户A" },
    { onuIndexDisplay: "1/4/1:2", rxPower: "-22.3", username: "用户B" }
  ];
  const healthyRes = analyzePonWeakSignalsImpl(healthyRows, { board: "4", pon: "1", chassis: "1" });
  assert.equal(healthyRes.diagnosis.level, "healthy");
  assert.match(healthyRes.diagnosis.conclusion, /整口光功率全部优良/);
  assert.equal(healthyRes.stats.weakCount, 0);

  // 5. 全口阻断（无在线终端）
  const blockedRows = [
    { onuIndexDisplay: "1/5/1:1", rxPower: "unknown", status: "offline", phase: "offline" },
    { onuIndexDisplay: "1/5/1:2", rxPower: "unknown", status: "offline", phase: "offline" }
  ];
  const blockedRes = analyzePonWeakSignalsImpl(blockedRows, { board: "5", pon: "1", chassis: "1" });
  assert.equal(blockedRes.diagnosis.level, "critical");
  assert.match(blockedRes.diagnosis.conclusion, /整口全阻断/);
});

test("diagnoseOfflineCauseImpl accurately distinguishes DyingGasp vs LOS vs LOF vs Flapping", () => {
  // 1. 用户侧断电关机（DyingGasp）
  const dyingGaspOnu = {
    username: "张三",
    installationAddress: "厚街村东路1号",
    status: "offline",
    phase: "offline",
    lastOfflineCause: "DyingGasp",
    lastOfflineCauseCode: 2
  };
  const dyingGaspRes = diagnoseOfflineCauseImpl({ onu: dyingGaspOnu });
  assert.equal(dyingGaspRes.offlineDiagnosis.category, "power_off");
  assert.match(dyingGaspRes.offlineDiagnosis.conclusion, /掉电关机 \(DyingGasp\)/);
  assert.match(dyingGaspRes.offlineDiagnosis.conclusion, /切勿盲目上门翻光纤/);
  assert.match(dyingGaspRes.offlineDiagnosis.actionAdvice[0], /严禁装维人员盲目翻动光缆/);

  // 2. 物理断纤（LOS）
  const losOnu = {
    username: "李四",
    installationAddress: "双岗村中路5号",
    status: "offline",
    phase: "los",
    lastOfflineCause: "LOS",
    lastOfflineCauseCode: 3
  };
  const losRes = diagnoseOfflineCauseImpl({ onu: losOnu });
  assert.equal(losRes.offlineDiagnosis.category, "los_broken_fiber");
  assert.match(losRes.offlineDiagnosis.conclusion, /光路物理中断 \(LOS 信号丢失\)/);
  assert.match(losRes.offlineDiagnosis.actionAdvice[0], /装维师傅携带红光笔/);

  // 3. 频繁闪断震荡（Flapping）
  const flappingOnu = {
    username: "王五",
    status: "offline",
    lastOfflineCause: "DyingGasp",
    lastOfflineCauseCode: 2
  };
  const flappingHistory = {
    offlineCount: 5,
    recentOfflineReasons: [
      { reason: "DyingGasp", code: 2, time: "2026-09-14 10:00:00" },
      { reason: "LOS", code: 3, time: "2026-09-14 09:30:00" },
      { reason: "DyingGasp", code: 2, time: "2026-09-14 08:00:00" }
    ]
  };
  const flappingRes = diagnoseOfflineCauseImpl({ onu: flappingOnu, history: flappingHistory });
  assert.ok(flappingRes.offlineDiagnosis.flappingAlert);
  assert.match(flappingRes.offlineDiagnosis.flappingAlert, /链路闪断（Flapping）/);
});

test("Pi Agent tool executor supports analyze_pon_weak_signals and diagnose_offline_cause calls", async () => {
  const fakeOlts = [{ id: "zte-test-olt", vendor: "zte", model: "ZXA10 C300", enabled: 1 }];
  const fakeOnus = [
    { onuIndexDisplay: "1/4/1:1", board: "4", pon: "1", onuId: "1", rxPower: "-28.9", username: "陈大爷", status: "online" },
    { onuIndexDisplay: "1/4/1:2", board: "4", pon: "1", onuId: "2", rxPower: "-29.5", username: "林阿姨", status: "online" },
    { onuIndexDisplay: "1/4/1:3", board: "4", pon: "1", onuId: "3", rxPower: "-28.0", username: "张师傅", status: "online" }
  ];

  const executor = createPiAgentToolExecutor({
    getOlts: async () => fakeOlts,
    getOnuList: async ({ board, pon, q }) => {
      if (q) {
        const matched = fakeOnus.filter((o) => o.username.includes(q));
        return { rows: matched };
      }
      return { rows: fakeOnus };
    },
    getOnuConfig: async (olt, { board, pon, onuId }) => ({
      username: "陈大爷",
      status: "offline",
      lastOfflineCause: "DyingGasp",
      lastOfflineCauseCode: 2
    })
  });

  // 测试弱光聚类工具调用
  const weakAnalysis = await executor("analyze_pon_weak_signals", { board: "4", pon: "1" });
  assert.equal(weakAnalysis.diagnosis.level, "severe_trunk");
  assert.equal(weakAnalysis.stats.weakCount, 3);

  // 测试离线研判工具调用（按用户名关键词查找）
  const offlineDiag = await executor("diagnose_offline_cause", { q: "陈大爷" });
  assert.equal(offlineDiag.offlineDiagnosis.category, "power_off");
  assert.match(offlineDiag.offlineDiagnosis.conclusion, /掉电关机 \(DyingGasp\)/);
});

test("Pi Durable adapter returns history since the last reset and keeps old entries after reset", async () => {
  const sdk = await durableSdk();
  const faux = sdk.ai.fauxProvider({ provider: "olt-manager", models: [{ id: "qwen-test" }] });
  faux.setResponses([
    sdk.ai.fauxAssistantMessage([sdk.ai.fauxToolCall("olt_read_unregistered", { oltId: "olt-a", scope: { oltIds: ["olt-a"] } })], { stopReason: "toolUse" }),
    sdk.ai.fauxAssistantMessage("当前没有未注册 ONU"),
    sdk.ai.fauxAssistantMessage("板卡全部正常"),
    (transcript) => sdk.ai.fauxAssistantMessage(`新对话里有 ${transcript.messages.filter((m) => m.role === "user").length} 个提问`)
  ]);
  const adapter = durableAdapter({ sdk, faux, executeTool: async () => ({ rows: [] }) });
  const context = { piSdk: true, channel: "desktop", oltId: "olt-a", readonlyScope: { oltIds: ["olt-a"] }, conversationKey: "desktop:olt-a" };
  assert.deepEqual((await adapter.history({ conversationKey: "desktop:olt-a" })).messages, []);
  await adapter.chat({ messages: [{ role: "user", content: "有未注册的吗" }], context });
  await adapter.chat({ messages: [{ role: "user", content: "板卡状态" }], context });
  const history = await adapter.history({ conversationKey: "desktop:olt-a" });
  assert.deepEqual(history.messages, [
    { role: "user", content: "有未注册的吗" },
    { role: "assistant", content: "当前没有未注册 ONU" },
    { role: "user", content: "板卡状态" },
    { role: "assistant", content: "板卡全部正常" }
  ]);
  assert.deepEqual((await adapter.history({ conversationKey: "desktop:olt-b" })).messages, []);

  assert.equal((await adapter.reset({ conversationKey: "desktop:olt-a" })).reset, true);
  assert.deepEqual((await adapter.history({ conversationKey: "desktop:olt-a" })).messages, []);
  const fresh = await adapter.chat({ messages: [{ role: "user", content: "重新开始" }], context });
  assert.equal(fresh.reply, "新对话里有 1 个提问");
  assert.equal(fresh.conversationId, history.conversationId);
  await assert.rejects(() => adapter.history({ conversationKey: "" }), /conversationKey/);
  await adapter.close();
});

test("Pi desktop assistant helpers build per-OLT keys and restore commands from history", async () => {
  const { piDesktopConversationKey, historyToAssistantMessages, extractPiCommands } = await import("../src/pi-assistant-messages.mjs");
  assert.equal(piDesktopConversationKey("olt-a"), "desktop:olt-a");
  assert.equal(piDesktopConversationKey(""), "");
  assert.deepEqual(extractPiCommands("先执行 `show gpon onu uncfg`，再看 `display board 0`，`rm -rf` 不算"), ["show gpon onu uncfg", "display board 0"]);
  assert.deepEqual(historyToAssistantMessages([
    { role: "user", content: "未注册" },
    { role: "assistant", content: "<think>x</think>用 `show gpon onu uncfg`" },
    { role: "system", content: "ignored" }
  ]), [
    { role: "user", content: "未注册" },
    { role: "assistant", content: "用 `show gpon onu uncfg`", commands: ["show gpon onu uncfg"] }
  ]);
});

test("handlePiAgentRoutes serves durable conversation history", async () => {
  const { handlePiAgentRoutes } = await import("../src/pi-agent/routes.mjs");
  let status = 0;
  let body = null;
  const res = { writeHead: (s) => { status = s; }, setHeader: () => {}, end: (str) => { body = JSON.parse(str); } };
  Object.defineProperty(res, "statusCode", { set: (s) => { status = s; }, get: () => status });
  const calls = [];
  const piAgentEngine = {
    conversationHistory: async (options) => { calls.push(options); return { conversationId: "7", messages: [{ role: "user", content: "hi" }] }; }
  };
  const handled = await handlePiAgentRoutes({ method: "GET" }, res, new URL("http://localhost/api/pi-agent/history?conversationKey=desktop%3Aolt-a"), { piAgentEngine });
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.deepEqual(calls, [{ conversationKey: "desktop:olt-a" }]);
  assert.equal(body.ok, true);
  assert.equal(body.messages[0].content, "hi");
});

test("Pi Durable desktop conversations get the 16 desktop tools while Feishu keeps the 7 scoped tools", async () => {
  const sdk = await durableSdk();
  const faux = sdk.ai.fauxProvider({ provider: "olt-manager", models: [{ id: "qwen-test" }] });
  const seen = [];
  const calls = [];
  faux.setResponses([
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage([sdk.ai.fauxToolCall("read_olt_cli", { command: "show card" })], { stopReason: "toolUse" }); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("板卡正常"); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("飞书回答"); }
  ]);
  const adapter = durableAdapter({
    sdk,
    faux,
    desktopToolDefinitions: PI_AGENT_TOOL_DEFINITIONS,
    desktopSystemPrompt: "桌面版专用提示词",
    executeTool: async (name, args, context) => {
      calls.push({ name, args, context });
      return { output: "1 GTGO INSERVICE", description: "保留普通字段", telnetPassword: "secret", readCommunity: "public" };
    }
  });
  const desktop = await adapter.chat({
    messages: [{ role: "user", content: "看下板卡" }],
    context: { piSdk: true, channel: "desktop", oltId: "olt-a", vendor: "zte", readonlyScope: { oltIds: ["olt-a"] }, conversationKey: "desktop:olt-a" }
  });
  assert.equal(desktop.reply, "板卡正常");
  assert.deepEqual(desktop.toolsUsed, [{ name: "read_olt_cli" }]);
  assert.equal(calls[0].name, "read_olt_cli");
  assert.equal(calls[0].context.oltId, "olt-a");
  assert.equal(calls[0].context.vendor, "zte");
  const desktopToolNames = offeredTools(seen[0]).sort();
  assert.deepEqual(desktopToolNames, PI_AGENT_TOOL_DEFINITIONS.map((tool) => tool.function.name).sort());
  assert.match(systemText(seen[0]), /桌面版专用提示词/);
  const toolResultText = JSON.stringify(seen[1].messages.find((m) => m.role === "toolResult").content);
  assert.match(toolResultText, /保留普通字段/);
  assert.doesNotMatch(toolResultText, /secret|public/);

  await adapter.chat({
    messages: [{ role: "user", content: "张三在哪" }],
    context: { piSdk: true, channel: "feishu", readonlyScope: { oltIds: ["olt-a"] }, conversationKey: "feishu:c|u" }
  });
  assert.deepEqual(offeredTools(seen[2]), [...PI_SDK_READONLY_TOOL_NAMES]);
  assert.doesNotMatch(systemText(seen[2]), /桌面版专用提示词/);
  await adapter.close();
});

test("Pi Durable place tools screen weak light by village from the nightly baseline within the authorized scope", async () => {
  const sdk = await durableSdk();
  const faux = sdk.ai.fauxProvider({ provider: "olt-manager", models: [{ id: "qwen-test" }] });
  const seen = [];
  const gatewayCalls = [];
  const user = (name, rxDbm, onuId) => ({ name, address: `双岗村${name}家`, phone: "138", oltId: "olt-a", oltName: "OLT A", pon: { chassis: "1", board: "2", pon: "1" }, onuId, rxDbm });
  const gateway = {
    async queryWeakLight(request) {
      gatewayCalls.push({ name: "queryWeakLight", ...request });
      const all = [user("甲", -28.4, "3"), user("乙", -22.7, "7"), user("丙", -18.1, "9")].filter((item) => item.rxDbm <= request.threshold);
      return { status: "ok", place: "双岗村", threshold: request.threshold, totalUsers: 605, sampled: 590, offline: 15, sampleDate: "2026-10-10", weakCount: all.length, users: all.slice(0, request.limit), pons: all.length ? [{ oltName: "OLT A", pon: { chassis: "1", board: "2", pon: "1" }, weakCount: all.length, worstRx: all[0].rxDbm }] : [] };
    },
    async queryVillagePons(request) {
      gatewayCalls.push({ name: "queryVillagePons", ...request });
      return { total: 1, mainCount: 1, sparseCount: 0, hasMore: false, region: null, candidates: [{ oltId: "olt-a", oltName: "OLT A", address: "下环东路南五巷7号", pon: { chassis: "1", board: "2", pon: "1" }, matchedUserCount: 12, ponUserCount: 12, sparse: false }] };
    }
  };
  faux.setResponses([
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage([sdk.ai.fauxToolCall("olt_find_weak_light", { place: "双岗村" })], { stopReason: "toolUse" }); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("双岗村 1 户弱光：甲 -28.4 dBm"); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage([sdk.ai.fauxToolCall("olt_find_place_pons", { place: "双岗村" })], { stopReason: "toolUse" }); },
    (transcript) => { seen.push(transcript); return sdk.ai.fauxAssistantMessage("双岗村主要 1 个口"); }
  ]);
  const adapter = durableAdapter({
    sdk,
    faux,
    getPlaceGateway: async () => gateway,
    desktopToolDefinitions: PI_AGENT_TOOL_DEFINITIONS,
    executeTool: async () => ({}),
    getOlts: async () => [{ id: "olt-a", enabled: true }, { id: "olt-b", enabled: true }, { id: "olt-off", enabled: false }]
  });
  const feishu = await adapter.chat({
    messages: [{ role: "user", content: "双岗村光衰大的都筛出来" }],
    context: { piSdk: true, channel: "feishu", readonlyScope: { oltIds: ["olt-a", "olt-off"] }, conversationKey: "feishu:c|u" }
  });
  assert.equal(feishu.reply, "双岗村 1 户弱光：甲 -28.4 dBm");
  assert.deepEqual(offeredTools(seen[0]), [...PI_SDK_READONLY_TOOL_NAMES, ...PI_PLACE_TOOL_NAMES]);
  const system = systemText(seen[0]);
  assert.match(system, /-27 dBm/);
  assert.match(system, /不要用 Markdown 表格/);
  assert.match(system, /olt_find_weak_light/);
  // 飞书：已启用 ∩ 授权范围；先按 -27 筛弱光，再取最差的 10 户。
  assert.deepEqual(gatewayCalls.map((call) => [call.name, call.oltIds, call.threshold, call.limit]), [
    ["queryWeakLight", ["olt-a"], -27, 50],
    ["queryWeakLight", ["olt-a"], 0, 10]
  ]);
  const result = JSON.parse(seen[1].messages.find((m) => m.role === "toolResult").content[0].text);
  assert.equal(result.sampleDate, "2026-10-10");
  assert.equal(result.weakCount, 1);
  assert.equal(result.weakUsers[0].name, "甲");
  assert.equal(result.weakUsers[0].pon, "1/2/1");
  assert.deepEqual(result.worstUsers.map((item) => item.name), ["甲", "乙", "丙"]);
  assert.match(result.dataSource, /夜间采集/);

  gatewayCalls.length = 0;
  await adapter.chat({
    messages: [{ role: "user", content: "双岗村有哪些口" }],
    context: { piSdk: true, channel: "desktop", oltId: "olt-b", readonlyScope: { oltIds: ["olt-b"] }, conversationKey: "desktop:olt-b" }
  });
  assert.ok(PI_PLACE_TOOL_NAMES.every((name) => offeredTools(seen[2]).includes(name)));
  // 桌面：全部已启用 OLT，不受当前终端 OLT 限制。
  assert.deepEqual(gatewayCalls.map((call) => [call.name, call.oltIds, call.ponScope]), [["queryVillagePons", ["olt-a", "olt-b"], "main"]]);
  const pons = JSON.parse(seen[3].messages.findLast((m) => m.role === "toolResult").content[0].text);
  assert.equal(pons.pons[0].address, "下环东路南五巷7号");
  assert.equal(pons.pons[0].ponUsers, 12);
  await adapter.close();
});

test("Pi place tools try village+group spellings and report other matches for the field worker to confirm", async () => {
  const { placeVariants, createPiPlaceTools } = await import("../src/pi-agent/pi-sdk-adapter.mjs");
  assert.deepEqual(placeVariants("厚街村向北小组"), ["厚街村向北小组", "厚街村向北", "向北"]);
  assert.deepEqual(placeVariants("双岗村"), ["双岗村"]);
  assert.deepEqual(placeVariants(" 万达 广场 "), ["万达广场"]);
  const counts = { "厚街村榄树厦小组": 0, "厚街村榄树厦": 2, "榄树厦": 27 };
  const gateway = {
    async queryWeakLight({ value, threshold }) {
      const total = counts[value] || 0;
      if (!total) return { status: "no-match", place: value, threshold, totalUsers: 0 };
      return { status: "ok", place: value, threshold, totalUsers: total, sampled: total, offline: 0, sampleDate: "2026-10-10", weakCount: 0, users: [], pons: [] };
    },
    async queryVillagePons({ value, ponScope }) {
      const regionHit = value === "向北" || value === "厚街村向北";
      return regionHit
        ? { total: 3, mainCount: 3, sparseCount: 0, region: { id: 20, village: "厚街村", name: "向北" }, candidates: [] }
        : { total: 0, mainCount: 0, sparseCount: 0, region: null, candidates: [], ponScope };
    }
  };
  const [weak, pons] = createPiPlaceTools({ getPlaceGateway: async () => gateway, resolveOltIds: async () => ["olt-a"] });
  const weakResult = JSON.parse((await weak.execute({ place: "厚街村榄树厦小组" })).content[0].text);
  assert.equal(weakResult.place, "厚街村榄树厦");
  assert.deepEqual(weakResult.otherMatches, [{ place: "榄树厦", totalUsers: 27, weakCount: 0 }]);
  const missing = JSON.parse((await weak.execute({ place: "不存在的村" })).content[0].text);
  assert.equal(missing.status, "no-match");
  assert.deepEqual(missing.tried, ["不存在的村"]);
  const ponResult = JSON.parse((await pons.execute({ place: "厚街村向北小组" })).content[0].text);
  assert.equal(ponResult.matchedAs, "厚街村向北");
  assert.equal(ponResult.region.name, "向北");
  assert.deepEqual(ponResult.otherMatches, []);
  const noGateway = createPiPlaceTools({});
  assert.deepEqual(noGateway, []);
});
