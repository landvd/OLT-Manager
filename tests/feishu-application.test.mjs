import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

function store() {
  let value = {
    ...emptyFeishuState(), enabled: true
  };
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

function gateway(calls = []) {
  return {
    async listOlts() { return [
      { oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true },
      { oltId: "olt-2", name: "OLT 2", vendor: "zte", model: "C300", enabled: true }
    ]; },
    async queryUsers(request) {
      calls.push(request);
      return { authorizedCount: 1, candidates: [{
      candidateId: "olt-1:1/7/8:1", oltId: request.oltIds[0], name: "用户", phone: "",
      address: "地址", primaryAddress: "一级地址", loid: "", mac: "",
      onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, snapshotAt: null
      }] };
    },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async readOnuDetail(request) {
      return {
        oltId: request.oltId, onu: request.coordinate, observedAt: "2026-08-05T00:00:01.000Z",
        unsupportedFields: [],
        status: { phase: "online", rxPower: "-20 dBm", distance: "1 km", serial: "SN-1", name: "用户" },
        detail: {
          interface: "1/7/8/1", name: "用户", phaseState: "在线", serialNumber: "SN-1",
          opticalRxPower: "-20 dBm", distance: "1 km", lastOnlineTime: null,
          lastOfflineTime: null, lastOfflineCause: null, lastOfflineCauseCode: null
        }
      };
    }
  };
}

function detailGateway({ userCount = 1, ponCount = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async listOlts() {
      return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }];
    },
    async queryUsers() {
      const candidates = Array.from({ length: userCount }, (_, index) => ({
        candidateId: `olt-1:1/7/8:${index + 1}`, oltId: "olt-1", name: `用户${index + 1}`, phone: "",
        address: "地址", primaryAddress: "一级地址", loid: "LOID-SYNTH", mac: "", serialNumber: "SN-1",
        onu: { chassis: "1", board: "7", pon: "8", onuId: String(index + 1) }, snapshotAt: null
      }));
      return { authorizedCount: userCount, candidates };
    },
    async queryPons() {
      const candidates = Array.from({ length: ponCount }, (_, index) => ({
        candidateId: `olt-1:pon:1/7/${index + 8}`, oltId: "olt-1", oltName: "OLT 1", address: `地址${index + 1}`,
        pon: { chassis: "1", board: "7", pon: String(index + 8) }
      }));
      return { authorizedCount: ponCount, candidates };
    },
    async readOnuDetail(request) {
      calls.push(["onu", request]);
      return {
        oltId: "olt-1", onu: request.coordinate, observedAt: "2026-08-05T00:00:01.000Z",
        unsupportedFields: [],
        status: { phase: "online", rxPower: "-20 dBm", distance: "1 km", serial: "SN-1", name: "用户" },
        detail: {
          interface: "1/7/8/1", name: "用户", phaseState: "在线", serialNumber: "SN-1",
          opticalRxPower: "-20 dBm", distance: "1 km", lastOnlineTime: null,
          lastOfflineTime: null, lastOfflineCause: null, lastOfflineCauseCode: null
        }
      };
    },
    async readPonStatuses(request) {
      calls.push(["pon", request]);
      return {
        oltId: "olt-1", pon: request.coordinate, onuCount: 1,
        onus: [{ onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, name: "用户", phase: "在线", rxPower: "-20 dBm" }],
        observedAt: "2026-08-05T00:00:01.000Z"
      };
    },
    async readOnuHistory(request) {
      calls.push(["history", request]);
      return {
        oltId: request.oltId, onu: request.coordinate, days: request.days,
        rows: [{ sampledAt: "2026-08-04T00:00:00.000Z", phase: "online", rxPower: "-21 dBm", distance: "1 km" }],
        observedAt: "2026-08-05T00:00:01.000Z"
      };
    }
  };
}

function directStore() {
  let value = {
    ...emptyFeishuState(), enabled: true,
    operators: [{ openId: "ou-1", oltIds: ["olt-1"] }],
    authorizedChats: [{ chatId: "oc-direct", type: "direct" }]
  };
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

test("Feishu direct messages use every enabled OLT without operator or chat authorization", async () => {
  const stateStore = store();
  const calls = [];
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore, gateway: gateway(calls),
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    send: async (_chatId, reply) => replies.push(reply),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-1", openId: "ou-new", chatId: "oc-direct-new", text: "查用户" });
  assert.equal(result.kind, "onu-detail");
  assert.deepEqual(calls[0].oltIds, ["olt-1", "olt-2"]);
  assert.equal(replies[0].candidate.oltId, "olt-1");
  assert.deepEqual(stateStore.value().accessRequests, []);
  assert.equal(stateStore.value().auditArchive.at(-1).decision, "allowed");
});

test("Feishu help is handled locally and does not touch the data gateway", async () => {
  const stateStore = store();
  const replies = [];
  let listCalls = 0;
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      ...gateway(),
      async listOlts() { listCalls += 1; return []; }
    },
    interpret: async () => { throw new Error("help must not reach interpretation"); },
    send: async (_chatId, reply) => replies.push(reply),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-help", openId: "ou-1", chatId: "oc-1", text: "帮助" });
  assert.equal(result.kind, "help");
  assert.match(result.message, /姓名/);
  assert.equal(listCalls, 0);
  assert.equal(replies[0].kind, "help");
  assert.equal(stateStore.value().auditArchive.at(-1).queryType, "help");
});

test("Feishu device-number search uses a dedicated read-only gateway seam", async () => {
  const stateStore = store();
  const calls = [];
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      ...gateway(),
      async queryUsersByDeviceNumber(request) {
        calls.push(request);
        return { authorizedCount: 1, candidates: [{
          candidateId: "device:1", oltId: "olt-1", name: "用户", deviceNumber: "DEV-123",
          onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }
        }] };
      },
      async readOnuDetail(request) {
        return {
          oltId: request.oltId, onu: request.coordinate, observedAt: "2026-08-05T00:00:00.000Z",
          status: { phase: "online", rxPower: "-20 dBm", distance: "1 km", serial: "SN-1", name: "用户" },
          detail: { interface: "1/7/8/1", name: "用户", phaseState: "online", serialNumber: "SN-1" }
        };
      }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_device_number", value: "DEV-123" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-device", openId: "ou-1", chatId: "oc-1", text: "设备号 DEV-123" });
  assert.equal(result.kind, "onu-detail");
  assert.deepEqual(calls[0], { value: "DEV-123", oltIds: ["olt-1", "olt-2"], limit: 100 });
  assert.equal(result.candidate.deviceNumber, "DEV-123");
});

test("Feishu does not silently treat device-number search as serial-number search", async () => {
  const stateStore = store();
  const dataGateway = gateway();
  dataGateway.queryUsers = async () => ({ authorizedCount: 0, candidates: [] });
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_device_number", value: "DEV-123" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-device-unsupported", openId: "ou-1", chatId: "oc-1", text: "设备号 DEV-123" });
  assert.equal(result.kind, "help");
  assert.match(result.message, /查询顺序/);
});

test("Feishu search fallback follows name, phone, LOID, device number, then address", async () => {
  const stateStore = store();
  const calls = [];
  const candidate = {
    candidateId: "olt-1:1/7/8:1", oltId: "olt-1", name: "用户", phone: "",
    address: "地址", loid: "DG21422225", deviceNumber: "1524001193500012871",
    onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }
  };
  const dataGateway = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }]; },
    async queryUsers({ intent }) {
      calls.push(intent);
      return intent === "find_by_loid" ? { authorizedCount: 1, candidates: [candidate] } : { authorizedCount: 0, candidates: [] };
    },
    async queryUsersByDeviceNumber({ value }) {
      calls.push(["find_by_device_number", value]);
      return { authorizedCount: 0, candidates: [] };
    },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async readOnuDetail(request) {
      return {
        oltId: request.oltId, onu: request.coordinate, observedAt: "2026-08-05T00:00:00.000Z",
        status: { phase: "online", rxPower: "-20 dBm", distance: "1 km", serial: "DG21422225", name: "用户" },
        detail: { interface: "1/7/8/1", name: "用户", phaseState: "online", serialNumber: "DG21422225" }
      };
    }
  };
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => { throw new Error("language service unavailable"); },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({
    eventId: "evt-ordered-search", openId: "ou-1", chatId: "oc-1", text: "DG21422225"
  });
  assert.equal(result.kind, "onu-detail");
  assert.deepEqual(calls, ["find_by_name", "find_by_phone", "find_by_loid"]);
  assert.equal(result.candidate.loid, "DG21422225");
});

test("Feishu exact LOID no-match does not fall back to another search intent", async () => {
  const stateStore = store();
  const calls = [];
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      ...gateway(),
      async queryUsers(request) {
        calls.push(request.intent);
        return { authorizedCount: 0, candidates: [] };
      }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_loid", value: "13800000000" }),
    send: async () => {},
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-loid-no-match", openId: "ou-1", chatId: "oc-direct-new", text: "LOID:13800000000" });
  assert.equal(result.kind, "loid-no-match");
  assert.deepEqual(calls, ["find_by_loid"]);
});

test("Feishu explicit LOID stays exact when interpretation errors or is invalid", async () => {
  for (const interpret of [
    async () => { throw new Error("language service unavailable"); },
    async () => null
  ]) {
    const stateStore = store();
    const calls = [];
    const app = createFeishuQueryApplication({
      stateStore,
      gateway: {
        ...gateway(),
        async queryUsers(request) {
          calls.push(request);
          return { authorizedCount: 0, candidates: [] };
        }
      },
      interpret,
      send: async () => {},
      now: () => "2026-08-05T00:00:00.000Z"
    });
    const result = await app.handleMessage({ eventId: `evt-loid-${calls.length}`, openId: "ou-1", chatId: "oc-direct-new", text: "查LOID:13800000000" });
    assert.equal(result.kind, "loid-no-match");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].intent, "find_by_loid");
    assert.equal(calls[0].value, "13800000000");
  }
});

test("Feishu returns the help menu when the ordered search has no match", async () => {
  const stateStore = store();
  const calls = [];
  const dataGateway = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }]; },
    async queryUsers({ intent }) { calls.push(intent); return { authorizedCount: 0, candidates: [] }; },
    async queryUsersByDeviceNumber() { calls.push("find_by_device_number"); return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; }
  };
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => { throw new Error("language service unavailable"); },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({
    eventId: "evt-ordered-help", openId: "ou-1", chatId: "oc-1", text: "不存在的查询值"
  });
  assert.equal(result.kind, "help");
  assert.match(result.message, /姓名 → 手机 → LOID → 设备号 → 地址/);
  assert.deepEqual(calls, ["find_by_name", "find_by_phone", "find_by_loid", "find_by_device_number", "find_by_address"]);
});

test("Feishu group messages are denied before interpretation", async () => {
  const stateStore = store();
  let interpretationCalls = 0;
  const app = createFeishuQueryApplication({
    stateStore, gateway: gateway(),
    interpret: async () => { interpretationCalls += 1; return null; },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-2", kind: "group", openId: "ou-1", chatId: "oc-group", text: "查用户" });
  assert.equal(result.kind, "denied");
  assert.match(result.message, /仅支持飞书单聊/);
  assert.equal(interpretationCalls, 0);
});

test("direct messages do not create access requests", async () => {
  const stateStore = store();
  const app = createFeishuQueryApplication({
    stateStore, gateway: gateway(),
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-direct", kind: "direct", openId: "ou-requester", chatId: "oc-request", text: "查询" });
  assert.equal(result.kind, "onu-detail");
  assert.deepEqual(stateStore.value().accessRequests, []);
});

test("short Chinese address queries fall back from name search to PON address search", async () => {
  const stateStore = directStore();
  const calls = [];
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      ...gateway(),
      async listOlts() {
        return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }];
      },
      async queryUsers(request) {
        calls.push(["users", request]);
        return { authorizedCount: 0, candidates: [] };
      },
      async queryPons(request) {
        calls.push(["pons", request]);
        return {
          authorizedCount: 1,
          candidates: [{
            candidateId: "olt-1:pon:1/7/8", oltId: "olt-1", oltName: "OLT 1",
            address: "示例广场", pon: { chassis: "1", board: "7", pon: "8" }
          }]
        };
      },
      async readPonStatuses(request) {
        return {
          oltId: "olt-1", pon: request.coordinate, onuCount: 0, onus: [],
          observedAt: "2026-08-05T00:00:00.000Z"
        };
      }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "示例" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });

  const result = await app.handleMessage({
    eventId: "evt-short-address", openId: "ou-1", chatId: "oc-direct", text: "示例"
  });
  assert.equal(result.kind, "pon-detail");
  assert.deepEqual(calls.map(([kind]) => kind), ["users", "pons"]);
  assert.equal(result.candidate.address, "示例广场");
});

test("Feishu direct OLT IPv4 PON query uses the exact read-only gateway seam", async () => {
  const stateStore = directStore();
  const calls = [];
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      ...gateway(),
      async listOlts() {
        return [{ oltId: "olt-1", name: "OLT 1", ip: "192.0.2.1", vendor: "zte", model: "C300", enabled: true }];
      },
      async readPonStatusesByIp(request) {
        calls.push(request);
        return {
          oltId: "olt-1", pon: { chassis: "1", board: request.board, pon: request.pon },
          onuCount: 0, onus: [], observedAt: "2026-08-05T00:00:00.000Z"
        };
      }
    },
    interpret: async () => { throw new Error("exact IP query must not reach interpretation"); },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({
    eventId: "evt-direct-ip", openId: "ou-1", chatId: "oc-direct", text: "查 192.0.2.1/7/8"
  });
  const spaced = await app.handleMessage({
    eventId: "evt-direct-ip-spaced", openId: "ou-1", chatId: "oc-direct", text: "192.0.2.1 7/12"
  });
  assert.equal(result.kind, "pon-detail");
  assert.equal(spaced.kind, "pon-detail");
  assert.deepEqual(calls, [
    { oltIp: "192.0.2.1", board: "7", pon: "8", oltIds: ["olt-1"] },
    { oltIp: "192.0.2.1", board: "7", pon: "12", oltIds: ["olt-1"] }
  ]);
  assert.deepEqual(result.candidate.pon, { chassis: "1", board: "7", pon: "8" });
  assert.deepEqual(spaced.candidate.pon, { chassis: "1", board: "7", pon: "12" });
});

test("Feishu direct OLT IPv4 PON query does not partially consume a four-part coordinate", async () => {
  let directReads = 0;
  let interpretations = 0;
  const app = createFeishuQueryApplication({
    stateStore: directStore(),
    gateway: {
      ...gateway(),
      async readPonStatusesByIp() {
        directReads += 1;
        throw new Error("four-part coordinate must not reach direct PON lookup");
      }
    },
    interpret: async () => {
      interpretations += 1;
      return null;
    },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  await app.handleMessage({
    eventId: "evt-direct-ip-four-part", openId: "ou-1", chatId: "oc-direct", text: "192.0.2.1/1/7/12"
  });
  assert.equal(directReads, 0);
  assert.equal(interpretations, 1);
});

test("Feishu direct OLT IPv4 PON query rejects invalid and disabled scopes", async () => {
  const invalidApp = createFeishuQueryApplication({
    stateStore: directStore(), gateway: gateway(),
    interpret: async () => { throw new Error("invalid IP must be rejected locally"); },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const invalid = await invalidApp.handleMessage({
    eventId: "evt-direct-ip-invalid", openId: "ou-1", chatId: "oc-direct", text: "192.0.2.999/7/8"
  });
  assert.equal(invalid.kind, "invalid-query");

  const disabledApp = createFeishuQueryApplication({
    stateStore: directStore(),
    gateway: { ...gateway(), async listOlts() {
      return [{ oltId: "olt-1", name: "OLT 1", ip: "192.0.2.1", enabled: false }];
    } },
    interpret: async () => { throw new Error("disabled IP must be rejected before interpretation"); },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const disabled = await disabledApp.handleMessage({
    eventId: "evt-direct-ip-disabled", openId: "ou-1", chatId: "oc-direct", text: "192.0.2.1/7/8"
  });
  assert.equal(disabled.kind, "retry-later");
});

test("unique user detail failure falls back to the available live status", async () => {
  const stateStore = directStore();
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      async listOlts() {
        return [{ oltId: "olt-1", name: "OLT 1", vendor: "huawei", model: "MA5800", enabled: true }];
      },
      async queryUsers() {
        return {
          authorizedCount: 1,
          candidates: [{
            candidateId: "olt-1:1/7/8:1", oltId: "olt-1", name: "赵六", phone: "",
            address: "示例广场", primaryAddress: "示例", loid: "", mac: "",
            onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, snapshotAt: null
          }]
        };
      },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async readOnuDetail() { throw new Error("detail unsupported"); },
      async readOnuStatus(request) {
        return {
          oltId: "olt-1", onu: request.coordinate,
          status: { phase: "online", rxPower: "-23 dBm", distance: "2 km", serial: "SN-2", name: "赵六" },
          observedAt: "2026-08-05T00:00:00.000Z"
        };
      }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "赵六" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });

  const result = await app.handleMessage({
    eventId: "evt-test-name", openId: "ou-1", chatId: "oc-direct", text: "赵六"
  });
  assert.equal(result.kind, "onu-detail");
  assert.equal(result.degraded, true);
  assert.equal(result.detail.status.serial, "SN-2");
});

test("stale user snapshots still return profile details when the ONU is absent from the OLT", async () => {
  const stateStore = directStore();
  const notFound = Object.assign(new Error("ONU not found"), { statusCode: 404 });
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: {
      async listOlts() {
        return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }];
      },
      async queryUsers() {
        return {
          authorizedCount: 1,
          candidates: [{
            candidateId: "olt-1:1/2/3:4", oltId: "olt-1", name: "赵六", phone: "13800000000",
            address: "广东省示例市示例镇示例广场1栋101", primaryAddress: "示例广场", loid: "", mac: "",
            onu: { chassis: "1", board: "2", pon: "3", onuId: "4" }, snapshotAt: null
          }]
        };
      },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async readOnuDetail() { throw notFound; },
      async readOnuStatus() { throw notFound; }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "赵六" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });

  const result = await app.handleMessage({
    eventId: "evt-stale-test-name", openId: "ou-1", chatId: "oc-direct", text: "赵六"
  });
  assert.equal(result.kind, "onu-detail");
  assert.equal(result.degraded, true);
  assert.match(result.degradedReason, /未返回该 ONU/);
  assert.equal(result.candidate.phone, "13800000000");
});

test("candidate results paginate without changing the bound candidate index", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway({ userCount: 12 });
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });

  const firstPage = await app.handleMessage({
    eventId: "evt-pagination", openId: "ou-1", chatId: "oc-direct", text: "用户"
  });
  assert.equal(firstPage.kind, "candidate-set");
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.pageSize, 5);
  assert.equal(firstPage.candidates.length, 12);

  const secondPage = await app.handleCallback({
    eventId: "cb-pagination-page", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: firstPage.selection.token, index: 0, action: "candidate-page", page: 2,
      expiresAt: firstPage.selection.expiresAt
    }
  });
  assert.equal(secondPage.page, 2);

  const selected = await app.handleCallback({
    eventId: "cb-pagination-select", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: { token: firstPage.selection.token, index: 5, expiresAt: firstPage.selection.expiresAt }
  });
  assert.equal(selected.kind, "onu-detail");
  assert.equal(dataGateway.calls.at(-1)[1].coordinate.onuId, "6");
});

test("candidate binding opens a read-only ONU detail after callback reauthorization", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway({ userCount: 2 });
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    send: async (_chatId, reply) => replies.push(reply),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const candidates = await app.handleMessage({ eventId: "evt-candidate", openId: "ou-1", chatId: "oc-direct", text: "查用户" });
  assert.equal(candidates.kind, "candidate-set");
  assert.match(candidates.selection.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(candidates.selection.expiresAt, "2026-08-05T00:05:00.000Z");

  const detail = await app.handleCallback({
    eventId: "callback-1", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: { token: candidates.selection.token, index: 0 }
  });
  assert.equal(detail.kind, "onu-detail");
  assert.equal(detail.detail.detail.interface, "1/7/8/1");
  assert.deepEqual(dataGateway.calls[0], ["onu", {
    oltId: "olt-1", coordinate: { chassis: "1", board: "7", pon: "8", onuId: "1" }
  }]);
  assert.equal(replies[0].kind, "candidate-set");
  assert.equal(stateStore.value().auditArchive.at(-1).eventType, "callback");
  assert.equal(stateStore.value().auditArchive.at(-1).decision, "allowed");
});

test("ONU detail can open read-only PON optical power by primary address", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });

  const detail = await app.handleMessage({
    eventId: "evt-primary-address", openId: "ou-1", chatId: "oc-direct", text: "查用户"
  });
  assert.equal(detail.kind, "onu-detail");
  assert.ok(detail.primaryAddressQuery?.token);

  const pon = await app.handleCallback({
    eventId: "callback-primary-address", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: detail.primaryAddressQuery.token,
      index: 0,
      action: "onu-primary-address-power",
      expiresAt: detail.primaryAddressQuery.expiresAt
    }
  });
  assert.equal(pon.kind, "pon-detail");
  assert.deepEqual(dataGateway.calls.at(-1), ["pon", {
    oltId: "olt-1", coordinate: { chassis: "1", board: "7", pon: "8" }
  }]);
});

test("ONU detail copy LOID and history callbacks use opaque bindings and exact scope", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const detail = await app.handleMessage({
    eventId: "evt-copy-history", openId: "ou-1", chatId: "oc-direct", text: "查用户"
  });
  assert.ok(detail.copyLoidQuery?.token);
  assert.ok(detail.historyQuery?.token);
  assert.equal(JSON.stringify(detail.copyLoidQuery).includes("LOID-SYNTH"), false);

  const copied = await app.handleCallback({
    eventId: "callback-copy-loid", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: detail.copyLoidQuery.token, index: 0, action: "onu-copy-loid",
      expiresAt: detail.copyLoidQuery.expiresAt
    }
  });
  assert.deepEqual(copied, { kind: "onu-loid-copy", message: "LOID-SYNTH" });
  assert.equal(stateStore.value().auditArchive.at(-1).queryType, "copy_onu_loid");

  const history = await app.handleCallback({
    eventId: "callback-onu-history", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: detail.historyQuery.token, index: 0, action: "onu-history",
      expiresAt: detail.historyQuery.expiresAt
    }
  });
  assert.equal(history.kind, "onu-history");
  assert.deepEqual(dataGateway.calls.at(-1), ["history", {
    oltId: "olt-1", coordinate: { chassis: "1", board: "7", pon: "8", onuId: "1" }, days: 7, limit: 48
  }]);
  assert.equal(stateStore.value().auditArchive.at(-1).queryType, "read_onu_history");
});

test("ONU history falls back to local read-only history when remote optical history is unavailable", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
  dataGateway.readOnuHistoricalOptical = async () => {
    const error = new Error("网管二期会话已失效");
    error.code = "HISTORICAL_OPTICAL_SESSION_EXPIRED";
    throw error;
  };
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const detail = await app.handleMessage({
    eventId: "evt-history-fallback", openId: "ou-1", chatId: "oc-direct", text: "查用户"
  });
  const history = await app.handleCallback({
    eventId: "callback-history-fallback", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: detail.historyQuery.token, index: 0, action: "onu-history",
      expiresAt: detail.historyQuery.expiresAt
    }
  });
  assert.equal(history.kind, "onu-history");
  assert.equal(history.history.source, undefined);
  assert.equal(history.history.rows.length, 1);
  assert.equal(stateStore.value().auditArchive.at(-1).queryType, "read_onu_history");
});

test("long optical callbacks update the original card with progress and final result", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore,
    gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    send: async (...args) => replies.push(args),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const detail = await app.handleMessage({
    eventId: "evt-optical-progress", openId: "ou-1", chatId: "oc-direct", text: "查用户"
  });
  const history = await app.handleCallback({
    eventId: "callback-optical-history", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct", messageId: "mid-history",
    binding: {
      token: detail.historyQuery.token, index: 0, action: "onu-history",
      expiresAt: detail.historyQuery.expiresAt
    }
  });
  assert.equal(history.kind, "onu-history");
  assert.equal(replies.at(-2)[1].kind, "onu-history-loading");
  assert.deepEqual(replies.at(-2)[2], { messageId: "mid-history", replaceOriginal: true });
  assert.equal(replies.at(-1)[1].kind, "onu-history");
  assert.deepEqual(replies.at(-1)[2], { messageId: "mid-history", replaceOriginal: true });

  const primary = await app.handleCallback({
    eventId: "callback-optical-primary", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct", messageId: "mid-primary",
    binding: {
      token: detail.primaryAddressQuery.token, index: 0, action: "onu-primary-address-power",
      expiresAt: detail.primaryAddressQuery.expiresAt
    }
  });
  assert.equal(primary.kind, "pon-detail");
  assert.equal(replies.at(-2)[1].kind, "onu-primary-address-loading");
  assert.equal(replies.at(-1)[1].kind, "pon-detail");
  assert.deepEqual(replies.at(-1)[2], { messageId: "mid-primary", replaceOriginal: true });
});

test("ONU history callback rejects cross-chat and expiry", async () => {
  const stateStore = directStore();
  let current = "2026-08-05T00:00:00.000Z";
  const app = createFeishuQueryApplication({
    stateStore, gateway: detailGateway(),
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => current
  });
  const detail = await app.handleMessage({ eventId: "evt-history-guard", openId: "ou-1", chatId: "oc-direct", text: "查用户" });
  const denied = await app.handleCallback({
    eventId: "callback-history-cross-chat", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-other",
    binding: { token: detail.historyQuery.token, index: 0, action: "onu-history", expiresAt: detail.historyQuery.expiresAt }
  });
  assert.equal(denied.kind, "denied");
  current = "2026-08-05T00:05:01.000Z";
  const expired = await app.handleCallback({
    eventId: "callback-history-expired", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: { token: detail.historyQuery.token, index: 0, action: "onu-history", expiresAt: detail.historyQuery.expiresAt }
  });
  assert.equal(expired.kind, "expired-callback");
});

test("PON candidate callback returns bounded read-only PON status", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway({ ponCount: 2 });
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_pon_by_address", value: "地址" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const candidates = await app.handleMessage({ eventId: "evt-pon", openId: "ou-1", chatId: "oc-direct", text: "查地址" });
  assert.equal(candidates.kind, "pon-candidate-set");
  const detail = await app.handleCallback({
    eventId: "callback-pon", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: { token: candidates.selection.token, index: 0, expiresAt: candidates.selection.expiresAt }
  });
  assert.equal(detail.kind, "pon-detail");
  assert.equal(detail.detail.onuCount, 1);
  assert.deepEqual(dataGateway.calls[0], ["pon", {
    oltId: "olt-1", coordinate: { chassis: "1", board: "7", pon: "8" }
  }]);
});

test("unique PON matches return read-only PON status without a card click", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_pon_by_address", value: "地址" }),
    send: async (_chatId, reply) => replies.push(reply),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const detail = await app.handleMessage({ eventId: "evt-pon-direct", openId: "ou-1", chatId: "oc-direct", text: "查地址" });

  assert.equal(detail.kind, "pon-detail");
  assert.equal(detail.detail.onuCount, 1);
  assert.equal(detail.sorting.current, "power");
  assert.match(detail.sorting.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(replies[0].kind, "pon-detail");
  assert.deepEqual(dataGateway.calls[0], ["pon", {
    oltId: "olt-1", coordinate: { chassis: "1", board: "7", pon: "8" }
  }]);
});

test("PON sort callback reuses the existing bounded status detail", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_pon_by_address", value: "地址" }),
    send: async (_chatId, reply) => replies.push(reply),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const detail = await app.handleMessage({ eventId: "evt-pon-sort", openId: "ou-1", chatId: "oc-direct", text: "查地址" });
  const sorted = await app.handleCallback({
    eventId: "callback-pon-sort", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: detail.sorting.token,
      index: 0,
      action: "pon-sort-onu",
      expiresAt: detail.sorting.expiresAt
    }
  });

  assert.equal(sorted.kind, "pon-detail");
  assert.equal(sorted.sorting.current, "onu");
  assert.equal(dataGateway.calls.length, 1);
  assert.equal(replies.at(-1).sorting.current, "onu");
  assert.equal(stateStore.value().auditArchive.at(-1).queryType, "sort_pon_statuses");
});

test("PON sort callback rejects when the OLT is no longer enabled", async () => {
  const stateStore = directStore();
  let enabled = true;
  const dataGateway = {
    ...detailGateway(),
    async listOlts() {
      return [
        { oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled },
        { oltId: "olt-2", name: "OLT 2", vendor: "zte", model: "C300", enabled: true }
      ];
    }
  };
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_pon_by_address", value: "地址" }),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const detail = await app.handleMessage({ eventId: "evt-pon-sort-disabled", openId: "ou-1", chatId: "oc-direct", text: "查地址" });
  enabled = false;
  const sorted = await app.handleCallback({
    eventId: "callback-pon-sort-disabled", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: {
      token: detail.sorting.token,
      index: 0,
      action: "pon-sort-onu",
      expiresAt: detail.sorting.expiresAt
    }
  });

  assert.equal(sorted.kind, "denied");
  assert.match(sorted.message, /当前启用的 OLT/);
  assert.equal(dataGateway.calls.length, 1);
});

test("candidate callback rejects tampering, cross-chat use, expiry and duplicate candidate use", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway({ userCount: 2 });
  let current = "2026-08-05T00:00:00.000Z";
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => current
  });
  const candidates = await app.handleMessage({ eventId: "evt-candidate-2", openId: "ou-1", chatId: "oc-direct", text: "查用户" });
  const tampered = await app.handleCallback({
    eventId: "callback-tampered", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: { token: `${candidates.selection.token}x`, index: 0 }
  });
  assert.equal(tampered.kind, "invalid-callback");
  const crossChat = await app.handleCallback({
    eventId: "callback-cross-chat", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-other",
    binding: { token: candidates.selection.token, index: 0 }
  });
  assert.equal(crossChat.kind, "denied");
  current = "2026-08-05T00:05:01.000Z";
  const expired = await app.handleCallback({
    eventId: "callback-expired", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct",
    binding: { token: candidates.selection.token, index: 0 }
  });
  assert.equal(expired.kind, "expired-callback");

  current = "2026-08-05T00:00:00.000Z";
  const fresh = await app.handleMessage({ eventId: "evt-candidate-3", openId: "ou-1", chatId: "oc-direct", text: "查用户" });
  const used = await app.handleCallback({
    eventId: "callback-used-1", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct", binding: { token: fresh.selection.token, index: 0 }
  });
  assert.equal(used.kind, "onu-detail");
  current = "2026-08-05T00:01:01.000Z";
  const otherCandidate = await app.handleCallback({
    eventId: "callback-used-2-other", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct", binding: { token: fresh.selection.token, index: 1 }
  });
  assert.equal(otherCandidate.kind, "onu-detail");
  assert.equal(dataGateway.calls.at(-1)[1].coordinate.onuId, "2");
  const duplicate = await app.handleCallback({
    eventId: "callback-used-3", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct", binding: { token: fresh.selection.token, index: 0 }
  });
  assert.equal(duplicate.kind, "duplicate-callback");
});

test("village PON summary sends progress immediately and reads every page", async () => {
  const stateStore = store();
  const calls = [];
  const sent = [];
  let resolveSummary;
  const summaryDone = new Promise((resolve) => { resolveSummary = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dataGateway = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async queryVillagePons(request) {
      calls.push(["page", request]);
      const count = request.offset === 0 ? 5 : 1;
      return {
        total: 6, authorizedCount: 6, offset: request.offset, limit: 5,
        hasMore: request.offset === 0,
        candidates: Array.from({ length: count }, (_, index) => ({ candidateId: `pon-${request.offset + index}`,
          oltId: "olt-1", oltName: "OLT 1", address: "一级地址",
          pon: { chassis: "1", board: "2", pon: String(request.offset + index + 1) } }))
      };
    },
    async sampleVillagePonOnlineUser(request) {
      calls.push(["sample", request]);
      if (calls.filter(([kind]) => kind === "sample").length === 1) await gate;
      return { candidate: { candidateId: "user-1", oltId: "olt-1", name: "村用户",
        phone: "", address: "示例村一巷", loid: "", mac: "",
        onu: { chassis: "1", board: "2", pon: request.pon.pon, onuId: "1" } },
        liveStatus: { oltId: "olt-1", onu: { chassis: "1", board: "2", pon: request.pon.pon, onuId: "1" },
          status: { phase: "online", rxPower: "-20 dBm", distance: "unknown", serial: "unknown", name: "" },
          observedAt: "2026-08-05T00:00:00.000Z" } };
    },
    async readOnuHistoricalOptical() {
      return { source: "oss-ngb", rows: [
        { reportTime: "2026-08-05T00:00:00.000Z", rxOptical: -99, txOptical: null, oltRxOptical: null, lightDecay: null },
        { reportTime: "2026-08-04T00:00:00.000Z", rxOptical: -20.5, txOptical: null, oltRxOptical: null, lightDecay: null },
        { reportTime: "invalid", rxOptical: -10, txOptical: null, oltRxOptical: null, lightDecay: null },
        { reportTime: "2026-08-03T00:00:00.000Z", rxOptical: "unknown(65535)", txOptical: null, oltRxOptical: null, lightDecay: null }
      ] };
    }
  };
  const app = createFeishuQueryApplication({
    stateStore, gateway: dataGateway, interpret: async () => { throw new Error("local village recognition expected"); },
    now: () => nowAt, send: async (_chatId, reply) => { sent.push(reply); if (reply.kind === "village-pon-summary") resolveSummary(reply); }
  });
  const nowAt = "2026-08-05T00:00:00.000Z";
  const first = await app.handleMessage({ eventId: "village-1", openId: "ou-1", chatId: "oc-1", text: "查查示例村所有 PON 口" });
  assert.equal(first.kind, "village-pon-summary-loading");
  assert.equal(sent[0].kind, "village-pon-summary-loading");
  assert.equal(calls.filter(([kind]) => kind === "sample").length, 5);
  release();
  const summary = await summaryDone;
  assert.equal(summary.normal, true);
  assert.equal(summary.message, "🎉 恭喜你，所有 PON 都正常！");
  assert.deepEqual(calls.filter(([kind]) => kind === "page").map(([, request]) => request.offset), [0, 5]);
  assert.equal(calls.filter(([kind]) => kind === "sample").length, 6);
});

test("village PON summary applies strict raw RX thresholds and rejects cross-page duplicates", async () => {
  async function runSummary({ current, historical, duplicate = false }) {
    const finalReply = new Promise((resolve) => {
      const dataGateway = {
        async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
        async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
        async queryPons() { return { authorizedCount: 0, candidates: [] }; },
        async queryVillagePons(request) {
          const count = duplicate ? (request.offset === 0 ? 5 : 1) : 1;
          return {
            total: duplicate ? 6 : 1, authorizedCount: duplicate ? 6 : 1,
            offset: request.offset, limit: 5, hasMore: duplicate ? request.offset === 0 : false,
            candidates: Array.from({ length: count }, (_, index) => ({
              candidateId: duplicate ? (request.offset === 0 ? `dup-${index}` : "dup-0") : "threshold-1",
              oltId: "olt-1", oltName: "OLT 1", address: "一级地址",
              pon: { chassis: "1", board: "2", pon: String(request.offset + index + 1) }
            }))
          };
        },
        async sampleVillagePonOnlineUser(request) {
          if (duplicate) return { candidate: null, liveStatus: null };
          return {
            candidate: { candidateId: "user-1", oltId: "olt-1", name: "村用户", phone: "", address: "示例村", loid: "", mac: "",
              onu: { chassis: "1", board: "2", pon: request.pon.pon, onuId: "1" } },
            liveStatus: { oltId: "olt-1", onu: { chassis: "1", board: "2", pon: request.pon.pon, onuId: "1" },
              status: { phase: "online", rxPower: String(current) }, observedAt: "2026-08-05T00:00:00.000Z" }
          };
        },
        async readOnuHistoricalOptical() {
          return { source: "oss-ngb", rows: [{ reportTime: "2026-08-04T00:00:00.000Z", rxOptical: historical }] };
        }
      };
      const app = createFeishuQueryApplication({
        stateStore: store(), gateway: dataGateway,
        interpret: async () => { throw new Error("local village recognition expected"); },
        now: () => "2026-08-05T00:00:00.000Z",
        send: async (_chatId, reply) => { if (["village-pon-summary", "village-pon-summary-failed"].includes(reply.kind)) resolve(reply); }
      });
      void app.handleMessage({ eventId: `threshold-${current}-${historical}-${duplicate}`, openId: "ou-1", chatId: "oc-1", text: "查查示例村所有 PON 口" });
    });
    return finalReply;
  }

  const almostNormal = await runSummary({ current: -20, historical: -20.999 });
  assert.equal(almostNormal.kind, "village-pon-summary");
  assert.equal(almostNormal.normal, true);
  const plusOne = await runSummary({ current: -20, historical: -21 });
  assert.equal(plusOne.findings[0].classification, "abnormal");
  const minusOne = await runSummary({ current: -20, historical: -19 });
  assert.equal(minusOne.findings[0].classification, "abnormal");
  const duplicate = await runSummary({ duplicate: true });
  assert.equal(duplicate.kind, "village-pon-summary-failed");
});

test("village PON query reports an explicit no-match result", async () => {
  const dataGateway = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async queryVillagePons() { return { total: 0, authorizedCount: 0, offset: 0, limit: 5, hasMore: false, candidates: [] }; }
  };
  const app = createFeishuQueryApplication({ stateStore: store(), gateway: dataGateway, interpret: async () => { throw new Error(); } });
  const reply = await app.handleMessage({ eventId: "village-empty", openId: "ou-1", chatId: "oc-1", text: "查查不存在村所有 PON 口" });
  assert.equal(reply.kind, "village-pon-empty");
  assert.match(reply.message, /未找到含不存在村用户的 PON/);
});

test("village PON page isolates one sampling failure while completing other PONs", async () => {
  const sent = [];
  const gateway = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async queryVillagePons(request) {
      return { total: 2, authorizedCount: 2, offset: request.offset, hasMore: false, candidates: [
        { candidateId: "pon-ok", oltId: "olt-1", pon: { chassis: "1", board: "2", pon: "1" } },
        { candidateId: "pon-fail", oltId: "olt-1", pon: { chassis: "1", board: "2", pon: "2" } }
      ] };
    },
    async sampleVillagePonOnlineUser({ pon }) {
      if (pon.pon === "2") throw new Error("one PON failed");
      return { candidate: { candidateId: "user-1", oltId: "olt-1", name: "村用户",
        onu: { chassis: "1", board: "2", pon: "1", onuId: "1" } }, liveStatus: {
        observedAt: "2026-08-05T00:00:00.000Z", status: { rxPower: "-20 dBm" }
      } };
    },
    async readOnuHistory() { return { source: "local", rows: [{ sampledAt: "2026-08-04T00:00:00Z", rxPower: "-21 dBm" }] }; }
  };
  const app = createFeishuQueryApplication({
    stateStore: store(), gateway,
    interpret: async () => { throw new Error("local village recognition expected"); },
    send: async (_chatId, reply) => { sent.push(reply); }
  });
  const loading = await app.handleMessage({ eventId: "village-isolated-failure", openId: "ou-1", chatId: "oc-1",
    text: "查查示例村所有 PON 口" });
  assert.equal(loading.kind, "village-pon-summary-loading");
  await new Promise((resolve) => setImmediate(resolve));
  const result = sent.find((reply) => reply.kind === "village-pon-summary");
  assert.ok(result);
  assert.equal(sent[0].kind, "village-pon-summary-loading");
  assert.equal(result.abnormalCount, 1);
  assert.equal(result.incompleteCount, 1);
  assert.equal(result.findings[0].sampling.status, "complete");
  assert.equal(result.findings[1].sampling.status, "failed");
  assert.match(result.findings[1].sampling.message, /读取失败/);
});

test("village sample reports no-online clearly and falls back from remote to local history", async () => {
  let enabled = true;
  const base = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled }]; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async queryVillagePons(request) { return { total: 1, authorizedCount: 1, offset: request.offset, limit: 5, hasMore: false,
      candidates: [{ candidateId: "pon-1", oltId: "olt-1", oltName: "OLT 1", address: "一级", pon: { chassis: "1", board: "2", pon: "3" } }] }; }
  };
  const onlineGateway = {
    ...base,
    async sampleVillagePonOnlineUser() { return { candidate: { candidateId: "u-1", oltId: "olt-1", name: "村户", phone: "", address: "示例村", loid: "", mac: "", onu: { chassis: "1", board: "2", pon: "3", onuId: "1" } }, liveStatus: { observedAt: "2026-08-05T00:00:00.000Z", status: { rxPower: "-20 dBm" } } }; },
    async readOnuHistoricalOptical() { throw new Error("remote unavailable"); },
    async readOnuHistory() { return { source: "local", rows: [{ sampledAt: "2026-08-04T00:00:00Z", rxPower: "-21 dBm" }] }; }
  };
  const sent = [];
  const app = createFeishuQueryApplication({ stateStore: store(), gateway: onlineGateway, interpret: async () => { throw new Error(); },
    send: async (_chatId, reply) => { sent.push(reply); } });
  const loading = await app.handleMessage({ eventId: "village-fallback", openId: "ou-1", chatId: "oc-1", text: "查查示例村所有 PON 口" });
  assert.equal(loading.kind, "village-pon-summary-loading");
  await new Promise((resolve) => setImmediate(resolve));
  const result = sent.find((reply) => reply.kind === "village-pon-summary");
  assert.equal(result.findings[0].sampling.comparison.source, "local");
  assert.equal(result.findings[0].sampling.comparison.historical, -21);

  const emptySent = [];
  const noOnlineApp = createFeishuQueryApplication({ stateStore: store(), gateway: {
    ...base,
    async sampleVillagePonOnlineUser() { return { candidate: null, liveStatus: null }; }
  }, interpret: async () => { throw new Error(); }, send: async (_chatId, reply) => { emptySent.push(reply); } });
  const emptyPage = await noOnlineApp.handleMessage({ eventId: "village-no-online", openId: "ou-1", chatId: "oc-1", text: "查查示例村所有 PON 口" });
  assert.equal(emptyPage.kind, "village-pon-summary-loading");
  await new Promise((resolve) => setImmediate(resolve));
  const empty = emptySent.find((reply) => reply.kind === "village-pon-summary");
  assert.match(empty.findings[0].sampling.message, /没有可抽样的在线/);
  enabled = false;
});
