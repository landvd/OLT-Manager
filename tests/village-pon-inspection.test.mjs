import assert from "node:assert/strict";
import test from "node:test";
import { createOltDataGateway } from "../src/olt-data-gateway.mjs";
import { createPiAgentEngine } from "../src/pi-agent/pi-agent-engine.mjs";
import { ORDERED_SEARCH_INTENTS } from "../src/feishu/application.mjs";

test("村级巡检测试：华为 MA5800 坐标自适应纠偏为 0/1/1 并消除未完成状态", async () => {
  // 模拟大迳村真实场景：
  // 172.19.104.100 为中兴 C300（框号 1）
  // 172.19.106.51 为华为 MA5800（框号必须是 0）
  const olts = [
    { id: "zte-c300-100", name: "ZTE 172.19.104.100", vendor: "zte", model: "C300", host: "172.19.104.100", enabled: true },
    { id: "huawei-ma5800-51", name: "Huawei MA5800 172.19.106.51", vendor: "huawei", model: "MA5800", host: "172.19.106.51", enabled: true }
  ];

  // 台账中：历史网管同步可能将华为误记为 1/1/1:3
  const users = {
    "172.19.104.100": [
      { onuIndex: "1/8/8:1", username: "黄添华", installationAddress: "广东省东莞市厚街镇大迳村黄谭114号" }
    ],
    "172.19.106.51": [
      { onuIndex: "1/1/1:3", username: "黄文有", installationAddress: "广东省东莞市厚街镇大迳村汪潭四巷18号" }
    ]
  };

  // PON 台账表：华为设备的真实端口登记为 0/1/1
  const ponPorts = [
    { oltIp: "172.19.104.100", chassis: "1", board: "8", pon: "8", address: "黄谭光交箱" },
    { oltIp: "172.19.106.51", chassis: "0", board: "1", pon: "1", address: "汪潭村17号2#" }
  ];

  const gateway = createOltDataGateway({
    getOlts: async () => olts,
    getUsers: async ({ oltIp }) => users[oltIp] || [],
    getPonPorts: async () => ponPorts,
    getDatasetRevision: async () => "rev-village-test",
    listOnus: async (olt, requested) => {
      // 模拟华为 MA5800 设备：设备只认 GPON 0/1/1
      if (olt.vendor === "huawei") {
        if (String(requested.chassis) === "0" && String(requested.board) === "1" && String(requested.pon) === "1") {
          return [{
            chassis: "0", board: "1", slot: "1", pon: "1", onuId: "3",
            name: "ONT-3", phase: "online", rxPower: "-19.50 dBm", serial: "HWTC12345678"
          }];
        }
        // 如果系统按 1/1/1 去查，华为设备返回空（查不到任何端口）
        return [];
      }
      return [{
        chassis: "1", board: "8", slot: "8", pon: "8", onuId: "1",
        name: "ZTE-1", phase: "online", rxPower: "-21.00 dBm", serial: "ZTEG12345678"
      }];
    },
    getOnuStatusHistory: async () => [
      { sampledAt: "2026-09-13T00:00:00.000Z", phase: "online", rxPower: "-19.60 dBm", distance: "200 m" }
    ],
    readHistoricalOptical: async () => ({
      source: "oss-ngb",
      rows: [{ reportTime: "2026-09-13T00:00:00.000Z", rxOptical: -19.6 }]
    }),
    now: () => new Date("2026-09-14T00:00:00.000Z")
  });

  // 1. 查询大迳村的全部 PON 口
  const queryResult = await gateway.queryVillagePons({ value: "大迳村", oltIds: ["zte-c300-100", "huawei-ma5800-51"] });
  assert.equal(queryResult.total, 2, "大迳村应查出 2 个 PON 口");

  const huaweiCandidate = queryResult.candidates.find((c) => c.oltId === "huawei-ma5800-51");
  assert.ok(huaweiCandidate, "应包含华为 OLT 的候选 PON 口");

  // 断言：华为 MA5800 的 PON 口机框必须自适应修正为 0，而非错误的 1
  assert.equal(huaweiCandidate.pon.chassis, "0", "华为 MA5800 机框编号必须自适应为 0");
  assert.equal(huaweiCandidate.pon.board, "1");
  assert.equal(huaweiCandidate.pon.pon, "1");
  assert.equal(huaweiCandidate.address, "汪潭村17号2#", "应成功命中台账中的一级地址");

  // 2. 抽样华为 PON 口在线用户
  const sample = await gateway.sampleVillagePonOnlineUser({
    value: "大迳村",
    oltIds: ["zte-c300-100", "huawei-ma5800-51"],
    oltId: "huawei-ma5800-51",
    pon: huaweiCandidate.pon
  });

  assert.ok(sample.candidate, "华为端口必须成功抽样到在线用户，不可为 null（杜绝未完成）");
  assert.equal(sample.candidate.name, "黄文有");
  assert.equal(sample.liveStatus.status.rxPower, "-19.50 dBm");
});

test("Pi Agent 智能助手：未查到用户时严禁向用户输出裸 JSON", async () => {
  // 模拟当用户输入“检查保和圩村中路北一巷5号，有几个弱光信号”时
  const engine = createPiAgentEngine({
    getLanguageConfig: async () => ({
      endpoint: "https://mock-llm.example.com",
      model: "mock-model",
      apiKey: "mock-key"
    }),
    getOnuList: async () => ({ rows: [] }), // 模拟台账无此门牌号，工具返回空
    fetchImpl: async () => {
      // 模拟第一轮：大模型发起 query_onus 工具调用
      // 模拟第二轮：大模型未生成文本或异常中断
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                id: "call-1",
                function: { name: "query_onus", arguments: JSON.stringify({ q: "保和圩村中路北一巷5号" }) }
              }]
            }
          }]
        })
      };
    }
  });

  const result = await engine.chat({
    messages: [{ role: "user", content: "检查保和圩村中路北一巷5号，有几个弱光信号" }]
  });

  // 断言：严禁向用户展示 {"count":0,"rows":...} 这种裸 JSON 错误信息！
  assert.doesNotMatch(result.reply, /\{"count":\s*0/i, "严禁将工具的裸机器 JSON 直接输出给用户");
  assert.ok(result.reply.length > 0, "必须生成友好、可读的中文答复或排障引导");
});

test("飞书搜索顺位顺序必须符合业务标准", () => {
  assert.deepEqual(
    ORDERED_SEARCH_INTENTS,
    [
      "find_by_name",
      "find_pon_by_address",
      "find_by_loid",
      "find_by_sn",
      "find_by_phone",
      "find_by_address"
    ],
    "搜索顺位必须是：姓名 -> 一级地址 -> LOID -> 设备SN -> 电话 -> 装机地址"
  );
});

test("飞书端到端村级巡检：输入检查大迳村所有PON口，最终卡片必须消除未完成并展示华为0/1/1", async () => {
  const { createFeishuQueryApplication } = await import("../src/feishu/application.mjs");
  const { emptyFeishuState } = await import("../src/feishu/state.mjs");

  const state = {
    ...emptyFeishuState(),
    enabled: true,
    operators: [{ openId: "ou-test", enabled: true, oltIds: ["zte-c300-100", "huawei-ma5800-51"] }],
    authorizedChats: [{ chatId: "oc-test", enabled: true, type: "direct" }]
  };
  const stateStore = {
    async read() { return structuredClone(state); },
    async write(next) { Object.assign(state, next); }
  };

  const olts = [
    { oltId: "zte-c300-100", name: "ZTE 172.19.104.100", vendor: "zte", model: "C300", host: "172.19.104.100", enabled: true },
    { oltId: "huawei-ma5800-51", name: "Huawei MA5800 172.19.106.51", vendor: "huawei", model: "MA5800", host: "172.19.106.51", enabled: true }
  ];

  const gateway = {
    async listOlts() { return olts; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async queryVillagePons({ value, offset = 0 }) {
      return {
        total: 2, authorizedCount: 2, offset, limit: 5, hasMore: false,
        candidates: [
          {
            candidateId: "zte-c300-100:1/8/8",
            oltId: "zte-c300-100",
            oltName: "ZTE 172.19.104.100",
            address: "黄谭光交箱",
            pon: { chassis: "1", board: "8", pon: "8" }
          },
          {
            candidateId: "huawei-ma5800-51:0/1/1",
            oltId: "huawei-ma5800-51",
            oltName: "Huawei MA5800 172.19.106.51",
            address: "汪潭村17号2#",
            // 自适应纠正后的正确坐标为 0/1/1
            pon: { chassis: "0", board: "1", pon: "1" }
          }
        ]
      };
    },
    async sampleVillagePonOnlineUser({ oltId, pon }) {
      const isHuawei = oltId === "huawei-ma5800-51";
      return {
        candidate: {
          candidateId: isHuawei ? "hw-user-1" : "zte-user-1",
          oltId,
          name: isHuawei ? "黄文有" : "黄添华",
          address: isHuawei ? "大迳村汪潭四巷18号" : "大迳村黄谭114号",
          onu: { chassis: pon.chassis, board: pon.board, pon: pon.pon, onuId: "1" }
        },
        liveStatus: {
          oltId,
          onu: { chassis: pon.chassis, board: pon.board, pon: pon.pon, onuId: "1" },
          status: { phase: "online", rxPower: isHuawei ? "-19.50 dBm" : "-20.10 dBm" },
          observedAt: "2026-09-14T00:00:00.000Z"
        }
      };
    },
    async readOnuHistoricalOptical({ oltId }) {
      return {
        source: "oss-ngb",
        rows: [{
          reportTime: "2026-09-13T00:00:00.000Z",
          rxOptical: oltId === "huawei-ma5800-51" ? -19.6 : -20.2
        }]
      };
    }
  };

  const sent = [];
  let resolveSummary;
  const summaryPromise = new Promise((resolve) => { resolveSummary = resolve; });

  const app = createFeishuQueryApplication({
    stateStore,
    gateway,
    interpret: async () => { throw new Error("应当命中本地村级正则"); },
    now: () => "2026-09-14T00:00:00.000Z",
    send: async (_chatId, reply) => {
      sent.push(reply);
      if (reply.kind === "village-pon-summary") resolveSummary(reply);
    }
  });

  const loading = await app.handleMessage({
    eventId: "msg-test-1",
    openId: "ou-test",
    chatId: "oc-test",
    text: "检查大迳村所有PON口"
  });

  assert.equal(loading.kind, "village-pon-summary-loading");

  const summary = await summaryPromise;
  assert.equal(summary.kind, "village-pon-summary");
  assert.equal(summary.total, 2, "大迳村共 2 个 PON 口");
  assert.equal(summary.incompleteCount, 0, "未完成数量必须为 0（彻底消除未完成）");
  assert.equal(summary.abnormalCount, 0, "异常数量为 0");
  assert.equal(summary.normal, true, "整体状态必须判定为全部正常");
  assert.ok(summary.repairVerdictText.includes("主干熔接质量优秀") || summary.normal, "验收结论合格");
});

test("资料库未对齐场景：目标村台账用户离线时，自动借用同口其他在线用户完成巡检验收", async () => {
  // 模拟双岗村 1/4/8 口：双岗村仅 1 户且关机离线，但同口有桥头村用户实际在线
  const gateway = createOltDataGateway({
    getOlts: async () => [
      { id: "olt-102", name: "OLT 102", vendor: "zte", host: "172.19.104.102", enabled: true }
    ],
    getUsers: async () => [
      // 目标村用户已关机离线（onuId 17 离线）
      { onuIndex: "1/4/8:17", username: "方茂生", installationAddress: "东莞市厚街镇双岗村中环南安坊六巷3号" },
      // 同口其他村用户在线（onuId 1 在线）
      { onuIndex: "1/4/8:1", username: "刘浩锋", installationAddress: "东莞市厚街镇桥头村祠边公寓1栋904" }
    ],
    getPonPorts: async () => [
      { oltIp: "172.19.104.102", chassis: "1", board: "4", pon: "8", address: "双岗村边缘交界箱" }
    ],
    getDatasetRevision: async () => "rev-test",
    listOnus: async (_olt, _pon) => [
      // 只有刘浩锋在线
      { chassis: "1", board: "4", slot: "4", pon: "8", onuId: "1", phase: "online", rxPower: "-21.5 dBm" },
      { chassis: "1", board: "4", slot: "4", pon: "8", onuId: "17", phase: "offline", rxPower: "unknown" }
    ],
    getOnuStatusHistory: async () => [],
    now: () => new Date("2026-09-14T00:00:00.000Z")
  });

  const sample = await gateway.sampleVillagePonOnlineUser({
    value: "双岗村",
    oltIds: ["olt-102"],
    oltId: "olt-102",
    pon: { chassis: "1", board: "4", pon: "8" }
  });

  assert.ok(sample.candidate, "即使双岗村用户离线，也必须成功借用同口在线用户，不得查空返回未完成");
  assert.equal(sample.candidate.name, "刘浩锋", "成功借用同口在线用户刘浩锋");
  assert.equal(sample.liveStatus.status.rxPower, "-21.5 dBm", "成功测得当前口实时收光");
});

test("资料库完全未对齐场景：台账0户但设备实际在线时，依然成功穿透借用设备完成验收", async () => {
  const gateway = createOltDataGateway({
    getOlts: async () => [
      { id: "olt-102", name: "OLT 102", vendor: "zte", host: "172.19.104.102", enabled: true }
    ],
    getUsers: async () => [], // 台账0户
    getPonPorts: async () => [
      { oltIp: "172.19.104.102", chassis: "1", board: "4", pon: "8", address: "双岗村交界" }
    ],
    getDatasetRevision: async () => "rev-test",
    listOnus: async () => [
      { chassis: "1", board: "4", slot: "4", pon: "8", onuId: "1", phase: "online", rxPower: "-21.5 dBm" }
    ],
    getOnuStatusHistory: async () => [],
    now: () => new Date("2026-09-14T00:00:00.000Z")
  });

  const sample = await gateway.sampleVillagePonOnlineUser({
    value: "双岗村",
    oltIds: ["olt-102"],
    oltId: "olt-102",
    pon: { chassis: "1", board: "4", pon: "8" }
  });

  assert.ok(sample.candidate, "台账虽未对齐，但设备在线时必须穿透完成抽样");
  assert.equal(sample.liveStatus.status.rxPower, "-21.5 dBm");
});

test("全镇多村综合巡检矩阵：覆盖双岗村、河田村、桥头村、涌口村、厚街村、新塘村，断言机框与通光判定全部正确", async () => {
  // 模拟全镇真实网络拓扑（含华为 MA5800、中兴 C600 TITAN、中兴 C300）
  const olts = [
    { id: "zte-100", name: "ZTE C300 104.100", vendor: "zte", model: "C300", host: "172.19.104.100", enabled: true },
    { id: "zte-102", name: "ZTE C300 104.102", vendor: "zte", model: "C300", host: "172.19.104.102", enabled: true },
    { id: "c600-50", name: "ZTE C600 106.50", vendor: "zte", model: "C600", host: "172.19.106.50", enabled: true },
    { id: "hw-51", name: "Huawei MA5800 106.51", vendor: "huawei", model: "MA5800", host: "172.19.106.51", enabled: true }
  ];

  // 跨村台账用户数据
  const users = {
    "172.19.104.100": [
      { onuIndex: "1/2/1:1", username: "双岗用户甲", installationAddress: "厚街镇双岗村下环东路南五巷7号" },
      { onuIndex: "1/2/2:1", username: "双岗用户乙", installationAddress: "厚街镇双岗村下环东路北四巷9号" },
      { onuIndex: "1/4/1:1", username: "河田用户甲", installationAddress: "厚街镇河田村东头石坛前一巷1号" },
      { onuIndex: "1/5/1:1", username: "厚街用户甲", installationAddress: "厚街镇厚街村新兴路26号" }
    ],
    "172.19.104.102": [
      { onuIndex: "1/4/8:17", username: "双岗边缘户", installationAddress: "厚街镇双岗村中环南安坊六巷3号" },
      { onuIndex: "1/4/8:1", username: "桥头在线户", installationAddress: "厚街镇桥头村祠边公寓1栋904" },
      { onuIndex: "1/1/1:1", username: "新塘保和圩户", installationAddress: "厚街镇新塘村保和圩村中路13号" }
    ],
    "172.19.106.50": [
      { onuIndex: "1/1/1:1", username: "涌口花香户", installationAddress: "厚街镇涌口村花香十二院君雅阁904" }
    ],
    "172.19.106.51": [
      // 华为设备上的厚街村与大迳村用户，台账可能被历史记录为 1/1/1 或 0/1/1
      { onuIndex: "1/1/1:1", username: "厚街华为户", installationAddress: "厚街镇厚街村东风一路62号" },
      { onuIndex: "1/2/2:1", username: "双岗华为户", installationAddress: "厚街镇双岗村下环路段" }
    ]
  };

  const ponPorts = [
    { oltIp: "172.19.104.100", chassis: "1", board: "2", pon: "1", address: "双岗下环光交" },
    { oltIp: "172.19.104.100", chassis: "1", board: "2", pon: "2", address: "双岗下环北光交" },
    { oltIp: "172.19.104.100", chassis: "1", board: "4", pon: "1", address: "河田东头光交" },
    { oltIp: "172.19.104.100", chassis: "1", board: "5", pon: "1", address: "厚街新兴光交" },
    { oltIp: "172.19.104.102", chassis: "1", board: "4", pon: "8", address: "桥头祠边光交" },
    { oltIp: "172.19.104.102", chassis: "1", board: "1", pon: "1", address: "新塘保和圩光交" },
    { oltIp: "172.19.106.50", chassis: "1", board: "1", pon: "1", address: "涌口花香光交" },
    { oltIp: "172.19.106.51", chassis: "0", board: "1", pon: "1", address: "厚街东风光交" },
    { oltIp: "172.19.106.51", chassis: "0", board: "2", pon: "2", address: "双岗下环华为光交" }
  ];

  const gateway = createOltDataGateway({
    getOlts: async () => olts,
    getUsers: async ({ oltIp }) => users[oltIp] || [],
    getPonPorts: async () => ponPorts,
    getDatasetRevision: async () => "rev-multi-village",
    listOnus: async (olt, requested) => {
      // 模拟所有端口在 OLT 上实际均有通光在线用户
      const chassis = olt.vendor === "huawei" ? "0" : "1";
      return [{
        chassis,
        board: requested.board,
        slot: requested.board,
        pon: requested.pon,
        onuId: "1",
        name: "ONU-ONLINE",
        phase: "online",
        rxPower: "-20.5 dBm",
        serial: "TEST12345678"
      }];
    },
    getOnuStatusHistory: async () => [
      { sampledAt: "2026-09-13T00:00:00.000Z", phase: "online", rxPower: "-20.6 dBm", distance: "300 m" }
    ],
    readHistoricalOptical: async () => ({
      source: "oss-ngb",
      rows: [{ reportTime: "2026-09-13T00:00:00.000Z", rxOptical: -20.6 }]
    }),
    now: () => new Date("2026-09-14T00:00:00.000Z")
  });

  // 测试各村矩阵
  const testVillages = [
    { name: "双岗村", minPons: 3, description: "包含中兴交界借测与华为MA5800自适应" },
    { name: "河田村", minPons: 1, description: "全镇最大体量村" },
    { name: "厚街村", minPons: 2, description: "跨中兴C300与华为MA5800混部" },
    { name: "涌口村", minPons: 1, description: "中兴C600 TITAN架构" },
    { name: "新塘村", minPons: 1, description: "保和圩所属村" },
    { name: "桥头村", minPons: 1, description: "双岗交界主覆盖村" }
  ];

  const activeOltIds = olts.map((o) => o.id);

  for (const item of testVillages) {
    const query = await gateway.queryVillagePons({ value: item.name, oltIds: activeOltIds });
    assert.ok(query.total >= item.minPons, `${item.name} (${item.description}) 查出端口数必须不少于 ${item.minPons}`);

    for (const candidate of query.candidates) {
      const olt = olts.find((o) => o.id === candidate.oltId);
      if (olt.vendor === "huawei") {
        assert.equal(candidate.pon.chassis, "0", `${item.name} 中的华为设备 ${candidate.oltId} 机框号必须自适应为 0`);
      } else {
        assert.equal(candidate.pon.chassis, "1", `${item.name} 中的中兴设备 ${candidate.oltId} 机框号必须为 1`);
      }

      // 执行在线抽样
      const sample = await gateway.sampleVillagePonOnlineUser({
        value: item.name,
        oltIds: activeOltIds,
        oltId: candidate.oltId,
        pon: candidate.pon
      });

      assert.ok(sample.candidate, `${item.name} PON ${candidate.pon.chassis}/${candidate.pon.board}/${candidate.pon.pon} 抽样不得为空（消除未完成）`);
      assert.ok(sample.liveStatus.status.rxPower.includes("dBm"), `${item.name} 必须成功读取到光功率`);
    }
  }
});



