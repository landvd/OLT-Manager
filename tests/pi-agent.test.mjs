import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { queryKnowledgeBase, getCommandDifferences, OLT_KNOWLEDGE_BASE } from "../src/pi-agent/knowledge-base.mjs";
import {
  PI_AGENT_TOOL_DEFINITIONS,
  createPiAgentToolExecutor,
  analyzePonWeakSignalsImpl,
  diagnoseOfflineCauseImpl
} from "../src/pi-agent/agent-tools.mjs";
import { createPiAgentEngine } from "../src/pi-agent/pi-agent-engine.mjs";
import { sanitizeSearchQuery, searchWeb } from "../src/pi-agent/web-search.mjs";
import {
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

  let capturedTools;
  let emit;
  const fakeSdk = {
    defineTool: (definition) => definition,
    createAgentSession: async () => ({})
  };
  const adapter = createPiSdkAdapter({
    enabled: true,
    sdkLoader: async () => fakeSdk,
    sessionFactory: async ({ customTools }) => {
      capturedTools = customTools;
      return {
        messages: [],
        subscribe(listener) {
          emit = listener;
          return () => {};
        },
        async prompt() {
          emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "只读回答" } });
        },
        dispose() {}
      };
    },
    executeTool: async () => ({ count: 0, rows: [] }),
    getOlts: async () => [{ id: "olt-a", vendor: "zte", model: "C600", version: "2.0.10", host: "192.168.1.1", telnetPassword: "secret" }],
    getLanguageConfig: async () => ({ endpoint: "https://example.invalid/v1", model: "test-model", apiKey: "sk-test" }),
    modelRuntimeFactory: async () => ({ model: { id: "test-model" }, modelRuntime: {}, cleanup: async () => {} })
  });
  const response = await adapter.chat({
    messages: [{ role: "user", content: "查询光功率" }],
    context: { piSdk: true, oltId: "olt-a", readonlyScope: { oltIds: ["olt-a"] } }
  });
  assert.equal(response.source, "pi-sdk-agent");
  assert.equal(response.reply, "只读回答");
  assert.deepEqual(capturedTools.map((tool) => tool.name), [
    "olt_read_snapshot",
    "olt_query_onus",
    "olt_search_records",
    "olt_read_resolved_onu",
    "olt_read_unregistered",
    "olt_search_commands",
    "olt_match_candidate"
  ]);

  const commandTool = capturedTools.find((tool) => tool.name === "olt_search_commands");
  const commandResult = await commandTool.execute("call-commands", {
    oltId: "olt-a",
    scope: { oltIds: ["olt-a"] },
    keyword: "光功率"
  });
  assert.match(commandResult.content[0].text, /entries/);
  const commandPayload = JSON.parse(commandResult.content[0].text);
  assert.ok(commandPayload.entries.length > 0);
  assert.ok(commandPayload.entries.every((entry) => entry.verified === true && entry.readOnly === true));

  const toolResults = await createPiReadonlyTools({
    sdk: fakeSdk,
    executeTool: async () => ({ host: "192.168.1.1", password: "secret", status: "online" }),
    getOltSnapshot: async () => ({ vendor: "zte", model: "C600", version: "2.0.10", capabilities: {} }),
    verifiedCommands: []
  }).find((tool) => tool.name === "olt_query_onus").execute("call-1", { oltId: "olt-a", scope: { oltIds: ["olt-a"] }});
  assert.doesNotMatch(toolResults.content[0].text, /192\.168\.1\.1|secret/);
  assert.match(toolResults.content[0].text, /online/);
});

test("Pi SDK adapter uses configured OpenAI-compatible model and sanitizes terminal context", async () => {
  let captured;
  let emit;
  const fakeRuntime = {
    async setRuntimeApiKey(provider, key) {
      assert.equal(provider, "olt-manager");
      assert.equal(key, "runtime-only-key");
    },
    getModel(provider, model) {
      assert.equal(provider, "olt-manager");
      assert.equal(model, "qwen-test");
      return { provider, id: model };
    }
  };
  const fakeSdk = {
    defineTool: (definition) => definition,
    ModelRuntime: {
      async create(options) {
        assert.equal(options.allowModelNetwork, false);
        assert.match(options.modelsPath, /models\.json$/);
        const models = JSON.parse(await fs.readFile(options.modelsPath, "utf8"));
        assert.equal(models.providers["olt-manager"].api, "openai-completions");
        assert.equal(models.providers["olt-manager"].baseUrl, "http://127.0.0.1:8080/v1");
        assert.doesNotMatch(JSON.stringify(models), /runtime-only-key/);
        return fakeRuntime;
      }
    }
  };
  const adapter = createPiSdkAdapter({
    enabled: true,
    sdkLoader: async () => ({ ...fakeSdk, createAgentSession: async () => ({}) }),
    getLanguageConfig: async () => ({
      endpoint: "http://127.0.0.1:8080/v1",
      model: "qwen-test",
      apiKey: "runtime-only-key"
    }),
    sessionFactory: async (options) => {
      captured = options;
      return {
        messages: [],
        subscribe(listener) { emit = listener; return () => {}; },
        async prompt() { emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "已使用配置模型" } }); },
        dispose() {}
      };
    },
    executeTool: async () => ({ rows: [] }),
    getOlts: async () => [{ id: "olt-a", vendor: "zte", model: "C600", version: "2.0.10" }]
  });
  const response = await adapter.chat({
    messages: [{ role: "user", content: "刚才为什么报错？" }],
    context: {
      piSdk: true,
      oltId: "olt-a",
      readonlyScope: { oltIds: ["olt-a"] },
      terminalContext: "password=secret 192.168.1.1\\r\\n%Error 20200: Invalid command"
    }
  });
  assert.equal(response.source, "pi-sdk-agent");
  assert.equal(captured.model.provider, "olt-manager");
  assert.equal(captured.model.id, "qwen-test");
  assert.ok(captured.modelRuntime);
  assert.match(captured.systemPrompt, /最近终端输出/);
  assert.doesNotMatch(captured.systemPrompt, /secret|192\.168\.1\.1/);
  const projected = projectPiContext({ terminalContext: "community=secret 192.168.1.1\\r\\nshow gpon onu state" });
  assert.doesNotMatch(projected.terminalContext, /secret|192\\.168\\.1\\.1/);
  assert.ok(projectPiContext({ terminalContext: { output: "x".repeat(5000) } }).terminalContext.length <= 3000);
  assert.match(sanitizeTerminalContext("%Error 20200: Invalid command"), /Invalid command/);
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

test("Pi Agent Web Search sanitizes sensitive IP and credentials before querying", () => {
  // 1. 过滤内网 IP
  const q1 = sanitizeSearchQuery("华为 172.19.10.51 0x2e11a002 告警原因 192.168.1.1");
  assert.doesNotMatch(q1, /172\.19\.10\.51/);
  assert.doesNotMatch(q1, /192\.168\.1\.1/);
  assert.match(q1, /0x2e11a002/);

  // 2. 过滤手机号和 community
  const q2 = sanitizeSearchQuery("用户 13800138000 密码 admin123 community bdw0256 光衰");
  assert.doesNotMatch(q2, /13800138000/);
  assert.doesNotMatch(q2, /bdw0256/);
  assert.match(q2, /光衰/);

  // 3. 全被过滤时返回空
  const emptyQ = sanitizeSearchQuery("10.0.0.1 13912345678");
  assert.equal(emptyQ, "");
});

test("Pi Agent Tool Executor can invoke search_web safely", async () => {
  const executor = createPiAgentToolExecutor({});

  // 空搜索词拦截
  const emptyResult = await executor("search_web", { query: "" });
  assert.equal(emptyResult.error, "搜索关键词不能为空");

  // 纯内网敏感词过滤拦截
  const filteredResult = await executor("search_web", { query: "172.19.106.51 13800138000" });
  assert.equal(filteredResult.ok, false);
  assert.match(filteredResult.error, /安全策略完全过滤/);
});

test("Pi Agent Config manages default and user AnySearch API keys with masking", async () => {
  const { getPiAgentConfig, updatePiAgentConfig, maskApiKey } = await import("../src/pi-agent/config.mjs");

  // 1. 默认包含用户配置的 AnySearch API Key
  const cfg = getPiAgentConfig();
  assert.ok(cfg.anysearchApiKey.startsWith("as_sk_"));
  assert.equal(cfg.anysearchApiKey, "as_sk_e073d907a118c3bbba1ce741a5aa3e75");

  // 2. 遮罩测试
  const masked = maskApiKey(cfg.anysearchApiKey);
  assert.equal(masked, "as_sk_e0...aa3e75");

  // 3. 动态更新
  const updated = updatePiAgentConfig({ anysearchApiKey: "as_sk_custom_test_key_123456" });
  assert.equal(updated.anysearchApiKey, "as_sk_custom_test_key_123456");
  assert.equal(getPiAgentConfig().anysearchApiKey, "as_sk_custom_test_key_123456");

  // 4. 恢复默认 key 以免影响后续测试
  updatePiAgentConfig({ anysearchApiKey: "as_sk_e073d907a118c3bbba1ce741a5aa3e75" });
});

test("Pi Agent Tool Executor supports extract_web_page and blocks private intranet URLs", async () => {
  const executor = createPiAgentToolExecutor({});

  // 1. 工具已注册在定义中
  const extractDef = PI_AGENT_TOOL_DEFINITIONS.find((t) => t.function.name === "extract_web_page");
  assert.ok(extractDef);
  assert.equal(extractDef.function.parameters.required[0], "url");

  // 2. 空 URL 校验
  const emptyRes = await executor("extract_web_page", { url: "" });
  assert.equal(emptyRes.error, "网页链接不能为空");

  // 3. 非法内网 URL 必须拦截
  const intranetRes = await executor("extract_web_page", { url: "http://192.168.1.1/admin.html" });
  assert.equal(intranetRes.ok, false);
  assert.match(intranetRes.error, /安全策略拦截/);
});

test("handlePiAgentRoutes handles config API GET and POST correctly", async () => {
  const { handlePiAgentRoutes } = await import("../src/pi-agent/routes.mjs");

  // 1. GET /api/pi-agent/config
  let getStatus = 0;
  let getBody = null;
  const mockGetRes = {
    writeHead: (s) => { getStatus = s; },
    setHeader: () => {},
    end: (str) => { getBody = JSON.parse(str); }
  };
  Object.defineProperty(mockGetRes, "statusCode", {
    set: (s) => { getStatus = s; },
    get: () => getStatus
  });

  const getHandled = await handlePiAgentRoutes(
    { method: "GET" },
    mockGetRes,
    new URL("http://localhost/api/pi-agent/config")
  );
  assert.equal(getHandled, true);
  assert.equal(getStatus, 200);
  assert.ok(getBody.anysearchApiKey);
  assert.ok(getBody.maskedKey);

  // 2. POST /api/pi-agent/config
  let postStatus = 0;
  let postBody = null;
  const mockPostRes = {
    writeHead: (s) => { postStatus = s; },
    setHeader: () => {},
    end: (str) => { postBody = JSON.parse(str); }
  };
  Object.defineProperty(mockPostRes, "statusCode", {
    set: (s) => { postStatus = s; },
    get: () => postStatus
  });

  const mockPostReq = {
    method: "POST",
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ anysearchApiKey: "as_sk_e073d907a118c3bbba1ce741a5aa3e75" }));
    }
  };

  const postHandled = await handlePiAgentRoutes(
    mockPostReq,
    mockPostRes,
    new URL("http://localhost/api/pi-agent/config")
  );
  assert.equal(postHandled, true);
  assert.equal(postStatus, 200);
  assert.equal(postBody.ok, true);
  assert.equal(postBody.anysearchApiKey, "as_sk_e073d907a118c3bbba1ce741a5aa3e75");
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
