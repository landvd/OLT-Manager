import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createWecomProductionRuntime } = require("../src/wecom/production-runtime.cjs");

class MockWebSocket extends EventEmitter {
  constructor(endpoint) {
    super();
    this.endpoint = endpoint;
    this.readyState = 1; // OPEN
    this.sent = [];
    process.nextTick(() => {
      this.emit("open");
    });
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3; // CLOSED
    this.emit("close");
  }

  // 模拟从服务器接收消息
  serverSend(json) {
    const raw = { data: JSON.stringify(json) };
    this.emit("message", raw);
  }
}

function makeGateway() {
  return {
    async status() {
      return { datasetRevision: "rev-test-1" };
    },
    async listOlts() {
      return [{ id: "1", name: "172.19.104.101", host: "172.19.104.101" }];
    },
    async queryUsers({ intent, value }) {
      if (value === "张三") {
        return {
          authorizedCount: 1,
          candidates: [{
            oltId: "1",
            name: "张三",
            phone: "13800138000",
            address: "三屯1号",
            onu: { chassis: "1", board: "5", pon: "2", onuId: "3" }
          }]
        };
      }
      return { authorizedCount: 0, candidates: [] };
    },
    async readOnuDetail() {
      return { online: true, rxPower: -19.8, distance: 1500 };
    },
    async readPonStatusesByIp({ oltIp, board, pon }) {
      return {
        oltIp,
        board,
        pon,
        address: "厚街三屯光交箱01",
        onCount: 12,
        offCount: 1,
        total: 13,
        onuerList: [
          { onuId: 1, name: "用户A", online: true, rxPower: -18.5 },
          { onuId: 2, name: "用户B", online: false, rxPower: null }
        ]
      };
    },
    async queryVillagePons({ value }) {
      if (value === "双岗村") {
        return {
          total: 1,
          candidates: [{
            oltId: "1",
            oltName: "172.19.104.101",
            address: "双岗新兴路",
            pon: { chassis: "1", board: "3", pon: "4" }
          }]
        };
      }
      return { total: 0, candidates: [] };
    },
    async sampleVillagePonOnlineUser() {
      return {
        status: "complete",
        comparison: { current: -19.5, rawDifference: 0.1 }
      };
    }
  };
}

test("WeCom production runtime subscribes and handles welcome message", async () => {
  let mockWs;
  const runtime = createWecomProductionRuntime({
    gateway: makeGateway(),
    getSecret: async () => "mock-secret-123",
    wsFactory: () => {
      mockWs = new MockWebSocket("wss://openws.work.weixin.qq.com");
      return mockWs;
    }
  });

  await runtime.start({
    botId: "bot-test-01",
    credentialReference: "keychain:wecom:1",
    welcomeEnabled: true
  });

  // 等待 open 并验证订阅
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(mockWs.sent[0].cmd, "aibot_subscribe");
  assert.equal(mockWs.sent[0].body.bot_id, "bot-test-01");
  assert.equal(mockWs.sent[0].body.secret, "mock-secret-123");

  // 模拟服务器返回订阅成功
  mockWs.serverSend({ headers: { req_id: "sub-1" }, errcode: 0, errmsg: "ok" });
  assert.equal(runtime.status().state, "connected");

  // 模拟进入会话事件 enter_chat
  mockWs.serverSend({
    cmd: "aibot_event_callback",
    headers: { req_id: "req-enter-1" },
    body: {
      event: { eventtype: "enter_chat" }
    }
  });

  assert.equal(mockWs.sent[1].cmd, "aibot_respond_welcome_msg");
  assert.equal(mockWs.sent[1].headers.req_id, "req-enter-1");
  assert.match(mockWs.sent[1].body.text.content, /日常查单/);

  await runtime.stop();
  assert.equal(runtime.status().state, "stopped");
});

test("WeCom production runtime dispatches user query and responds with markdown", async () => {
  let mockWs;
  const runtime = createWecomProductionRuntime({
    gateway: makeGateway(),
    getSecret: async () => "mock-secret-123",
    wsFactory: () => {
      mockWs = new MockWebSocket("wss://openws.work.weixin.qq.com");
      return mockWs;
    }
  });

  await runtime.start({
    botId: "bot-test-01",
    credentialReference: "keychain:wecom:1"
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  mockWs.serverSend({ headers: { req_id: "sub-1" }, errcode: 0, errmsg: "ok" });

  // 模拟发送消息：张三
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "msg-user-1" },
    body: {
      chattype: "single",
      text: { content: "张三" }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const reply = mockWs.sent.find((m) => m.headers.req_id === "msg-user-1");
  assert.ok(reply);
  assert.equal(reply.cmd, "aibot_respond_msg");
  assert.match(reply.body.markdown.content, /用户 ONU 详情：张三/);
  assert.match(reply.body.markdown.content, /19\.80 dBm/);

  await runtime.stop();
});

test("WeCom production runtime dispatches IP/PON port query and village summary", async () => {
  let mockWs;
  const runtime = createWecomProductionRuntime({
    gateway: makeGateway(),
    getSecret: async () => "mock-secret-123",
    wsFactory: () => {
      mockWs = new MockWebSocket("wss://openws.work.weixin.qq.com");
      return mockWs;
    }
  });

  await runtime.start({
    botId: "bot-test-01",
    credentialReference: "keychain:wecom:1"
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  mockWs.serverSend({ headers: { req_id: "sub-1" }, errcode: 0, errmsg: "ok" });

  // 模拟发送 IP PON 口反查
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "msg-pon-1" },
    body: {
      chattype: "single",
      text: { content: "104.101 3/4" }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const ponReply = mockWs.sent.find((m) => m.headers.req_id === "msg-pon-1");
  assert.ok(ponReply);
  assert.match(ponReply.body.markdown.content, /厚街三屯光交箱01/);
  assert.match(ponReply.body.markdown.content, /用户A/);

  // 模拟村级抢修定界
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "msg-village-1" },
    body: {
      chattype: "single",
      text: { content: "双岗村所有pon口" }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const villageReply = mockWs.sent.find((m) => m.headers.req_id === "msg-village-1");
  assert.ok(villageReply);
  assert.match(villageReply.body.markdown.content, /主干抢修熔接验收定界报告/);
  assert.match(villageReply.body.markdown.content, /主干熔接质量优秀/);

  // 模拟被踢事件
  mockWs.serverSend({
    cmd: "aibot_event_callback",
    headers: { req_id: "dis-1" },
    body: {
      event: { eventtype: "disconnected_event" }
    }
  });
  assert.equal(runtime.status().state, "disconnected");

  await runtime.stop();
});

test("WeCom production runtime handles multi-candidate selection, pagination, history optical, and LOID copy", async () => {
  let mockWs;
  const gw = makeGateway();
  gw.queryUsers = async ({ value }) => {
    if (value === "坑口") {
      return {
        authorizedCount: 2,
        candidates: [
          { oltId: "1", name: "田金水", phone: "13543733008", address: "坑口村8巷16号", onu: { chassis: "1", board: "8", pon: "5", onuId: "1" }, loid: "DG214222AOE" },
          { oltId: "1", name: "李某某", phone: "13800000000", address: "坑口村1巷1号", onu: { chassis: "1", board: "8", pon: "5", onuId: "2" }, loid: "DG214222BOE" }
        ]
      };
    }
    return { authorizedCount: 0, candidates: [] };
  };
  gw.readOnuHistoricalOptical = async () => ({
    source: "oss-ngb",
    rows: [
      { reportTime: "2026-09-13 12:00", rxOptical: "-18.50", txOptical: "2.3", lightDecay: "20.8" },
      { reportTime: "2026-09-12 12:00", rxOptical: "-18.40", txOptical: "2.3", lightDecay: "20.7" }
    ]
  });

  const runtime = createWecomProductionRuntime({
    gateway: gw,
    getSecret: async () => "mock-secret-123",
    wsFactory: () => {
      mockWs = new MockWebSocket("wss://openws.work.weixin.qq.com");
      return mockWs;
    }
  });

  await runtime.start({ botId: "bot-test-01", credentialReference: "ref-1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  mockWs.serverSend({ headers: { req_id: "sub-1" }, errcode: 0, errmsg: "ok" });

  // 1. 查询“坑口” -> 得到多条候选
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-kengkou" },
    body: {
      from: { user_id: "user_zhang" },
      text: { content: "坑口" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const candReply = mockWs.sent.find((m) => m.headers.req_id === "req-kengkou");
  assert.ok(candReply);
  assert.match(candReply.body.markdown.content, /找到 2 条匹配结果/);
  assert.match(candReply.body.markdown.content, /田金水/);

  // 2. 回复数字“1” -> 选择第 1 个候选人（田金水）
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-select-1" },
    body: {
      from: { user_id: "user_zhang" },
      text: { content: "1" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const selReply = mockWs.sent.find((m) => m.headers.req_id === "req-select-1");
  assert.ok(selReply);
  assert.match(selReply.body.markdown.content, /用户 ONU 详情：田金水/);
  assert.match(selReply.body.markdown.content, /DG214222AOE/);

  // 3. 回复“历史” -> 追溯该用户的历史光衰
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-history-1" },
    body: {
      from: { user_id: "user_zhang" },
      text: { content: "历史" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const histReply = mockWs.sent.find((m) => m.headers.req_id === "req-history-1");
  assert.ok(histReply);
  assert.match(histReply.body.markdown.content, /7天历史光功率追溯：田金水/);
  assert.match(histReply.body.markdown.content, /光路极其平稳/);

  // 4. 回复“LOID” -> 单独提取 LOID
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-loid-1" },
    body: {
      from: { user_id: "user_zhang" },
      text: { content: "LOID" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const loidReply = mockWs.sent.find((m) => m.headers.req_id === "req-loid-1");
  assert.ok(loidReply);
  assert.match(loidReply.body.markdown.content, /DG214222AOE/);

  // 5. 回复“整口” -> 查看所属 PON 口
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-pon-full" },
    body: {
      from: { user_id: "user_zhang" },
      text: { content: "整口" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const fullPonReply = mockWs.sent.find((m) => m.headers.req_id === "req-pon-full");
  assert.ok(fullPonReply);
  assert.match(fullPonReply.body.markdown.content, /PON 端口运行态势/);

  await runtime.stop();
});

test("WeCom production runtime prioritizes primary address queryPons over user search", async () => {
  let mockWs;
  const gw = makeGateway();
  gw.queryPons = async ({ value }) => {
    if (value === "汀山村8巷") {
      return {
        authorizedCount: 1,
        candidates: [{
          oltId: "1",
          oltName: "172.19.104.101",
          address: "汀山村8巷16号光交箱",
          pon: { chassis: "1", board: "8", pon: "5" }
        }]
      };
    }
    if (value === "坑口") {
      return {
        authorizedCount: 2,
        candidates: [
          { oltId: "1", oltName: "172.19.104.101", address: "坑口前路五巷5号", pon: { chassis: "1", board: "8", pon: "5" } },
          { oltId: "1", oltName: "172.19.104.101", address: "坑口市场路15号", pon: { chassis: "1", board: "8", pon: "6" } }
        ]
      };
    }
    return { authorizedCount: 0, candidates: [] };
  };

  gw.queryUsers = async ({ value }) => {
    // 模拟台账中即使也存在该地址的用户，也不能抢走一级地址的 PON 口查询优先权
    return {
      authorizedCount: 10,
      candidates: [
        { oltId: "1", name: "地址用户A", phone: "13500000000", address: "坑口村", onu: { chassis: "1", board: "8", pon: "5", onuId: "1" } },
        { oltId: "1", name: "地址用户B", phone: "13500000001", address: "坑口村", onu: { chassis: "1", board: "8", pon: "5", onuId: "2" } }
      ]
    };
  };

  const runtime = createWecomProductionRuntime({
    gateway: gw,
    getSecret: async () => "mock-secret-123",
    wsFactory: () => {
      mockWs = new MockWebSocket("wss://openws.work.weixin.qq.com");
      return mockWs;
    }
  });

  await runtime.start({ botId: "bot-test-01", credentialReference: "ref-1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  mockWs.serverSend({ headers: { req_id: "sub-1" }, errcode: 0, errmsg: "ok" });

  // 1. 输入单一精准一级地址 -> 直接命中整口态势（而不是用户列表）
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-addr-single" },
    body: {
      from: { user_id: "user_wang" },
      text: { content: "汀山村8巷" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const singleReply = mockWs.sent.find((m) => m.headers.req_id === "req-addr-single");
  assert.ok(singleReply);
  assert.match(singleReply.body.markdown.content, /PON 端口运行态势/);
  assert.match(singleReply.body.markdown.content, /汀山村8巷16号光交箱/);

  // 2. 输入有多端口的一级地址 -> 返回 PON 端口列表（回复数字可选单）
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-addr-multi" },
    body: {
      from: { user_id: "user_wang" },
      text: { content: "坑口" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const multiReply = mockWs.sent.find((m) => m.headers.req_id === "req-addr-multi");
  assert.ok(multiReply);
  assert.match(multiReply.body.markdown.content, /匹配到 2 个 PON 端口/);
  assert.match(multiReply.body.markdown.content, /坑口前路五巷5号/);

  // 3. 回复数字“1” -> 打开选中的第 1 个 PON 口整口态势
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-select-pon-1" },
    body: {
      from: { user_id: "user_wang" },
      text: { content: "1" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const selectPonReply = mockWs.sent.find((m) => m.headers.req_id === "req-select-pon-1");
  assert.ok(selectPonReply);
  assert.match(selectPonReply.body.markdown.content, /PON 端口运行态势/);

  // 4. 显式查用户“用户 坑口” -> 强制进入用户查询
  mockWs.serverSend({
    cmd: "aibot_msg_callback",
    headers: { req_id: "req-explicit-user" },
    body: {
      from: { user_id: "user_wang" },
      text: { content: "用户 坑口" }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const userReply = mockWs.sent.find((m) => m.headers.req_id === "req-explicit-user");
  assert.ok(userReply);
  assert.match(userReply.body.markdown.content, /找到 10 条匹配结果/);
  assert.match(userReply.body.markdown.content, /地址用户A/);

  await runtime.stop();
});


