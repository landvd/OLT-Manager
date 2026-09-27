import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-twin-"));

const {
  createPiAgentToolExecutor,
  PI_AGENT_TOOL_DEFINITIONS
} = await import("../src/pi-agent/agent-tools.mjs");
const {
  createPiAgentEngine,
  formatDigitalTwinMarkdown,
  formatPortExperienceMarkdown
} = await import("../src/pi-agent/pi-agent-engine.mjs");
const { initDb, rawQuery: query, getOnuDigitalTwin, getPortExperience } = await import("../src/db.mjs");

test("formatDigitalTwinMarkdown renders rich 5-dimension digital twin markdown correctly", () => {
  const sampleTwin = {
    coordinate: {
      chassis: "1",
      board: "2",
      pon: "5",
      onuId: "3",
      indexDisplay: "1/2/5:3"
    },
    bossBusiness: {
      customerName: "张三",
      phone: "13800138000",
      installationAddress: "光明区光明街道光明路 88 号 2 单元 301",
      usernameSource: "boss",
      gridRank: "VIP",
      nmseOltIp: "10.10.10.1",
      nmseOnuIndex: "1/2/5:3"
    },
    ossDevice: {
      deviceNumber: "DEV-2026-999",
      deviceName: "ZXHN F660",
      deviceType: "GPON",
      ponType: "gpon",
      serial: "ZTEG030C0914",
      loid: "user_sz_001",
      mac: "00:1E:E3:44:55:66"
    },
    networkTopology: {
      oltId: "zte-c300-104-98",
      oltName: "光明机房 C300",
      oltIp: "10.10.10.2",
      vendor: "zte",
      model: "ZXA10 C300",
      deviceProfile: "zte-c300",
      outerVlan: "1063",
      primaryAddress: "光明片区 1 号光交箱"
    },
    healthAndTelemetry: {
      phase: "working",
      currentRxPower: "-19.8",
      distance: "1250",
      syncedAt: "2026-09-27 10:00:00",
      recentSamples: [
        { sampledAt: "2026-09-27 09:00:00", phase: "working", rxPower: "-19.8", distance: "1250" },
        { sampledAt: "2026-09-26 15:00:00", phase: "offline", lastOfflineCause: "DyingGasp", rxPower: "" }
      ]
    }
  };

  const md = formatDigitalTwinMarkdown(sampleTwin);
  assert.match(md, /张三/);
  assert.match(md, /13800138000/);
  assert.match(md, /DEV-2026-999/);
  assert.match(md, /ZTEG030C0914/);
  assert.match(md, /1\/2\/5:3/);
  assert.match(md, /1063/);
  assert.match(md, /-19.8 dBm/);
  assert.match(md, /DyingGasp/);
});

test("formatPortExperienceMarkdown renders quota, learned VLANs, and optical distribution baseline", () => {
  const sampleExp = {
    olt: {
      id: "zte-c300-1",
      name: "中心机房 C300",
      host: "10.10.10.1",
      vendor: "zte",
      deviceProfile: "zte-c300"
    },
    portCoordinate: {
      chassis: "1",
      board: "1",
      pon: "2",
      display: "1/1/2",
      primaryAddress: "科技园 3 号光交"
    },
    quotaStats: {
      maxQuota: 128,
      registeredCount: 45,
      onlineCount: 42,
      offlineCount: 3,
      remainingQuota: 83,
      nextAvailableOnuId: "12"
    },
    learnedConfigPattern: {
      recommendedTemplateId: "zte-c300-self-operated-internet",
      recommendedParameters: {
        outerVlan: "1065",
        innerVlan: "3301",
        recommendedOnuId: "12",
        portMode: "hybrid / tag"
      },
      summary: "基于同口历史开通规律自学习：外层 SVLAN 为 1065，主流自营上网内层为 3301，推荐配置 ID 为 12。"
    },
    opticalBaseline: {
      sampleCount: 42,
      averageRx: -19.5,
      medianRx: -19.2,
      strongestRx: -16.5,
      weakestRx: -23.1,
      standardDeviation: 1.15,
      healthyRange: {
        lowerBound: -22.5,
        upperBound: -16.5
      }
    },
    targetAssessment: {
      evaluatedRx: -23.5,
      offsetFromAverage: -4.0,
      isOutlier: true,
      verdict: "⚠️ 显著离群劣变：该终端光衰比同口邻居均值低 4.0 dB，疑似二级箱跳纤虚接或皮线急折，建议优先检修该户！"
    }
  };

  const md = formatPortExperienceMarkdown(sampleExp);
  assert.match(md, /1\/1\/2/);
  assert.match(md, /45/);
  assert.match(md, /12/);
  assert.match(md, /1065/);
  assert.match(md, /3301/);
  assert.match(md, /-19.5 dBm/);
  assert.match(md, /1.15 dB/);
  assert.match(md, /离群劣变/);
});

test("Pi Agent tool executor executes get_onu_digital_twin and inspect_port_experience", async () => {
  let twinQueryReceived = null;
  let expQueryReceived = null;

  const mockGetOnuDigitalTwin = async (params) => {
    twinQueryReceived = params;
    return {
      coordinate: { chassis: "1", board: params.board, pon: params.pon, onuId: params.onuId, indexDisplay: `${params.board}/${params.pon}:${params.onuId}` },
      bossBusiness: { customerName: "李四", phone: "13911112222" },
      ossDevice: { serial: "ZTEG99887766" },
      networkTopology: { oltName: "OLT-Test", outerVlan: "1080" },
      healthAndTelemetry: { phase: "working", currentRxPower: "-20.1" }
    };
  };

  const mockGetPortExperience = async (params) => {
    expQueryReceived = params;
    return {
      olt: { id: params.oltId, vendor: "zte" },
      portCoordinate: { chassis: params.chassis, board: params.board, pon: params.pon, display: `${params.board}/${params.pon}` },
      quotaStats: { registeredCount: 30, nextAvailableOnuId: "31" },
      learnedConfigPattern: {
        recommendedTemplateId: "zte-c300-self-operated-internet",
        recommendedParameters: { outerVlan: "1080", innerVlan: "3301", recommendedOnuId: "31" }
      }
    };
  };

  const executor = createPiAgentToolExecutor({
    getOlts: async () => [{ id: "olt-test-1", name: "测试OLT", vendor: "zte" }],
    getOnuDigitalTwin: mockGetOnuDigitalTwin,
    getPortExperience: mockGetPortExperience
  });

  // 测试 get_onu_digital_twin
  const twinResult = await executor("get_onu_digital_twin", { board: "1", pon: "3", onuId: "5" }, { oltId: "olt-test-1" });
  assert.equal(twinResult.bossBusiness.customerName, "李四");
  assert.equal(twinQueryReceived.board, "1");
  assert.equal(twinQueryReceived.pon, "3");
  assert.equal(twinQueryReceived.onuId, "5");

  // 测试 inspect_port_experience
  const expResult = await executor("inspect_port_experience", { board: "1", pon: "3" }, { oltId: "olt-test-1" });
  assert.equal(expResult.quotaStats.nextAvailableOnuId, "31");
  assert.equal(expQueryReceived.board, "1");
  assert.equal(expQueryReceived.pon, "3");
});

test("Pi Agent Engine falls back to local digital twin and port experience gracefully", async () => {
  const sampleTwin = {
    coordinate: { chassis: "1", board: "2", pon: "5", onuId: "3", indexDisplay: "1/2/5:3" },
    bossBusiness: { customerName: "王五", phone: "13700001111", installationAddress: "某小区 1 栋 101" },
    ossDevice: { deviceNumber: "DEV-101", serial: "ZTEG11223344" },
    networkTopology: { oltName: "测试C300", outerVlan: "1090" },
    healthAndTelemetry: { phase: "working", currentRxPower: "-18.5" }
  };

  const sampleExp = {
    olt: { id: "olt-1", name: "机房OLT", vendor: "zte" },
    portCoordinate: { chassis: "1", board: "2", pon: "5", display: "1/2/5" },
    quotaStats: { registeredCount: 50, onlineCount: 48, offlineCount: 2, remainingQuota: 78, nextAvailableOnuId: "51" },
    learnedConfigPattern: {
      recommendedTemplateId: "zte-c300-self-operated-internet",
      recommendedParameters: { outerVlan: "1090", innerVlan: "3301", recommendedOnuId: "51", portMode: "hybrid" },
      summary: "外层 1090 内层 3301"
    },
    opticalBaseline: {
      sampleCount: 48,
      averageRx: -19.2,
      medianRx: -19.0,
      strongestRx: -16.0,
      weakestRx: -22.5,
      standardDeviation: 1.1,
      healthyRange: { lowerBound: -22.0, upperBound: -16.5 }
    }
  };

  const engine = createPiAgentEngine({
    getLanguageConfig: async () => null, // 无 LLM
    getOnuDigitalTwin: async () => sampleTwin,
    getPortExperience: async () => sampleExp
  });

  // 1. 询问数字孪生
  const resTwin = await engine.chat({
    messages: [{ role: "user", content: "请调取 1/2/5:3 的数字孪生画像" }]
  });
  assert.equal(resTwin.source, "local-knowledge-base");
  assert.match(resTwin.reply, /王五/);
  assert.match(resTwin.reply, /13700001111/);
  assert.match(resTwin.reply, /DEV-101/);
  assert.match(resTwin.reply, /1090/);
  assert.match(resTwin.reply, /-18.5 dBm/);

  // 2. 询问端口自学习规律
  const resExp = await engine.chat({
    messages: [{ role: "user", content: "分析 1/2/5 端口的经验与自学习规律" }]
  });
  assert.equal(resExp.source, "local-knowledge-base");
  assert.match(resExp.reply, /51/);
  assert.match(resExp.reply, /1090/);
  assert.match(resExp.reply, /3301/);
  assert.match(resExp.reply, /-19.2 dBm/);
});

test("Pi Agent Engine Function Calling executes digital twin and port experience tools via LLM loop", async () => {
  let callIndex = 0;
  const mockFetch = async () => {
    callIndex += 1;
    if (callIndex === 1) {
      // 模拟大模型发起 get_onu_digital_twin 工具调用
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_twin_1",
                    type: "function",
                    function: {
                      name: "get_onu_digital_twin",
                      arguments: JSON.stringify({ board: "3", pon: "8", onuId: "2" })
                    }
                  }
                ]
              }
            }
          ]
        })
      };
    }
    // 第二轮返回综合回答
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "该用户的全息数字孪生已调取成功，客户赵六，光衰 -19.0 dBm。"
            }
          }
        ]
      })
    };
  };

  const engine = createPiAgentEngine({
    getLanguageConfig: async () => ({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "sk-mock"
    }),
    fetchImpl: mockFetch,
    getOnuDigitalTwin: async () => ({
      coordinate: { chassis: "1", board: "3", pon: "8", onuId: "2", indexDisplay: "1/3/8:2" },
      bossBusiness: { customerName: "赵六" },
      ossDevice: { serial: "ZTEG55667788" },
      networkTopology: { oltName: "OLT-2" },
      healthAndTelemetry: { phase: "working", currentRxPower: "-19.0" }
    })
  });

  const res = await engine.chat({
    messages: [{ role: "user", content: "查下 3/8:2 的数字孪生" }]
  });

  assert.equal(res.source, "llm-agent");
  assert.match(res.reply, /全息数字孪生已调取成功/);
  assert.equal(res.toolsUsed[0].name, "get_onu_digital_twin");
});

test("SQLite db getOnuDigitalTwin and getPortExperience work directly against real sqlite tables", async () => {
  await initDb();

  const testHost = "192.168.99.100";
  // 插入测试 OLT 与 PON 台账
  await query(`INSERT OR REPLACE INTO olts (id, name, vendor, model, version, device_profile, host, read_community) VALUES ('olt-real-test', '测试OLT', 'zte', 'ZXA10 C300', 'V2.1', 'zte-c300', '${testHost}', 'public');`);
  await query(`INSERT OR REPLACE INTO pon_ports (olt_ip, pon_port, chassis, board, pon, outer_vlan, address) VALUES ('${testHost}', '1/7/9', '1', '7', '9', '1068', '科技二路一级光交');`);

  // 插入测试 merged_onu_snapshots（多台 ONU，建立光衰样本分布）
  await query(`INSERT OR REPLACE INTO merged_onu_snapshots (
    olt_ip, chassis, board, pon, onu_id, loid, serial, username, user_phone, installation_address,
    device_number, device_name, device_type, pon_type, mac, phase, rx_power, distance
  ) VALUES 
    ('${testHost}', '1', '7', '9', '1', 'loid_001', 'ZTEG00000001', '张三丰', '13812345678', '光明大厦 101', 'DEV-001', 'F660', 'GPON', 'gpon', '00:11:22:33:44:55', 'working', '-19.2', '1200'),
    ('${testHost}', '1', '7', '9', '2', 'loid_002', 'ZTEG00000002', '李寻欢', '13800000002', '光明大厦 102', 'DEV-002', 'F660', 'GPON', 'gpon', '00:11:22:33:44:56', 'working', '-19.5', '1210'),
    ('${testHost}', '1', '7', '9', '3', 'loid_003', 'ZTEG00000003', '楚留香', '13800000003', '光明大厦 103', 'DEV-003', 'F660', 'GPON', 'gpon', '00:11:22:33:44:57', 'working', '-19.8', '1205'),
    ('${testHost}', '1', '7', '9', '4', 'loid_004', 'ZTEG00000004', '陆小凤', '13800000004', '光明大厦 104', 'DEV-004', 'F660', 'GPON', 'gpon', '00:11:22:33:44:58', 'working', '-23.5', '1220');
  `);

  // 插入时序遥测记录
  await query(`INSERT INTO onu_status_history (olt_ip, olt_id, chassis, board, pon, onu_id, phase, rx_power, distance, last_offline_cause, sampled_at)
    VALUES ('${testHost}', 'olt-real-test', '1', '7', '9', '1', 'working', '-19.2', '1200', '', datetime('now'));`);

  // 1. 验证 getOnuDigitalTwin
  const twin = await getOnuDigitalTwin({ oltIp: testHost, board: "7", pon: "9", onuId: "1" });
  assert.ok(twin);
  assert.equal(twin.bossBusiness.customerName, "张三丰");
  assert.equal(twin.bossBusiness.phone, "13812345678");
  assert.equal(twin.ossDevice.serial, "ZTEG00000001");
  assert.equal(twin.networkTopology.outerVlan, "1068");
  assert.equal(twin.networkTopology.primaryAddress, "科技二路一级光交");
  assert.equal(twin.healthAndTelemetry.currentRxPower, "-19.2");
  assert.equal(twin.healthAndTelemetry.recentSamples.length, 1);

  // 2. 验证 getPortExperience
  const exp = await getPortExperience({ oltIp: testHost, chassis: "1", board: "7", pon: "9", targetOnuId: "4" });
  assert.ok(exp);
  assert.equal(exp.quotaStats.registeredCount, 4);
  assert.equal(exp.quotaStats.nextAvailableOnuId, "5");
  assert.equal(exp.learnedConfigPattern.recommendedParameters.outerVlan, "1068");
  assert.equal(exp.learnedConfigPattern.recommendedParameters.innerVlan, "3301");
  assert.equal(exp.learnedConfigPattern.recommendedParameters.recommendedOnuId, "5");
  assert.ok(exp.opticalBaseline);
  assert.equal(exp.opticalBaseline.sampleCount, 4);
  assert.ok(exp.targetAssessment);
  assert.equal(exp.targetAssessment.isOutlier, true); // 4号用户 -23.5 dBm 显著偏离均值 -20.5 dBm
  assert.match(exp.targetAssessment.verdict, /离群劣变/);

  // 3. 验证 Pi Agent Engine 针对真实 SQLite 的离线自学习问答
  const realEngine = createPiAgentEngine({
    getLanguageConfig: async () => null,
    getOlts: async () => [{ id: "olt-real-test", host: testHost, vendor: "zte" }],
    getOnuDigitalTwin,
    getPortExperience
  });

  const chatExp = await realEngine.chat({
    messages: [{ role: "user", content: "分析 1/7/9 端口的经验规律和光衰基线" }],
    context: { oltId: "olt-real-test" }
  });
  assert.match(chatExp.reply, /1\/7\/9/);
  assert.match(chatExp.reply, /1068/);
  assert.match(chatExp.reply, /3301/);
  assert.match(chatExp.reply, /5/); // 推荐下一个空闲 ONU ID
});

