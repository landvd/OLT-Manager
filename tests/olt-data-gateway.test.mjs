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
    capabilities: ["listOlts", "queryUsers", "readOnuStatus"]
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
