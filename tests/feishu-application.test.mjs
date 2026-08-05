import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

function store() {
  let value = {
    ...emptyFeishuState(), enabled: true,
    operators: [{ openId: "ou-1", oltIds: ["olt-1", "olt-2"] }, { openId: "ou-2", oltIds: ["olt-2"] }],
    authorizedChats: [{ chatId: "oc-group", type: "group" }]
  };
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

function gateway() {
  return {
    async listOlts() { return [
      { oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true },
      { oltId: "olt-2", name: "OLT 2", vendor: "zte", model: "C300", enabled: true }
    ]; },
    async queryUsers(request) { return { authorizedCount: 1, candidates: [{
      candidateId: "olt-2:1/7/8:1", oltId: request.oltIds[0], name: "用户", phone: "",
      address: "地址", loid: "", mac: "", onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, snapshotAt: null
    }] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; }
  };
}

function detailGateway() {
  const calls = [];
  return {
    calls,
    async listOlts() {
      return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }];
    },
    async queryUsers() {
      return { authorizedCount: 1, candidates: [{
        candidateId: "olt-1:1/7/8:1", oltId: "olt-1", name: "用户", phone: "",
        address: "地址", loid: "", mac: "", serialNumber: "SN-1",
        onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, snapshotAt: null
      }] };
    },
    async queryPons() {
      return { authorizedCount: 1, candidates: [{
        candidateId: "olt-1:pon:1/7/8", oltId: "olt-1", oltName: "OLT 1", address: "地址",
        pon: { chassis: "1", board: "7", pon: "8" }
      }] };
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

test("Feishu application recalculates group scope before querying", async () => {
  const stateStore = store();
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore, gateway: gateway(),
    readGroupMembers: async () => ["ou-1", "ou-2"],
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    send: async (_chatId, reply) => replies.push(reply),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-1", openId: "ou-1", chatId: "oc-group", text: "查用户" });
  assert.equal(result.kind, "candidate-set");
  assert.deepEqual(replies[0].candidates[0].oltId, "olt-2");
  assert.equal(stateStore.value().auditArchive.at(-1).decision, "allowed");
});

test("Feishu application denies before interpretation when the chat is not authorized", async () => {
  const stateStore = store();
  let interpretationCalls = 0;
  const app = createFeishuQueryApplication({
    stateStore, gateway: gateway(),
    interpret: async () => { interpretationCalls += 1; return null; },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const result = await app.handleMessage({ eventId: "evt-2", openId: "ou-1", chatId: "oc-other", text: "查用户" });
  assert.equal(result.kind, "denied");
  assert.equal(interpretationCalls, 0);
});

test("unauthorized direct messages create one pending access request without interpreting text", async () => {
  const stateStore = store();
  let interpretationCalls = 0;
  const app = createFeishuQueryApplication({
    stateStore, gateway: gateway(),
    interpret: async () => { interpretationCalls += 1; return null; },
    now: () => "2026-08-05T00:00:00.000Z"
  });
  const event = { eventId: "evt-request-1", kind: "direct", openId: "ou-requester", chatId: "oc-request", text: "查询" };
  assert.equal((await app.handleMessage(event)).kind, "denied");
  assert.equal((await app.handleMessage({ ...event, eventId: "evt-request-2" })).kind, "denied");
  assert.equal(interpretationCalls, 0);
  assert.deepEqual(stateStore.value().accessRequests, [{
    requestId: "access:ou-requester:oc-request", openId: "ou-requester", chatId: "oc-request",
    requestedAt: "2026-08-05T00:00:00.000Z", status: "pending"
  }]);
});

test("candidate binding opens a read-only ONU detail after callback reauthorization", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
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
  const dataGateway = detailGateway();
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

test("candidate callback rejects tampering, cross-chat use, expiry and duplicate use", async () => {
  const stateStore = directStore();
  const dataGateway = detailGateway();
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
