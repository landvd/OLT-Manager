import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFeishuProductionRuntime, normalizeCallback, normalizeMessage, renderReply } = require("../src/feishu/production-runtime.cjs");

test("production runtime normalizes only verified text events", () => {
  const event = normalizeMessage({
    event_id: "evt-1",
    sender: { sender_id: { open_id: "ou-1" } },
    message: {
      chat_id: "oc-1", chat_type: "group", message_type: "text",
      content: JSON.stringify({ text: "@bot 查询" }),
      mentions: [{ key: "@bot" }]
    }
  }, true);
  assert.deepEqual(event, {
    eventId: "evt-1", kind: "group", openId: "ou-1", chatId: "oc-1", text: "查询", mentioned: true
  });
});

test("production runtime renders replies without leaking credentials", () => {
  const result = renderReply({ kind: "candidate-set", candidates: [{
    name: "用户", onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }
  }] });
  assert.equal(result.msgType, "text");
  assert.match(result.content.text, /用户/);
  assert.doesNotMatch(JSON.stringify(result), /secret|token|community/i);
});

test("production runtime renders bounded interactive candidate cards with opaque callback bindings", () => {
  const result = renderReply({
    kind: "candidate-set", selection: { token: "opaque-binding", expiresAt: "2026-08-05T00:05:00.000Z" },
    candidates: [{ candidateId: "c-1", name: "用户", oltId: "olt-1", onu: { chassis: "1", board: "7", pon: "8", onuId: "1" } }]
  });
  assert.equal(result.msgType, "interactive");
  const card = JSON.parse(result.content);
  const button = card.elements.find((element) => element.tag === "action").actions[0];
  assert.equal(button.tag, "button");
  assert.deepEqual(button.value, {
    token: "opaque-binding", index: 0, expiresAt: "2026-08-05T00:05:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(card), /olt-1|secret|community/i);
});

test("production runtime normalizes trusted callbacks and rejects missing transport identity", () => {
  const normalized = normalizeCallback({
    event_id: "cb-1", operator: { open_id: "ou-1" },
    open_chat_id: "oc-1", action: { value: JSON.stringify({ token: "opaque", index: 0 }) }
  });
  assert.deepEqual(normalized, {
    eventId: "cb-1", kind: "callback", openId: "ou-1", chatId: "oc-1",
    binding: { token: "opaque", index: 0 }, messageId: null
  });
  assert.throws(() => normalizeCallback({ event_id: "cb-2", action: { value: "{}" } }), /invalid Feishu callback/);
});

test("production runtime dispatches verified SDK messages and callbacks into the application", async () => {
  const handlers = {};
  class EventDispatcher {
    register(next) { Object.assign(handlers, next); return this; }
  }
  class Client {
    constructor() {}
  }
  class WSClient {
    constructor() {}
    async start() {}
    close() {}
    getConnectionStatus() { return "connected"; }
  }
  const received = [];
  const runtime = createFeishuProductionRuntime({
    sdk: { Client, WSClient, EventDispatcher, LoggerLevel: { error: "error" } },
    readSecret: async () => "secret",
    botOpenId: "ou-bot",
    application: {
      async handleMessage(event) { received.push(["message", event]); },
      async handleCallback(event) { received.push(["callback", event]); }
    }
  });
  await runtime.start({ appId: "cli_0123456789abcdef", credentialReference: "keychain:feishu" });
  await handlers["im.message.receive_v1"]({
    event_id: "evt-runtime", sender: { sender_id: { open_id: "ou-1" } },
    message: {
      chat_id: "oc-1", chat_type: "p2p", message_type: "text",
      content: JSON.stringify({ text: "查询" }), mentions: []
    }
  });
  await handlers["card.action.trigger"]({
    event_id: "cb-runtime", operator: { open_id: "ou-1" }, open_chat_id: "oc-1",
    action: { value: JSON.stringify({ token: "opaque", index: 0, expiresAt: "2026-08-05T00:05:00.000Z" }) }
  });
  assert.equal(received[0][0], "message");
  assert.equal(received[0][1].verifiedByTransport, true);
  assert.equal(received[1][0], "callback");
  assert.equal(received[1][1].verifiedByTransport, true);
  assert.equal(received[1][1].binding.token, "opaque");
  assert.equal(received[1][1].binding.expiresAt, "2026-08-05T00:05:00.000Z");
});
