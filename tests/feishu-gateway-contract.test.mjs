import test from "node:test";
import assert from "node:assert/strict";
import { createInProcessFeishuGateway } from "../src/feishu/gateway-contract.mjs";

const coordinate = { chassis: "1", board: "7", pon: "8", onuId: "1" };

function validGateway(overrides = {}) {
  return {
    async status() {
      return { contractVersion: "1", readOnly: true, datasetRevision: "rev-1" };
    },
    async listOlts() {
      return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }];
    },
    async queryUsers() {
      return { authorizedCount: 1, candidates: [{
        candidateId: "olt-1:1/7/8:1", oltId: "olt-1", name: "用户", phone: "13800000000",
        address: "地址", loid: "DG1", mac: "AA", onu: coordinate, snapshotAt: null
      }] };
    },
    async readOnuStatus() {
      return { oltId: "olt-1", onu: coordinate,
        status: { phase: "online", rxPower: "-20", distance: "7 km", serial: "SN", name: "用户" },
        observedAt: "2026-08-05T00:00:00.000Z" };
    },
    async readOnuDetail() {
      return { oltId: "olt-1", onu: coordinate,
        status: { phase: "online", rxPower: "-20", distance: "7 km", serial: "SN", name: "用户" },
        detail: { interface: "gpon-onu_1/7/8:1", name: "用户", phaseState: "online",
          serialNumber: "SN", opticalRxPower: "-20", distance: "7 km" },
        unsupportedFields: [], observedAt: "2026-08-05T00:00:00.000Z" };
    },
    async readOnuHistory(request) {
      return { oltId: request.oltId, onu: request.coordinate, days: request.days ?? 7,
        rows: [{ sampledAt: "2026-08-05T00:00:00.000Z", phase: "online", rxPower: "-20", distance: "7 km" }],
        observedAt: "2026-08-05T00:00:00.000Z" };
    },
    async readOnuHistoricalOptical(request) {
      return { source: "oss-ngb", oltId: request.oltId, onu: request.coordinate,
        startDate: request.startDate, endDate: request.endDate,
        rows: [{ reportTime: "2026-08-05T00:00:00.000Z", rxOptical: -20,
          txOptical: null, oltRxOptical: -19, lightDecay: 1 }],
        observedAt: "2026-08-05T00:00:00.000Z" };
    },
    async queryPons() {
      return { authorizedCount: 0, candidates: [] };
    },
    async readPonStatuses() {
      return { oltId: "olt-1", pon: { chassis: "1", board: "7", pon: "8" },
        onuCount: 0, onus: [], observedAt: "2026-08-05T00:00:00.000Z" };
    },
    ...overrides
  };
}

test("in-process Feishu gateway preserves the read-only OltDataGateway contract", async () => {
  const gateway = createInProcessFeishuGateway({ gateway: validGateway() });
  assert.equal((await gateway.status()).readOnly, true);
  assert.equal((await gateway.listOlts())[0].oltId, "olt-1");
  assert.equal((await gateway.queryUsers({
    intent: "find_by_phone", value: "13800000000", oltIds: ["olt-1"]
  })).candidates.length, 1);
  assert.equal((await gateway.readOnuStatus({ oltId: "olt-1", coordinate })).status.phase, "online");
  assert.equal((await gateway.readOnuDetail({ oltId: "olt-1", coordinate })).detail.interface,
    "gpon-onu_1/7/8:1");
  assert.equal((await gateway.readOnuHistory({ oltId: "olt-1", coordinate, days: 7, limit: 48 })).rows.length, 1);
  assert.equal((await gateway.readOnuHistoricalOptical({ oltId: "olt-1", coordinate,
    startDate: "2026-08-01", endDate: "2026-08-05", limit: 48 })).rows.length, 1);
});

test("in-process Feishu gateway fails closed on incompatible projections", async () => {
  const gateway = createInProcessFeishuGateway({
    gateway: validGateway({
      async status() { return { contractVersion: "2", readOnly: true, datasetRevision: "rev-1" }; }
    })
  });
  await assert.rejects(() => gateway.status(), /contract violation/);
});

test("in-process Feishu gateway bounds ONU history and rejects unsafe projections", async () => {
  const gateway = createInProcessFeishuGateway({ gateway: validGateway({
    async readOnuHistory(request) {
      return { oltId: request.oltId, onu: request.coordinate, days: 7,
        rows: Array.from({ length: 49 }, () => ({ sampledAt: "t", phase: "online", rxPower: "-20", distance: "1 km" })),
        observedAt: "t" };
    }
  }) });
  await assert.rejects(() => gateway.readOnuHistory({ oltId: "olt-1", coordinate, days: 7, limit: 48 }), /contract violation/);
  await assert.rejects(() => gateway.readOnuHistory({ oltId: "olt-1", coordinate, days: 8, limit: 48 }), /contract violation/);
});

test("in-process Feishu gateway fails closed when remote historical optical is unavailable", async () => {
  const gateway = createInProcessFeishuGateway({ gateway: validGateway({
    readOnuHistoricalOptical: undefined
  }) });
  await assert.rejects(() => gateway.readOnuHistoricalOptical({
    oltId: "olt-1", coordinate, startDate: "2026-08-01", endDate: "2026-08-05"
  }), (error) => error.code === "HISTORICAL_OPTICAL_UNAVAILABLE");
});

test("in-process Feishu gateway rejects unsafe remote historical optical rows", async () => {
  const gateway = createInProcessFeishuGateway({ gateway: validGateway({
    async readOnuHistoricalOptical(request) {
      return { source: "oss-ngb", oltId: request.oltId, onu: request.coordinate,
        startDate: request.startDate, endDate: request.endDate,
        rows: [{ reportTime: "t", rxOptical: "-20", txOptical: null,
          oltRxOptical: -19, lightDecay: 1 }], observedAt: "t" };
    }
  }) });
  await assert.rejects(() => gateway.readOnuHistoricalOptical({
    oltId: "olt-1", coordinate, startDate: "2026-08-01", endDate: "2026-08-05"
  }), /contract violation/);
});
