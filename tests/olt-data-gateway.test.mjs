import assert from "node:assert/strict";
import test from "node:test";
import { createOltDataGateway } from "../src/olt-data-gateway.mjs";

const olts = [
  { id: "olt-a", name: "A", vendor: "zte", model: "C300", host: "192.0.2.1", community: "secret", enabled: true },
  { id: "olt-b", name: "B", vendor: "huawei", model: "MA5800", host: "192.0.2.2", enabled: true }
];

const users = {
  "192.0.2.1": [
    { onuIndex: "1/2/3:4", username: "测试甲", userPhone: "13800000001", installationAddress: "测试地址一", loid: "LOID-A", mac: "00:11:22:33:44:55", syncedAt: "2026-07-29T00:00:00.000Z" },
    { onuIndex: "1/2/3:5", username: "测试乙", userPhone: "13800000002", installationAddress: "测试地址二", loid: "LOID-B", mac: "00:11:22:33:44:66", syncedAt: "2026-07-29T00:00:00.000Z" }
  ],
  "192.0.2.2": [
    { onuIndex: "0/1/2:3", username: "测试甲", userPhone: "13900000001", installationAddress: "其他地址", loid: "LOID-C", mac: "00:11:22:33:44:77", syncedAt: "2026-07-29T00:00:00.000Z" }
  ]
};

function buildGateway(overrides = {}) {
  return createOltDataGateway({
    getOlts: async () => olts,
    getUsers: async ({ oltIp }) => users[oltIp] || [],
    getPonPorts: async () => [
      { oltIp: "192.0.2.1", chassis: "1", board: "2", pon: "3", address: "合成山仔村一区" },
      { oltIp: "192.0.2.1", chassis: "1", board: "2", pon: "3", address: "合成山仔村一区重复台账" },
      { oltIp: "192.0.2.1", chassis: "1", board: "2", pon: "4", address: "合成山仔村二区" },
      { oltIp: "192.0.2.2", chassis: "0", board: "1", pon: "2", address: "其他地址" }
    ],
    getDatasetRevision: async () => "dataset:synthetic-revision-a",
    listOnus: async (_olt, coordinate) => [{ ...coordinate, serial: "ZTEG00000001", phase: "online", rxPower: "-20.10 dBm", distance: "120 m", name: "ONU" }],
    now: () => new Date("2026-07-29T01:00:00.000Z"),
    ...overrides
  });
}

test("projects only safe OLT metadata and declares a read-only v1 contract", async () => {
  const gateway = buildGateway();
  assert.deepEqual(await gateway.status(), {
    contractVersion: "1",
    readOnly: true,
    datasetRevision: "dataset:synthetic-revision-a",
    capabilities: [
      "listOlts",
      "queryUsers",
      "readOnuStatus",
      "readOnuDetail",
      "queryUserLiveStatus",
      "queryPons",
      "readPonStatuses"
    ]
  });
  assert.deepEqual(await gateway.listOlts(), [
    { oltId: "olt-a", name: "A", vendor: "zte", model: "C300", enabled: true },
    { oltId: "olt-b", name: "B", vendor: "huawei", model: "MA5800", enabled: true }
  ]);
  assert.equal(JSON.stringify(await gateway.listOlts()).includes("192.0.2.1"), false);
  assert.equal(JSON.stringify(await gateway.listOlts()).includes("secret"), false);
});

test("queryUsers requires a bounded authorized scope and filters before counting", async () => {
  const gateway = buildGateway();
  await assert.rejects(() => gateway.queryUsers({ intent: "find_by_name", value: "测试甲", oltIds: [] }), /OLT scope/);
  await assert.rejects(() => gateway.queryUsers({ intent: "find_by_name", value: "", oltIds: ["olt-a"] }), /search value/);
  await assert.rejects(() => gateway.queryUsers({ intent: "unsupported", value: "x", oltIds: ["olt-a"] }), /intent/);

  const result = await gateway.queryUsers({ intent: "find_by_name", value: "测试甲", oltIds: ["olt-a"] });
  assert.equal(result.authorizedCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].oltId, "olt-a");
  assert.equal(result.candidates[0].name, "测试甲");
  assert.deepEqual(result.candidates[0].onu, { chassis: "1", board: "2", pon: "3", onuId: "4" });
  assert.equal(JSON.stringify(result).includes("oltIp"), false);
});

test("unknown OLT scope fails closed without reading any user snapshot", async () => {
  let reads = 0;
  const gateway = buildGateway({ getUsers: async () => { reads += 1; return []; } });
  await assert.rejects(() => gateway.queryUsers({ intent: "find_by_name", value: "测试", oltIds: ["missing"] }), /Unknown OLT/);
  assert.equal(reads, 0);
});

test("disabled OLT scope fails closed without reading any user snapshot", async () => {
  let reads = 0;
  const gateway = buildGateway({
    getOlts: async () => [{ ...olts[0], enabled: false }],
    getUsers: async () => { reads += 1; return []; }
  });
  await assert.rejects(() => gateway.queryUsers({ intent: "find_by_name", value: "测试", oltIds: ["olt-a"] }), /Disabled OLT/);
  assert.equal(reads, 0);
});

test("readOnuStatus requires one authorized OLT and exact coordinate", async () => {
  const gateway = buildGateway();
  const result = await gateway.readOnuStatus({
    oltId: "olt-a",
    coordinate: { chassis: "1", board: "2", pon: "3", onuId: "4" }
  });
  assert.deepEqual(result, {
    oltId: "olt-a",
    onu: { chassis: "1", board: "2", pon: "3", onuId: "4" },
    status: { phase: "online", rxPower: "-20.10 dBm", distance: "120 m", serial: "ZTEG00000001", name: "ONU" },
    observedAt: "2026-07-29T01:00:00.000Z"
  });
  await assert.rejects(() => gateway.readOnuStatus({ oltId: "missing", coordinate: { chassis: "1", board: "2", pon: "3", onuId: "4" } }), /Unknown OLT/);
});

test("readOnuDetail returns only verified read-only ONU detail fields", async () => {
  let listOptions;
  const gateway = buildGateway({
    listOnus: async (_olt, coordinate, options) => {
      listOptions = options;
      return [{
        ...coordinate,
        name: "ONU-3:4",
        serial: "ZTEG00000001",
        phase: "working",
        rxPower: "-20.10 dBm",
        distance: "120 m",
        lastOnlineTime: "2026-07-29 01:00:00"
      }];
    }
  });
  const result = await gateway.readOnuDetail({
    oltId: "olt-a",
    coordinate: { chassis: "1", board: "2", pon: "3", onuId: "4" }
  });
  assert.deepEqual(result.detail, {
    interface: "gpon-onu_1/2/3:4",
    name: "ONU-3:4",
    phaseState: "working",
    serialNumber: "ZTEG00000001",
    opticalRxPower: "-20.10 dBm",
    distance: "120 m",
    lastOnlineTime: "2026-07-29 01:00:00"
  });
  assert.equal(result.unsupportedFields.includes("authenticationMode"), true);
  assert.equal(result.status.phase, "working");
  assert.deepEqual(listOptions, { includeLastOnlineTime: true });
});

test("readOnuDetail fails closed for an OLT vendor without verified detail OIDs", async () => {
  let reads = 0;
  const gateway = buildGateway({
    listOnus: async () => {
      reads += 1;
      return [];
    }
  });
  await assert.rejects(
    () => gateway.readOnuDetail({
      oltId: "olt-b",
      coordinate: { chassis: "0", board: "1", pon: "2", onuId: "3" }
    }),
    /not verified/
  );
  assert.equal(reads, 0);
});

test("queryUserLiveStatus reads one unique authorized user and rejects ambiguous matches before OLT access", async () => {
  let liveReads = 0;
  const gateway = buildGateway({
    listOnus: async (_olt, coordinate) => {
      liveReads += 1;
      return [{
        ...coordinate,
        serial: "ZTEG00000001",
        phase: "online",
        rxPower: "-20.10 dBm",
        distance: "120 m",
        name: "ONU"
      }];
    }
  });
  const result = await gateway.queryUserLiveStatus({
    intent: "find_by_phone",
    value: "13800000001",
    oltIds: ["olt-a"]
  });
  assert.equal(result.candidate.name, "测试甲");
  assert.equal(result.liveStatus.status.phase, "online");
  assert.equal(result.liveStatus.status.rxPower, "-20.10 dBm");
  assert.equal(liveReads, 1);

  await assert.rejects(() => gateway.queryUserLiveStatus({
    intent: "find_by_name",
    value: "测试甲",
    oltIds: ["olt-a", "olt-b"]
  }), /exactly one/);
  assert.equal(liveReads, 1);

  await assert.rejects(() => gateway.queryUserLiveStatus({
    intent: "find_by_name",
    value: "不存在",
    oltIds: ["olt-a"]
  }), /not found/);
  assert.equal(liveReads, 1);
});

test("readPonStatuses returns only bounded optical power and online state for the exact PON", async () => {
  const gateway = buildGateway({
    listOnus: async () => [
      { chassis: "1", board: "2", pon: "3", onuId: "10", phase: "offline", rxPower: "unknown", serial: "hidden-10", name: "hidden" },
      { chassis: "1", board: "2", pon: "3", onuId: "5", phase: "online", rxPower: "-19.50 dBm", serial: "hidden-5", name: "hidden" },
      { chassis: "1", board: "2", pon: "4", onuId: "1", phase: "online", rxPower: "-18.00 dBm" }
    ]
  });
  const result = await gateway.readPonStatuses({
    oltId: "olt-a",
    coordinate: { chassis: "1", board: "2", pon: "3" }
  });
  assert.deepEqual(result, {
    oltId: "olt-a",
    pon: { chassis: "1", board: "2", pon: "3" },
    onuCount: 2,
    onus: [
      {
        onu: { chassis: "1", board: "2", pon: "3", onuId: "5" },
        name: "测试乙",
        phase: "online",
        rxPower: "-19.50 dBm"
      },
      {
        onu: { chassis: "1", board: "2", pon: "3", onuId: "10" },
        name: "",
        phase: "offline",
        rxPower: "unknown"
      }
    ],
    observedAt: "2026-07-29T01:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(result), /serial|hidden|community|192\.0\.2|13800000002|测试地址二/);

  const oversized = buildGateway({
    listOnus: async () => Array.from({ length: 129 }, (_, index) => ({
      chassis: "1",
      board: "2",
      pon: "3",
      onuId: String(index + 1)
    }))
  });
  await assert.rejects(() => oversized.readPonStatuses({
    oltId: "olt-a",
    coordinate: { chassis: "1", board: "2", pon: "3" }
  }), /128 ONU safety limit/);
});

test("queryPons filters ledger addresses inside Authorized OLT Scope before counting", async () => {
  const gateway = buildGateway();
  const result = await gateway.queryPons({
    value: "山仔村",
    oltIds: ["olt-a"],
    limit: 10
  });
  assert.equal(result.authorizedCount, 2);
  assert.deepEqual(result.candidates.map(({ oltId, address, pon }) => ({
    oltId,
    address,
    pon
  })), [
    {
      oltId: "olt-a",
      address: "合成山仔村一区",
      pon: { chassis: "1", board: "2", pon: "3" }
    },
    {
      oltId: "olt-a",
      address: "合成山仔村二区",
      pon: { chassis: "1", board: "2", pon: "4" }
    }
  ]);
  await assert.rejects(() => gateway.queryPons({
    value: "山仔村",
    oltIds: []
  }), /OLT scope/);
  assert.doesNotMatch(JSON.stringify(result), /192\.0\.2|outerVlan|community/);
});

test("queryPons matches a village query when the ledger omits the 村 suffix", async () => {
  const gateway = buildGateway({
    getPonPorts: async () => [
      {
        oltIp: "192.0.2.1",
        chassis: "1",
        board: "9",
        pon: "14",
        address: "合成寮厦彩云路光交箱-2"
      }
    ]
  });

  const result = await gateway.queryPons({
    value: "寮厦村",
    oltIds: ["olt-a"]
  });

  assert.equal(result.authorizedCount, 1);
  assert.equal(result.candidates[0].address, "合成寮厦彩云路光交箱-2");
});
