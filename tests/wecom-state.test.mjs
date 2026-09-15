import test from "node:test";
import assert from "node:assert/strict";
import {
  WECOM_STATE_FORMAT,
  emptyWecomState,
  normalizeWecomState
} from "../src/wecom/state.mjs";

test("WeCom state is independent from the OLT Manager user snapshot", () => {
  const state = emptyWecomState();
  assert.equal(state.format, WECOM_STATE_FORMAT);
  assert.equal(state.enabled, false);
  assert.equal(state.welcomeEnabled, true);
  assert.equal("snapshot" in state, false);
  assert.equal("users" in state, false);
});

test("WeCom state keeps credential references but rejects secrets and snapshots", () => {
  const normalized = normalizeWecomState({
    ...emptyWecomState(),
    bot: { botId: "bot_12345", credentialReference: "keychain:wecom:1" },
    welcomeEnabled: false
  });
  assert.equal(normalized.bot.botId, "bot_12345");
  assert.equal(normalized.bot.credentialReference, "keychain:wecom:1");
  assert.equal(normalized.welcomeEnabled, false);
  assert.throws(() => normalizeWecomState({
    ...emptyWecomState(),
    secret: "should-not-be-stored"
  }), /not allowed/);
  assert.throws(() => normalizeWecomState({
    ...emptyWecomState(),
    botSecret: "should-not-be-stored"
  }), /not allowed/);
  assert.throws(() => normalizeWecomState({
    ...emptyWecomState(),
    userSnapshot: { records: [] }
  }), /not allowed/);
});
