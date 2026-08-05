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
    interpret: async () => { interpretationCalls += 1; return null; }
  });
  const result = await app.handleMessage({ eventId: "evt-2", openId: "ou-1", chatId: "oc-other", text: "查用户" });
  assert.equal(result.kind, "denied");
  assert.equal(interpretationCalls, 0);
});
