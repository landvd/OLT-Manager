import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeMessage, renderReply } = require("../src/feishu/production-runtime.cjs");

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
