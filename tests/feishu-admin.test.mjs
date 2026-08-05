import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuAdminService } from "../src/feishu/admin.mjs";
import { emptyFeishuState, normalizeFeishuState } from "../src/feishu/state.mjs";

function store(initial = emptyFeishuState()) {
  let value = structuredClone(initial);
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

function gateway() {
  return { async listOlts() {
    return [
      { oltId: "olt-1", name: "OLT 1", enabled: true },
      { oltId: "olt-2", name: "OLT 2", enabled: false }
    ];
  } };
}

test("Feishu admin CRUD persists operators/chats in encrypted state shape and audits changes", async () => {
  const stateStore = store();
  const admin = createFeishuAdminService({
    stateStore, gateway: gateway(), now: () => "2026-08-05T00:00:00.000Z"
  });
  const afterOperator = await admin.saveOperator({ openId: "ou-1", remark: "值班", oltIds: ["olt-1"] });
  assert.deepEqual(afterOperator.operators[0], {
    openId: "ou-1", remark: "值班", oltIds: ["olt-1"], enabled: true
  });
  await admin.saveAuthorizedChat({ chatId: "oc-1", type: "group", remark: "运维群" });
  await admin.setOperatorEnabled({ openId: "ou-1", enabled: false });
  await admin.setAuthorizedChatEnabled({ chatId: "oc-1", enabled: false });
  const result = await admin.read();
  assert.equal(result.operators[0].enabled, false);
  assert.equal(result.authorizedChats[0].enabled, false);
  assert.equal(result.auditArchive.at(-1).eventType, "admin");
  assert.equal(stateStore.value().appSecret, undefined);
});

test("Feishu admin rejects unknown OLT scope and supports access request approval/rejection", async () => {
  const stateStore = store({
    ...emptyFeishuState(),
    accessRequests: [{
      requestId: "req-1", openId: "ou-2", chatId: "oc-2",
      requestedAt: "2026-08-05T00:00:00.000Z", status: "pending"
    }]
  });
  const admin = createFeishuAdminService({ stateStore, gateway: gateway() });
  await assert.rejects(
    () => admin.saveOperator({ openId: "ou-1", oltIds: ["olt-unknown"] }),
    /unknown OLT/
  );
  const approved = await admin.approveAccessRequest({ requestId: "req-1", oltIds: ["olt-1"] });
  assert.equal(approved.accessRequests[0].status, "approved");
  assert.deepEqual(approved.operators[0].oltIds, ["olt-1"]);
  assert.equal(approved.authorizedChats[0].chatId, "oc-2");

  const stateStore2 = store({
    ...emptyFeishuState(),
    accessRequests: [{
      requestId: "req-2", openId: "ou-3", chatId: "oc-3",
      requestedAt: "2026-08-05T00:00:00.000Z", status: "pending"
    }]
  });
  const admin2 = createFeishuAdminService({ stateStore: stateStore2, gateway: gateway() });
  const rejected = await admin2.rejectAccessRequest("req-2");
  assert.equal(rejected.accessRequests[0].status, "rejected");
});

test("disabled operator and chat lose permission immediately", async () => {
  const state = normalizeFeishuState({
    ...emptyFeishuState(), enabled: true,
    operators: [{ openId: "ou-1", oltIds: ["olt-1"], enabled: false }],
    authorizedChats: [{ chatId: "oc-1", type: "direct", enabled: false }]
  });
  assert.equal(state.operators[0].enabled, false);
  assert.equal(state.authorizedChats[0].enabled, false);
});
