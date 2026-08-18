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
    open_chat_id: "oc-1", action: { value: JSON.stringify({ token: "opaque", index: 0, action: "pon-sort-onu" }) }
  });
  assert.deepEqual(normalized, {
    eventId: "cb-1", kind: "callback", openId: "ou-1", chatId: "oc-1",
    binding: { token: "opaque", index: 0, action: "pon-sort-onu" }, messageId: null
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

test("production runtime marks onMessage seam events as transport verified", async () => {
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
    onMessage: async (payload) => received.push(payload)
  });
  await runtime.start({ appId: "cli_0123456789abcdef", credentialReference: "keychain:feishu" });
  await handlers["im.message.receive_v1"]({
    event_id: "evt-on-message", sender: { sender_id: { open_id: "ou-1" } },
    message: {
      chat_id: "oc-1", chat_type: "p2p", message_type: "text",
      content: JSON.stringify({ text: "王柏权" }), mentions: []
    }
  });
  await handlers["card.action.trigger"]({
    event_id: "cb-on-message", operator: { open_id: "ou-1" }, open_chat_id: "oc-1",
    action: { value: JSON.stringify({ token: "opaque", index: 0 }) }
  });
  assert.equal(received[0].event.verifiedByTransport, true);
  assert.equal(received[1].event.verifiedByTransport, true);
});

test("production runtime sends interactive cards as a single JSON content string", async () => {
  let sent;
  class EventDispatcher {
    register() { return this; }
  }
  class Client {
    constructor() {
      this.im = {
        message: {
          create: async (request) => {
            sent = request;
            return { data: { message_id: "mid-1" } };
          }
        }
      };
    }
  }
  class WSClient {
    constructor() {}
    async start() {}
    close() {}
    getConnectionStatus() { return "connected"; }
  }
  const runtime = createFeishuProductionRuntime({
    sdk: { Client, WSClient, EventDispatcher, LoggerLevel: { error: "error" } },
    readSecret: async () => "secret",
    botOpenId: "ou-bot"
  });
  await runtime.start({ appId: "cli_0123456789abcdef", credentialReference: "keychain:feishu" });
  await runtime.sendReply("oc-1", {
    kind: "candidate-set",
    authorizedCount: 1,
    selection: { token: "opaque-binding", expiresAt: "2026-08-05T00:05:00.000Z" },
    candidates: [{ candidateId: "c-1", name: "王柏权", oltId: "olt-1", onu: { chassis: "1", board: "7", pon: "8", onuId: "1" } }]
  });
  assert.equal(sent.data.msg_type, "interactive");
  assert.equal(typeof sent.data.content, "string");
  const card = JSON.parse(sent.data.content);
  assert.equal(card.header.title.content, "请选择匹配项");
  const cardText = card.elements.map((element) => element.text?.content || "").join("\n");
  assert.match(cardText, /王柏权/);
  assert.match(cardText, /ONU 1\/7\/8:1/);
  assert.doesNotThrow(() => card.elements.find((element) => element.tag === "action"));
});

test("production runtime paginates candidate cards and carries absolute indexes", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    candidateId: `c-${index + 1}`,
    name: `用户${index + 1}`,
    oltId: "olt-1",
    onu: { chassis: "1", board: "7", pon: "8", onuId: String(index + 1) }
  }));
  const result = renderReply({
    kind: "candidate-set",
    authorizedCount: 12,
    page: 2,
    pageSize: 5,
    selection: { token: "opaque-binding", expiresAt: "2026-08-05T00:05:00.000Z" },
    candidates
  });
  const card = JSON.parse(result.content);
  const candidateText = card.elements
    .filter((element) => element.tag === "div")
    .map((element) => element.text?.content || "")
    .join("\n");
  assert.match(candidateText, /用户6/);
  assert.match(candidateText, /用户10/);
  assert.doesNotMatch(candidateText, /用户5\n|用户11\n/);
  const navigation = card.elements
    .filter((element) => element.tag === "action")
    .at(-1);
  assert.deepEqual(navigation.actions.map((action) => action.value), [
    {
      token: "opaque-binding", index: 0, action: "candidate-page", page: 1,
      expiresAt: "2026-08-05T00:05:00.000Z"
    },
    {
      token: "opaque-binding", index: 0, action: "candidate-page", page: 3,
      expiresAt: "2026-08-05T00:05:00.000Z"
    }
  ]);
  const candidateAction = card.elements
    .filter((element) => element.tag === "action")
    .find((element) => element.actions[0]?.text?.content === "查看 ONU 详情");
  assert.equal(candidateAction.actions[0].value.index, 5);
});

test("production runtime renders ONU details as a rich Feishu card", () => {
  const result = renderReply({
    kind: "onu-detail",
    candidate: {
      name: "王柏权",
      phone: "13800000000",
      address: "山仔村一巷 1 号",
      primaryAddress: "合成山仔村一区",
      oltName: "OLT 104.98",
      oltIp: "192.0.2.10",
      loid: "LOID-1",
      mac: "00:11:22:33:44:55",
      onu: { chassis: "1", board: "7", pon: "8", onuId: "1" },
      snapshotAt: "2026-08-05T00:00:00.000Z"
    },
    detail: {
      onu: { chassis: "1", board: "7", pon: "8", onuId: "1" },
      status: { phase: "working", rxPower: "-20 dBm", distance: "1 km", serial: "SN-1", name: "王柏权" },
      detail: {
        interface: "gpon-onu_1/7/8:1",
        name: "王柏权",
        phaseState: "working",
        serialNumber: "SN-1",
        opticalRxPower: "-20 dBm",
        distance: "1 km",
        lastOnlineTime: "2026-08-05 00:00:00",
        lastOfflineTime: null,
        lastOfflineCause: null,
        lastOfflineCauseCode: null
      }
    },
    primaryAddressQuery: {
      token: "primary-address-token",
      expiresAt: "2026-08-05T00:05:00.000Z"
    },
    copyLoidQuery: {
      token: "copy-loid-token",
      expiresAt: "2026-08-05T00:05:00.000Z"
    },
    historyQuery: {
      token: "history-token",
      expiresAt: "2026-08-05T00:05:00.000Z"
    }
  });
  assert.equal(result.msgType, "interactive");
  assert.equal(result.content.header.title.content, "ONU 设备详情");
  assert.equal(result.content.header.template, "green");
  const serialized = JSON.stringify(result.content);
  assert.match(serialized, /用户与位置/);
  assert.match(serialized, /王柏权/);
  assert.match(serialized, /装机地址/);
  assert.match(serialized, /山仔村一巷 1 号/);
  assert.match(serialized, /一级地址/);
  assert.match(serialized, /合成山仔村一区/);
  assert.match(serialized, /ONU 技术状态/);
  assert.match(serialized, /SN-1/);
  assert.match(serialized, /快照：2026-08-05 08:00:00/);
  assert.match(serialized, /复制 LOID/);
  assert.match(serialized, /一级地址光功率查询/);
  assert.match(serialized, /ONU 历史光功率/);
  const actionLabels = result.content.elements
    .filter((element) => element.tag === "action")
    .map((element) => element.actions[0]?.text?.content);
  assert.ok(actionLabels.indexOf("复制 LOID") < actionLabels.indexOf("一级地址光功率查询"));
  const copyAction = result.content.elements
    .find((element) => element.actions?.[0]?.text?.content === "复制 LOID")?.actions[0];
  assert.deepEqual(copyAction.value, {
    token: "copy-loid-token", index: 0, action: "onu-copy-loid", expiresAt: "2026-08-05T00:05:00.000Z"
  });
  assert.ok(result.content.elements.at(-1).tag === "action");
  assert.doesNotMatch(serialized, /接口/);
  assert.doesNotMatch(serialized, /192\.0\.2\.10\/1\/7\/8:1/);
  assert.doesNotMatch(serialized, /secret|community/i);
});

test("production runtime renders LOID copy text and bounded local ONU history", () => {
  const copied = renderReply({ kind: "onu-loid-copy", message: "LOID-SYNTH" });
  assert.equal(copied.msgType, "text");
  assert.deepEqual(copied.content, { text: "LOID-SYNTH" });

  const history = renderReply({
    kind: "onu-history",
    candidate: { name: "王柏权", oltName: "OLT 104.98", onu: { chassis: "1", board: "7", pon: "8", onuId: "1" } },
    history: {
      days: 7,
      rows: [{ sampledAt: "2026-08-04T00:00:00.000Z", phase: "online", rxPower: "-21 dBm", distance: "1 km" }]
    }
  });
  const serialized = JSON.stringify(history.content);
  assert.equal(history.msgType, "interactive");
  assert.match(serialized, /本地历史记录，不触发刷新/);
  assert.match(serialized, /2026-08-04 08:00:00/);
  assert.match(serialized, /在线/);
  assert.match(serialized, /-21 dBm/);
  assert.match(serialized, /1 km/);

  const empty = renderReply({
    kind: "onu-history", candidate: {}, history: { days: 7, rows: [] }
  });
  assert.match(JSON.stringify(empty.content), /最近 7 天没有本地历史光功率记录/);
});

test("production runtime renders PON status as a bounded dashboard card", () => {
  const result = renderReply({
    kind: "pon-detail",
    candidate: {
      address: "山仔村光交箱",
      oltName: "OLT 104.98",
      pon: { chassis: "1", board: "7", pon: "8" }
    },
    sorting: { token: "pon-sort-token", expiresAt: "2026-08-05T00:05:00.000Z", current: "power" },
    detail: {
      pon: { chassis: "1", board: "7", pon: "8" },
      onuCount: 3,
      onus: [
        { onu: { onuId: "1" }, name: "王柏权", phase: "online", rxPower: "-20 dBm" },
        { onu: { onuId: "2" }, name: "", phase: "offline", rxPower: "unknown" },
        { onu: { onuId: "3" }, name: "弱光用户", phase: "online", rxPower: "-27 dBm" }
      ],
      observedAt: "2026-08-05T00:00:01.000Z"
    }
  });
  assert.equal(result.msgType, "interactive");
  assert.equal(result.content.header.title.content, "整口 ONU 状态大盘");
  const serialized = JSON.stringify(result.content);
  assert.match(serialized, /ONU 总数/);
  assert.match(serialized, /王柏权/);
  assert.match(serialized, /未关联用户/);
  assert.match(serialized, /按光功率排序/);
  assert.match(serialized, /按 ONU ID 排序/);
  assert.match(serialized, /读取时间：2026-08-05 08:00:01/);
  assert.ok(serialized.indexOf("ONU 2") < serialized.indexOf("ONU 3"));
  assert.ok(serialized.indexOf("ONU 3") < serialized.indexOf("ONU 1"));
  const action = result.content.elements.find((element) => element.tag === "action");
  assert.ok(result.content.elements.indexOf(action) > result.content.elements.findIndex((element) =>
    element.text?.content?.includes("读取时间")));
  assert.deepEqual(action.actions.map((button) => button.value), [
    {
      token: "pon-sort-token",
      index: 0,
      action: "pon-sort-power",
      expiresAt: "2026-08-05T00:05:00.000Z"
    },
    {
      token: "pon-sort-token",
      index: 0,
      action: "pon-sort-onu",
      expiresAt: "2026-08-05T00:05:00.000Z"
    }
  ]);
});

test("production runtime renders PON status sorted by ONU id when requested", () => {
  const result = renderReply({
    kind: "pon-detail",
    candidate: { address: "山仔村光交箱", oltName: "OLT 104.98", pon: { chassis: "1", board: "7", pon: "8" } },
    sorting: { current: "onu" },
    detail: {
      pon: { chassis: "1", board: "7", pon: "8" },
      onuCount: 3,
      onus: [
        { onu: { onuId: "2" }, name: "", phase: "offline", rxPower: "unknown" },
        { onu: { onuId: "3" }, name: "弱光用户", phase: "online", rxPower: "-27 dBm" },
        { onu: { onuId: "1" }, name: "王柏权", phase: "online", rxPower: "-20 dBm" }
      ],
      observedAt: "2026-08-05T00:00:01.000Z"
    }
  });
  const serialized = JSON.stringify(result.content);
  assert.ok(serialized.indexOf("ONU 1") < serialized.indexOf("ONU 2"));
  assert.ok(serialized.indexOf("ONU 2") < serialized.indexOf("ONU 3"));
});

test("production runtime applies the requested ONU status colors", () => {
  const result = renderReply({
    kind: "pon-detail",
    candidate: { address: "地址", pon: { chassis: "1", board: "7", pon: "8" } },
    detail: {
      pon: { chassis: "1", board: "7", pon: "8" },
      onuCount: 6,
      onus: [
        { onu: { onuId: "1" }, phase: "online", rxPower: "-24.9 dBm" },
        { onu: { onuId: "2" }, phase: "online", rxPower: "-25 dBm" },
        { onu: { onuId: "3" }, phase: "online", rxPower: "-27 dBm" },
        { onu: { onuId: "4" }, phase: "online", rxPower: "-27.1 dBm" },
        { onu: { onuId: "5" }, phase: "dyinggasp", rxPower: "-20 dBm" },
        { onu: { onuId: "6" }, phase: "offline", rxPower: "unknown" }
      ],
      observedAt: "2026-08-05T00:00:01.000Z"
    }
  });
  const serialized = JSON.stringify(result.content);
  assert.match(serialized, /<font color='green'>\*\*在线\*\*<\/font>/);
  assert.match(serialized, /<font color='yellow'>\*\*弱光\*\*<\/font>/);
  assert.match(serialized, /<font color='red'>\*\*不及格弱光\*\*<\/font>/);
  assert.match(serialized, /<font color='purple'>\*\*掉电\*\*<\/font>/);
  assert.match(serialized, /<font color='black'>\*\*离线\*\*<\/font>/);
});
