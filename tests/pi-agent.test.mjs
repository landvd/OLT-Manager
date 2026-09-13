import test from "node:test";
import assert from "node:assert/strict";
import { queryKnowledgeBase, getCommandDifferences, OLT_KNOWLEDGE_BASE } from "../src/pi-agent/knowledge-base.mjs";
import { PI_AGENT_TOOL_DEFINITIONS, createPiAgentToolExecutor } from "../src/pi-agent/agent-tools.mjs";
import { createPiAgentEngine } from "../src/pi-agent/pi-agent-engine.mjs";
import { sanitizeSearchQuery, searchWeb } from "../src/pi-agent/web-search.mjs";

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

  // 2. 华为 MA5800 酒店复合方案
  const resHotelHw = await engine.chat({
    messages: [{ role: "user", content: "华为MA5800 酒店全光网配置方案，槽位 3/8" }],
    context: { vendor: "huawei", model: "huawei-ma5800" }
  });
  assert.equal(resHotelHw.source, "local-knowledge-base");
  assert.match(resHotelHw.reply, /华为 MA5800/);
  assert.match(resHotelHw.reply, /0\/3\/8/);
  assert.match(resHotelHw.reply, /translate-and-add/);

  // 3. MDU 跨 OLT 互联方案
  const resMdu = await engine.chat({
    messages: [{ role: "user", content: "不同OLT之间的MDU互联方案怎么做？" }],
    context: { vendor: "zte" }
  });
  assert.equal(resMdu.source, "local-knowledge-base");
  assert.match(resMdu.reply, /MDU 互联方案/);
  assert.match(resMdu.reply, /GPON-MDU/);
  assert.match(resMdu.reply, /switchport mode trunk/);
});



