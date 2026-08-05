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
        address: "地址", primaryAddress: "一级地址", loid: "", mac: "", serialNumber: "SN-1",
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

test("candidate callback rejects tampering, cross-chat use, expiry and duplicate use", async () => {
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
  const duplicate = await app.handleCallback({
    eventId: "callback-used-2", kind: "callback", verifiedByTransport: true,
    openId: "ou-1", chatId: "oc-direct", binding: { token: fresh.selection.token, index: 0 }
  });
  assert.equal(duplicate.kind, "duplicate-callback");
});
