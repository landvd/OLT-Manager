import test from "node:test";
import assert from "node:assert/strict";
import {
  FEISHU_STATE_FORMAT,
  emptyFeishuState,
  normalizeFeishuState
} from "../src/feishu/state.mjs";

test("Feishu state is independent from the OLT Manager user snapshot", () => {
  const state = emptyFeishuState();
  assert.equal(state.format, FEISHU_STATE_FORMAT);
  assert.equal(state.enabled, false);
  assert.deepEqual(state.operators, []);
  assert.equal("snapshot" in state, false);
  assert.equal("users" in state, false);
});

test("Feishu state keeps credential references but rejects secrets and snapshots", () => {
  const normalized = normalizeFeishuState({
    ...emptyFeishuState(),
    app: { appId: "cli_test", credentialReference: "keychain:feishu:1" },
    operators: [{ openId: "ou_test", oltIds: ["olt-1", "olt-1"] }],
    authorizedChats: [{ chatId: "oc_test", type: "group" }]
  });
  assert.deepEqual(normalized.operators[0].oltIds, ["olt-1"]);
  assert.equal(normalized.app.credentialReference, "keychain:feishu:1");
  assert.throws(() => normalizeFeishuState({
    ...emptyFeishuState(),
    appSecret: "should-not-be-stored"
  }), /not allowed/);
  assert.throws(() => normalizeFeishuState({
    ...emptyFeishuState(),
    userSnapshot: { records: [] }
  }), /not allowed/);
});
