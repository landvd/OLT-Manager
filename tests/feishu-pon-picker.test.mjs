import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";
import { createOltDataGateway } from "../src/olt-data-gateway.mjs";
import { createInProcessFeishuGateway } from "../src/feishu/gateway-contract.mjs";

const require = createRequire(import.meta.url);
const { renderReply, normalizeCallback } = require("../src/feishu/production-runtime.cjs");

function feishuStore() {
  let value = { ...emptyFeishuState(), enabled: true };
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); } };
}

function memoryBindingStore() {
  const rows = new Map();
  return {
    rows,
    async save(record) { rows.set(record.token, record); },
    async load({ token, scope, now }) {
      const row = rows.get(token);
      return row && row.scope === scope && row.expiresAt > now ? { dataJson: row.dataJson, expiresAt: row.expiresAt } : null;
    },
    async purge() {}
  };
}

// 合成数据：示例村 12 个口（分上坊、下坊两个小组），双岗村 1 个口。
function pickerGateway({ regions = [], calls = [] } = {}) {
  const candidate = (offset, index) => ({
    candidateId: `olt-1:1/1/${offset + index + 1}`, oltId: "olt-1", oltName: "OLT 1", address: `一级地址${offset + index + 1}`,
    pon: { chassis: "1", board: "1", pon: String(offset + index + 1) }, matchedUserCount: 6, ponUserCount: 8, sparse: offset + index + 1 === 12
  });
  return {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
    async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async listVillages(request) {
      calls.push(["villages", request]);
      return { villages: [{ name: "示例村", userCount: 70 }, { name: "双岗村", userCount: 6 }] };
    },
    async queryVillagePons(request) {
      calls.push(["pons", request]);
      const total = request.value === "双岗村" ? 1 : request.value === "示例村" ? 12 : request.value.startsWith("示例村") ? 2 : 0;
      const count = Math.max(0, Math.min(request.limit, total - request.offset));
      return { total, authorizedCount: total, offset: request.offset, limit: request.limit, hasMore: request.offset + count < total,
        mainCount: total, sparseCount: request.value === "示例村" ? 1 : 0, region: null,
        candidates: Array.from({ length: count }, (_, index) => candidate(request.offset, index)) };
    },
    async villageRegionMenu(request) {
      calls.push(["regions", request]);
      return { village: request.value, region: null, discovered: false, regions: request.value === "示例村" ? regions : [] };
    },
    async readPonStatuses(request) {
      calls.push(["pon-status", request]);
      return { oltId: "olt-1", pon: request.coordinate, onuCount: 1, observedAt: "2026-11-21T00:00:01.000Z",
        onus: [{ onu: { ...request.coordinate, onuId: "1" }, name: "用户", phase: "在线", rxPower: "-20 dBm" }] };
    },
    async readPonRepairComparison() { return { status: "no-baseline" }; },
    async sampleVillagePonOnlineUser() { return { candidate: null, liveStatus: null, ponStatus: { status: "no-configured-data" } }; }
  };
}

// 每次点击把时钟往前推 7 秒，避开“10 秒内最多 3 次”的频率限制。
function clock(start = "2026-11-21T04:00:00.000Z") {
  let at = Date.parse(start);
  return { now: () => new Date(at).toISOString(), tick: () => { at += 7_000; } };
}

function setup(options = {}) {
  const sent = [];
  const calls = [];
  const cardBindingStore = memoryBindingStore();
  const time = clock();
  const rawApp = createFeishuQueryApplication({
    stateStore: feishuStore(),
    gateway: pickerGateway({ ...options, calls }),
    interpret: async () => { throw new Error("应由本地规则识别"); },
    cardBindingStore,
    ...(options.editRequests ? { editRequests: options.editRequests } : {}),
    now: time.now,
    send: async (chatId, reply, sendOptions) => { sent.push({ chatId, reply, options: sendOptions }); }
  });
  const app = {
    handleMenu: (event) => { time.tick(); return rawApp.handleMenu(event); },
    handleMessage: (event) => { time.tick(); return rawApp.handleMessage(event); },
    handleCallback: (event) => { time.tick(); return rawApp.handleCallback(event); }
  };
  let eventCount = 0;
  const click = (reply, action, extra = {}, { openId = "ou-1", chatId = "oc-p2p", formValue } = {}) => app.handleCallback({
    eventId: `cb-${eventCount += 1}`, openId, chatId, verifiedByTransport: true, messageId: "om-card",
    ...(formValue ? { formValue } : {}),
    binding: { token: reply.action.token, index: 0, action, expiresAt: reply.action.expiresAt, ...extra }
  });
  return { app, sent, calls, click, cardBindingStore };
}

function waitFor(sent, kind) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const found = sent.find((item) => item.reply.kind === kind);
      if (found) { clearInterval(timer); resolve(found.reply); }
    }, 1);
  });
}

function cardJson(reply) {
  const rendered = renderReply(reply);
  return typeof rendered.content === "string" ? JSON.parse(rendered.content) : rendered.content;
}

test("菜单“查 PON 口”：发蓝色下拉框卡片到单聊，选村后列出 PON 口清单，可翻页、看整口状态", async () => {
  const { app, sent, calls, click } = setup();
  const picker = await app.handleMenu({ eventId: "m1", openId: "ou-1", eventKey: "pon-list", verifiedByTransport: true });
  assert.equal(picker.kind, "pon-picker");
  assert.equal(picker.mode, "list");
  assert.deepEqual(picker.villages.map((village) => village.name), ["示例村", "双岗村"]);
  assert.equal(sent[0].chatId, "ou-1");
  assert.equal(sent[0].options.receiveIdType, "open_id");
  const card = cardJson(picker);
  assert.equal(card.schema, "2.0");
  assert.equal(card.header.template, "blue");
  const form = card.body.elements.find((element) => element.tag === "form");
  const villageSelect = form.elements.find((element) => element.tag === "select_static");
  assert.equal(villageSelect.name, "village");
  assert.equal(villageSelect.required, true);
  assert.deepEqual(villageSelect.options.map((option) => [option.text.content, option.value]), [["示例村（70户）", "示例村"], ["双岗村（6户）", "双岗村"]]);

  // 回调来自单聊的 open_chat_id，和菜单发卡时的 open_id 不同，按发起人校验。
  const list = await click(picker, "pon-pick-submit", {}, { formValue: { village: "示例村" } });
  assert.equal(list.kind, "village-pon-list");
  assert.equal(list.total, 12);
  assert.equal(list.pageCount, 2);
  assert.equal(list.candidates.length, 10);
  assert.equal(sent.at(-1).chatId, "oc-p2p");
  const listCard = cardJson(list);
  assert.equal(listCard.schema, "2.0");
  assert.match(JSON.stringify(listCard), /一级地址1/);
  assert.match(JSON.stringify(listCard), /本村 6 户 · 口上共 8 户/);
  assert.match(JSON.stringify(listCard), /其中 1 个是零星沾边口/);
  assert.match(JSON.stringify(listCard), /再查一个村/);

  const page3 = await click(list, "pon-list-page", { page: 2 });
  assert.equal(page3.page, 2);
  assert.equal(page3.candidates.length, 2);
  assert.equal(sent.at(-1).options.replaceOriginal, true);
  assert.match(JSON.stringify(cardJson(page3)), /零星/);

  const detail = await click(page3, "pon-list-detail", { index: 1 });
  assert.equal(detail.kind, "pon-detail");
  assert.deepEqual(calls.find(([type]) => type === "pon-status")[1].coordinate, { chassis: "1", board: "1", pon: "12" });
  // 同一个口可以再看一次（重新实时读取）。
  const again = await click(page3, "pon-list-detail", { index: 1 });
  assert.equal(again.kind, "pon-detail");

  const newPicker = await click(list, "pon-list-again");
  assert.equal(newPicker.kind, "pon-picker");
  assert.equal(newPicker.mode, "list");
  assert.deepEqual(newPicker.recent.map((item) => item.label), ["示例村"]);
  const recentList = await click(newPicker, "pon-pick-recent", { index: 0 });
  assert.equal(recentList.kind, "village-pon-list");
  assert.equal(recentList.village, "示例村");
});

test("菜单“抢修验收”：橙色卡片，分了小组的村第二步选范围，选小组后只检查该小组", async () => {
  const regions = [
    { village: "示例村", name: "上坊小组", status: "active", userCount: 40, ponCount: 7 },
    { village: "示例村", name: "下坊小组", status: "active", userCount: 30, ponCount: 5 }
  ];
  const { app, sent, calls, click } = setup({ regions });
  const picker = await app.handleMenu({ eventId: "m2", openId: "ou-1", eventKey: "pon-repair", verifiedByTransport: true });
  assert.equal(picker.mode, "repair");
  assert.equal(cardJson(picker).header.template, "orange");

  const step2 = await click(picker, "pon-pick-submit", {}, { formValue: { village: "示例村" } });
  assert.equal(step2.kind, "pon-picker");
  assert.equal(step2.step, "region");
  assert.equal(sent.at(-1).options.replaceOriginal, true);
  const regionSelect = cardJson(step2).body.elements.find((element) => element.tag === "form").elements[0];
  assert.equal(regionSelect.initial_option, "all");
  assert.deepEqual(regionSelect.options.map((option) => option.text.content), ["整村（全部主要 PON 口）", "上坊小组（40户/7口）", "下坊小组（30户/5口）"]);

  const loading = await click(step2, "pon-pick-submit", {}, { formValue: { region: "1" } });
  assert.equal(loading.kind, "village-pon-summary-loading");
  assert.ok(calls.some(([type, request]) => type === "pons" && request.value === "示例村下坊小组" && request.ponScope === "main"));
  const summary = await waitFor(sent, "village-pon-summary");
  assert.equal(summary.village, "示例村下坊小组");
  assert.equal(summary.picker, true);
  assert.match(JSON.stringify(cardJson(summary)), /再查一个村/);

  // “换个村”回到第 1 步；再选整村时不再弹小组菜单。
  const back = await click(step2, "pon-pick-back");
  assert.equal(back.step, "village");
  const step2Again = await click(back, "pon-pick-submit", {}, { formValue: { village: "示例村" } });
  const whole = await click(step2Again, "pon-pick-submit", {}, { formValue: { region: "all" } });
  assert.equal(whole.kind, "village-pon-summary-loading");
  assert.equal(whole.village, "示例村");

  const fresh = await app.handleMenu({ eventId: "m3", openId: "ou-1", eventKey: "pon-repair", verifiedByTransport: true });
  assert.deepEqual(fresh.recent.map((item) => item.label), ["示例村", "示例村·下坊小组"]);
  const anotherSummary = sent.find((item) => item.reply.kind === "village-pon-summary").reply;
  const againPicker = await app.handleCallback({ eventId: "cb-again", openId: "ou-1", chatId: "oc-p2p", verifiedByTransport: true,
    binding: { token: anotherSummary.selection.token, index: 0, action: "village-repair-again", expiresAt: anotherSummary.selection.expiresAt } });
  assert.equal(againPicker.kind, "pon-picker");
  assert.equal(againPicker.mode, "repair");
});

test("查 PON 口：分了小组的村第二步选小组或小区，只列该范围的口；选整村列全部", async () => {
  const regions = [
    { village: "示例村", name: "上坊小组", status: "active", userCount: 40, ponCount: 7 },
    { village: "示例村", name: "万达广场小区", status: "active", userCount: 30, ponCount: 5 }
  ];
  const { app, sent, calls, click } = setup({ regions });
  const picker = await app.handleMenu({ eventId: "m7", openId: "ou-1", eventKey: "pon-list", verifiedByTransport: true });
  const step2 = await click(picker, "pon-pick-submit", {}, { formValue: { village: "示例村" } });
  assert.equal(step2.step, "region");
  assert.equal(sent.at(-1).options.replaceOriginal, true);
  const card = cardJson(step2);
  assert.equal(card.header.template, "blue");
  const form = card.body.elements.find((element) => element.tag === "form");
  assert.deepEqual(form.elements[0].options.map((option) => option.text.content), ["整村（全部 PON 口）", "上坊小组（40户/7口）", "万达广场小区（30户/5口）"]);
  assert.equal(form.elements[1].text.content, "查询");

  const list = await click(step2, "pon-pick-submit", {}, { formValue: { region: "1" } });
  assert.equal(list.kind, "village-pon-list");
  assert.equal(list.village, "示例村万达广场小区");
  assert.equal(list.total, 2);
  assert.ok(calls.some(([type, request]) => type === "pons" && request.value === "示例村万达广场小区" && request.limit === 10));
  const whole = await click(step2, "pon-pick-submit", {}, { formValue: { region: "all" } });
  assert.equal(whole.village, "示例村");
  assert.equal(whole.total, 12);

  const again = await click(list, "pon-list-again");
  assert.deepEqual(again.recent.map((item) => item.label), ["示例村", "示例村·万达广场小区"]);
});

test("抢修验收：没有小组的村选完直接开始验收", async () => {
  const { app, calls, click } = setup();
  const picker = await app.handleMenu({ eventId: "m4", openId: "ou-1", eventKey: "pon-repair", verifiedByTransport: true });
  const loading = await click(picker, "pon-pick-submit", {}, { formValue: { village: "双岗村" } });
  assert.equal(loading.kind, "village-pon-summary-loading");
  assert.ok(calls.some(([type, request]) => type === "regions" && request.value === "双岗村"));
});

test("选择卡片：别人在别的会话点无效；表单里填了列表外的村会提示重选", async () => {
  const { app, click } = setup();
  const picker = await app.handleMenu({ eventId: "m5", openId: "ou-1", eventKey: "pon-list", verifiedByTransport: true });
  const denied = await click(picker, "pon-pick-submit", {}, { openId: "ou-2", chatId: "oc-other", formValue: { village: "示例村" } });
  assert.equal(denied.kind, "denied");
  const invalid = await click(picker, "pon-pick-submit", {}, { formValue: { village: "不存在村" } });
  assert.equal(invalid.kind, "pon-picker");
  assert.match(invalid.notice, /请先在下拉框里选一个村/);
  const tampered = await app.handleCallback({ eventId: "cb-t", openId: "ou-1", chatId: "oc-p2p", verifiedByTransport: true,
    binding: { token: picker.action.token, index: 0, action: "pon-pick-submit", expiresAt: "2099-01-01T00:00:00.000Z" }, formValue: { village: "示例村" } });
  assert.equal(tampered.kind, "invalid-callback");
});

test("选择卡片令牌和“最近查过”落库：程序重启后仍能点", async () => {
  const first = setup();
  const picker = await first.app.handleMenu({ eventId: "m6", openId: "ou-1", eventKey: "pon-list", verifiedByTransport: true });
  await first.click(picker, "pon-pick-submit", {}, { formValue: { village: "双岗村" } });
  const restarted = createFeishuQueryApplication({
    stateStore: feishuStore(), gateway: pickerGateway(),
    interpret: async () => { throw new Error("应由本地规则识别"); },
    cardBindingStore: first.cardBindingStore,
    now: () => "2026-11-21T06:00:00.000Z",
    send: async () => {}
  });
  const list = await restarted.handleCallback({ eventId: "r1", openId: "ou-1", chatId: "oc-p2p", verifiedByTransport: true,
    formValue: { village: "示例村" }, binding: { token: picker.action.token, index: 0, action: "pon-pick-submit", expiresAt: picker.action.expiresAt } });
  assert.equal(list.kind, "village-pon-list");
  const again = await restarted.handleMenu({ eventId: "r2", openId: "ou-1", eventKey: "pon-list", verifiedByTransport: true });
  assert.deepEqual(again.recent.map((item) => item.label), ["示例村", "双岗村"]);
});

test("文字：“所有PON口”出 PON 口清单，“抢修情况”出抢修验收，只发村名时让人二选一", async () => {
  const { app, click } = setup();
  for (const text of ["双岗村所有PON口", "查双岗村pon", "双岗村的光口"]) {
    const reply = await app.handleMessage({ eventId: `t-${text}`, openId: "ou-1", chatId: "oc-1", text });
    assert.equal(reply.kind, "village-pon-list", text);
    assert.equal(reply.village, "双岗村");
  }
  const repair = await app.handleMessage({ eventId: "t-repair", openId: "ou-1", chatId: "oc-1", text: "双岗村抢修情况" });
  assert.equal(repair.kind, "village-pon-summary-loading");

  const choice = await app.handleMessage({ eventId: "t-bare", openId: "ou-1", chatId: "oc-1", text: "双岗村" });
  assert.equal(choice.kind, "pon-village-choice");
  assert.match(JSON.stringify(cardJson(choice)), /查 PON 口.*抢修验收/);
  const list = await click(choice, "pon-pick-choice-list", {}, { chatId: "oc-1" });
  assert.equal(list.kind, "village-pon-list");
  const loading = await click(choice, "pon-pick-choice-repair", {}, { chatId: "oc-1" });
  assert.equal(loading.kind, "village-pon-summary-loading");
});

test("运行时：选择卡片和清单的按钮先应答再后台处理，表单的下拉值能传到应用", () => {
  const callback = normalizeCallback({
    event_id: "evt", operator: { open_id: "ou-1" }, open_chat_id: "oc-p2p", open_message_id: "om-1",
    action: { value: { token: "tok", index: 0, action: "pon-pick-submit", expiresAt: "2026-11-22T00:00:00.000Z" }, form_value: { village: "示例村" } }
  });
  assert.deepEqual(callback.formValue, { village: "示例村" });
  assert.equal(callback.binding.action, "pon-pick-submit");
});

test("网关：村名列表按合并台账的村归属统计户数，经进程内适配层校验", async () => {
  const users = [
    ...Array.from({ length: 3 }, (_, index) => ({ oltIp: "192.0.2.1", onuIndex: `1/1/1:${index + 1}`, village: "示例村", villageGroup: "上坊", installationAddress: "示例村上坊" })),
    { oltIp: "192.0.2.1", onuIndex: "1/1/2:1", village: "双岗村", installationAddress: "双岗村" },
    { oltIp: "192.0.2.1", onuIndex: "1/1/3:1", community: "示例小区", installationAddress: "示例小区" }
  ];
  const inner = createOltDataGateway({
    getOlts: async () => [{ id: "olt-a", name: "A", vendor: "zte", model: "C300", host: "192.0.2.1", enabled: true }],
    getUsers: async () => users,
    getPonPorts: async () => [],
    getDatasetRevision: async () => "rev",
    listOnus: async () => [],
    getPortPlaceAssignments: async () => [{ oltIp: "192.0.2.1", board: "1", pon: "5", village: "新村" }],
    getVillageRegions: async () => [{ id: 1, village: "旧村", name: "东", status: "active" }, { id: 2, village: "候选村", name: "西", status: "candidate" }]
  });
  const gateway = createInProcessFeishuGateway({ gateway: inner });
  const result = await gateway.listVillages({ oltIds: ["olt-a"] });
  assert.deepEqual(result.villages, [
    { name: "示例村", userCount: 3 },
    { name: "双岗村", userCount: 1 },
    { name: "旧村", userCount: 0 },
    { name: "新村", userCount: 0 }
  ]);
});


// 资料修改服务的替身：2 号口台账里分两行，12 号口不在台账里；只记录提交，不改任何数据。
function fakeEditRequests({ approver = { openId: "ou-approver", name: "王审批" } } = {}) {
  const submitted = [];
  return {
    submitted,
    async approver() { return approver; },
    async ponFormContext({ pon }) {
      if (!approver) return { approver: null, rows: [] };
      if (pon.pon === "12") return { approver, oltName: "OLT 1", rows: [] };
      return { approver, oltName: "OLT 1", rows: pon.pon === "2"
        ? [{ address: "一级地址2", place: "示例村/上坊小组" }, { address: "分路B", place: "" }]
        : [{ address: `一级地址${pon.pon}`, place: "示例村/上坊小组" }] };
    },
    async submit(item) {
      submitted.push(item);
      return { request: { id: submitted.length, token: `req-${submitted.length}`, kind: item.kind, status: "pending", oltName: "OLT 1", board: item.target.board, pon: item.target.pon,
        rowAddress: item.target.rowAddress, previousValue: "", proposedValue: item.proposedValue }, approver, duplicate: false };
    }
  };
}

test("资料有误（查 PON 口清单）：两步下拉框选口、村、小组 / 小区，提交台账行归属申请给审批人", async () => {
  const editRequests = fakeEditRequests();
  const { app, sent, click } = setup({ editRequests });
  const list = await app.handleMessage({ eventId: "f1", openId: "ou-1", chatId: "oc-1", text: "示例村所有PON口" });
  assert.match(JSON.stringify(cardJson(list)), /资料有误/);
  const form = await click(list, "pon-list-fix", {}, { chatId: "oc-1" });
  assert.equal(form.kind, "place-fix");
  assert.equal(form.step, "pon");
  assert.equal(form.pons.length, 10);
  assert.equal(form.village, "示例村");
  const card = cardJson(form);
  assert.equal(card.schema, "2.0");
  assert.equal(card.header.template, "orange");
  const selects = card.body.elements.find((element) => element.tag === "form").elements.filter((element) => element.tag === "select_static");
  assert.deepEqual(selects.map((element) => element.name), ["pon", "village"]);
  assert.equal(selects[1].initial_option, "示例村");
  assert.match(selects[0].options[1].text.content, /PON 1\/1\/2 · 一级地址2 · 本村6户/);

  const step2 = await click(form, "place-fix-next", {}, { chatId: "oc-1", formValue: { pon: "1", village: "双岗村" } });
  assert.equal(step2.step, "place");
  assert.equal(sent.at(-1).options.replaceOriginal, true);
  const placeForm = cardJson(step2).body.elements.find((element) => element.tag === "form").elements;
  assert.deepEqual(placeForm[0].options.map((option) => option.text.content), ["一级地址2 · 现在：示例村/上坊小组", "分路B · 现在：未指定"]);
  assert.deepEqual(placeForm[1].options.map((option) => option.value), ["all", "new-group", "new-community"]);
  assert.match(placeForm.at(-1).text.content, /提交给王审批审批/);

  const missingName = await click(step2, "place-fix-submit", {}, { chatId: "oc-1", formValue: { row: "1", region: "new-community" } });
  assert.match(missingName.notice, /请在下面填写名称/);
  const submitted = await click(step2, "place-fix-submit", {}, { chatId: "oc-1", formValue: { row: "1", region: "new-community", newName: "顺景大厦" } });
  assert.equal(submitted.kind, "edit-request-submitted");
  assert.match(submitted.lines[0], /已发给 王审批 审批/);
  assert.deepEqual(editRequests.submitted[0], { kind: "row-place", proposedValue: "双岗村/顺景大厦小区",
    target: { oltId: "olt-1", oltName: "OLT 1", chassis: "1", board: "1", pon: "2", rowAddress: "分路B" },
    requester: { openId: "ou-1", name: "", chatId: "oc-1" } });
  assert.ok(sent.some((item) => item.chatId === "ou-approver" && item.reply.kind === "edit-request-approval"));
  const again = await click(step2, "place-fix-submit", {}, { chatId: "oc-1", formValue: { row: "0", region: "all" } });
  assert.match(again.message, /已经提交过了/);
});

test("资料有误（抢修验收）：列出检查过的全部口；选的和现在一样时提示没有改动", async () => {
  const regions = [{ village: "示例村", name: "上坊小组", status: "active", userCount: 40, ponCount: 7 }, { village: "示例村", name: "下坊", status: "active", userCount: 5, ponCount: 1 }];
  const editRequests = fakeEditRequests();
  const { app, sent, click } = setup({ regions, editRequests });
  await app.handleMessage({ eventId: "f2", openId: "ou-1", chatId: "oc-1", text: "示例村抢修情况" });
  const summary = await waitFor(sent, "village-pon-summary");
  assert.match(JSON.stringify(cardJson(summary)), /village-place-fix/);
  const form = await app.handleCallback({ eventId: "f3", openId: "ou-1", chatId: "oc-1", verifiedByTransport: true,
    binding: { token: summary.selection.token, index: 0, action: "village-place-fix", expiresAt: summary.selection.expiresAt } });
  assert.equal(form.kind, "place-fix");
  assert.equal(form.pons.length, 12);
  const step2 = await click(form, "place-fix-next", {}, { chatId: "oc-1", formValue: { pon: "0", village: "示例村" } });
  assert.deepEqual(step2.regions.map((region) => region.name), ["上坊小组", "下坊小组"]);
  const same = await click(step2, "place-fix-submit", {}, { chatId: "oc-1", formValue: { region: "0" } });
  assert.match(same.notice, /和现在的归属“示例村\/上坊小组”一样/);
  const changed = await click(step2, "place-fix-submit", {}, { chatId: "oc-1", formValue: { region: "1" } });
  assert.equal(changed.kind, "edit-request-submitted");
  assert.equal(editRequests.submitted[0].proposedValue, "示例村/下坊小组");
});

test("资料有误（整口状态）：默认选这个口现在归属的村；口不在台账里时提示改单户；没有审批人时提示", async () => {
  const editRequests = fakeEditRequests();
  const { app, click } = setup({ editRequests });
  const list = await app.handleMessage({ eventId: "f4", openId: "ou-1", chatId: "oc-1", text: "示例村所有PON口" });
  const page2 = await click(list, "pon-list-page", { page: 2 }, { chatId: "oc-1" });
  const detail = await click(page2, "pon-list-detail", { index: 1 }, { chatId: "oc-1" });
  assert.equal(detail.kind, "pon-detail");
  assert.match(JSON.stringify(renderReply(detail).content), /资料有误（村 \/ 小组 \/ 楼盘）/);
  const form = await app.handleCallback({ eventId: "f5", openId: "ou-1", chatId: "oc-1", verifiedByTransport: true,
    binding: { token: detail.placeFixQuery.token, index: 0, action: "pon-place-fix-open", expiresAt: detail.placeFixQuery.expiresAt } });
  assert.equal(form.pons.length, 1);
  const outOfLedger = await click(form, "place-fix-next", {}, { chatId: "oc-1", formValue: { pon: "0", village: "示例村" } });
  assert.equal(outOfLedger.step, "pon");
  assert.match(outOfLedger.notice, /不在 PON 台账里/);

  const otherDetail = await click(page2, "pon-list-detail", { index: 0 }, { chatId: "oc-1" });
  const defaultForm = await app.handleCallback({ eventId: "f6", openId: "ou-1", chatId: "oc-1", verifiedByTransport: true,
    binding: { token: otherDetail.placeFixQuery.token, index: 0, action: "pon-place-fix-open", expiresAt: otherDetail.placeFixQuery.expiresAt } });
  assert.equal(defaultForm.village, "示例村");

  const noApprover = setup({ editRequests: fakeEditRequests({ approver: null }) });
  const list2 = await noApprover.app.handleMessage({ eventId: "f7", openId: "ou-1", chatId: "oc-1", text: "示例村所有PON口" });
  const text = await noApprover.click(list2, "pon-list-fix", {}, { chatId: "oc-1" });
  assert.match(text.message, /还没有指定资料修改审批人/);
});

test("资料有误：第 1 步就能选当前村的小组；第 2 步默认选中它，没选时默认这个口现在的小组；换了村要重新选", async () => {
  const regions = [{ village: "示例村", name: "上坊小组", status: "active", userCount: 40, ponCount: 7 }, { village: "示例村", name: "下坊", status: "active", userCount: 5, ponCount: 1 }];
  const editRequests = fakeEditRequests();
  const { app, click } = setup({ regions, editRequests });
  const list = await app.handleMessage({ eventId: "g1", openId: "ou-1", chatId: "oc-1", text: "示例村所有PON口" });
  const form = await click(list, "pon-list-fix", {}, { chatId: "oc-1" });
  const step1 = cardJson(form).body.elements.find((element) => element.tag === "form").elements.filter((element) => element.tag === "select_static");
  assert.deepEqual(step1.map((element) => element.name), ["pon", "village", "region1"]);
  assert.equal(step1[2].required, false);
  assert.deepEqual(step1[2].options.map((option) => option.text.content), ["整村（不分小组）", "上坊小组", "下坊小组", "新小组（下一步填写名称）", "新小区 / 楼盘（下一步填写名称）"]);

  // 同村换小组：第 1 步选“下坊小组”，第 2 步默认选中它，直接提交。
  const step2 = await click(form, "place-fix-next", {}, { chatId: "oc-1", formValue: { pon: "0", village: "示例村", region1: "1" } });
  assert.equal(step2.regionInitial, "1");
  const regionSelect = cardJson(step2).body.elements.find((element) => element.tag === "form").elements.find((element) => element.name === "region");
  assert.equal(regionSelect.initial_option, "1");
  const submitted = await click(step2, "place-fix-submit", {}, { chatId: "oc-1", formValue: { region: step2.regionInitial } });
  assert.equal(submitted.kind, "edit-request-submitted");
  assert.equal(editRequests.submitted[0].proposedValue, "示例村/下坊小组");

  // 第 1 步没选小组：第 2 步默认这个口现在的小组。
  const form2 = await click(list, "pon-list-fix", {}, { chatId: "oc-1" });
  const unchosen = await click(form2, "place-fix-next", {}, { chatId: "oc-1", formValue: { pon: "0", village: "示例村" } });
  assert.equal(unchosen.regionInitial, "0");
  // 换了村还选了第 1 步的小组：提示重新选。
  const back = await click(unchosen, "place-fix-back", {}, { chatId: "oc-1" });
  const moved = await click(back, "place-fix-next", {}, { chatId: "oc-1", formValue: { pon: "0", village: "双岗村", region1: "1" } });
  assert.equal(moved.step, "place");
  assert.equal(moved.regionInitial, "all");
  assert.match(moved.notice, /村改成了双岗村，请在下面重新选小组/);
});
