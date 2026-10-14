import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-edit-requests-"));

const db = await import("../src/db.mjs");
const { createEditRequestService, parsePlaceInput } = await import("../src/edit-request-service.mjs");
const { createFeishuQueryApplication, parsePrimaryAddressEditRequest } = await import("../src/feishu/application.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");
const require = createRequire(import.meta.url);
const { normalizeCallback, renderReply } = require("../src/feishu/production-runtime.cjs");

const KNOWN = [
  { village: "厚街村", villageGroup: "下栅", community: "" },
  { village: "寮厦村", villageGroup: "", community: "卓越维港" },
  { village: "", villageGroup: "", community: "丰泰" }
];

test("解析外勤填写的归属和“一级地址应该是”说法", () => {
  assert.equal(parsePlaceInput("厚街村/下栅小组", KNOWN).label, "厚街村/下栅小组");
  assert.equal(parsePlaceInput("厚街村下栅小组", KNOWN).label, "厚街村/下栅小组");
  assert.equal(parsePlaceInput("下栅小组", KNOWN).label, "厚街村/下栅小组");
  assert.equal(parsePlaceInput("厚街村 上栅小组", KNOWN).label, "厚街村/上栅小组");
  assert.equal(parsePlaceInput("丰泰小区", KNOWN).label, "丰泰小区");
  assert.equal(parsePlaceInput("寮厦村卓越维港小区", KNOWN).label, "寮厦村/卓越维港小区");
  assert.equal(parsePlaceInput("厚街村", KNOWN).label, "厚街村");
  assert.throws(() => parsePlaceInput("上栅小组", KNOWN), /属于哪个村/);
  // 现场反馈：“新塘村/顺景大厦”原来会把“顺景大厦”丢掉，只剩“新塘村”。
  assert.equal(parsePlaceInput("新塘村/顺景大厦", KNOWN).label, "新塘村/顺景大厦小区");
  assert.equal(parsePlaceInput("新塘村顺景大厦", KNOWN).label, "新塘村/顺景大厦小区");
  assert.equal(parsePlaceInput("寮厦村/卓越维港", KNOWN).label, "寮厦村/卓越维港小区");
  assert.equal(parsePlaceInput("厚街村/下栅", KNOWN).label, "厚街村/下栅小组");
  assert.equal(parsePlaceInput("新塘村/君汇小区", KNOWN).label, "新塘村/君汇小区");
  assert.throws(() => parsePlaceInput("厚街村/向北", KNOWN), /“向北”是小组还是小区/);
  assert.throws(() => parsePlaceInput("", KNOWN), /请填写/);

  assert.deepEqual(parsePrimaryAddressEditRequest("君汇那个口的一级地址应该是顺景大厦"), { previous: "君汇", next: "顺景大厦", place: "", explicit: true });
  assert.deepEqual(parsePrimaryAddressEditRequest("君汇的一级地址改为 顺景大厦。"), { previous: "君汇", next: "顺景大厦", place: "", explicit: true });
  assert.equal(parsePrimaryAddressEditRequest("查一下君汇的一级地址"), null);
  assert.equal(parsePrimaryAddressEditRequest("厚街村抢修"), null);
});

function store() {
  let value = { ...emptyFeishuState(), enabled: true };
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); }
  };
}

function gateway() {
  return {
    async listOlts() { return [{ oltId: "olt-1", name: "厚街C300", vendor: "zte", model: "C300", enabled: true }]; },
    async queryUsers() {
      return { authorizedCount: 1, candidates: [{
        candidateId: "olt-1:1/7/8:1", oltId: "olt-1", oltName: "厚街C300", name: "用户1", phone: "",
        address: "厚街镇东宝路1号", primaryAddress: "君汇", loid: "L1", mac: "",
        onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, snapshotAt: null
      }] };
    },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async readOnuDetail(request) {
      return {
        oltId: request.oltId, onu: request.coordinate, observedAt: "2026-10-13T00:00:01.000Z", unsupportedFields: [],
        status: { phase: "online", rxPower: "-20 dBm", distance: "1 km", serial: "SN-1", name: "用户1" },
        detail: {
          interface: "1/7/8/1", name: "用户1", phaseState: "在线", serialNumber: "SN-1", opticalRxPower: "-20 dBm",
          distance: "1 km", lastOnlineTime: null, lastOfflineTime: null, lastOfflineCause: null, lastOfflineCauseCode: null
        }
      };
    }
  };
}

test("资料修改申请：外勤在用户卡片提交，只有审批人能同意，同意后改一级地址（归属跟着搬）和台账行归属", async () => {
  await db.initDb();
  await db.replaceOlts([{ id: "olt-1", name: "厚街C300", vendor: "zte", model: "C300", version: "v", host: "10.0.0.9", snmpPort: 161, readCommunity: "public", enabled: true }]);
  await db.replacePonPorts([
    { oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "8", address: "君汇" },
    { oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "9", address: "陈屋 A" },
    { oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "9", address: "陈屋 B" }
  ]);
  await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "7", pon: "8", address: "君汇", village: "厚街村" });
  const backup = { path: "/b.sqlite", bytes: 1, sha256: "s" };
  const rows = [1, 2].map((onuId) => ({
    oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "8", onuId: String(onuId), onuIndexDisplay: `1/7/8:${onuId}`,
    loid: `L${onuId}`, loidDisplay: `L${onuId}`, username: `用户${onuId}`, usernameSource: "nmse", userPhone: "",
    installationAddress: "厚街镇东宝路1号", deviceType: "", ponType: "", phase: "", rxPower: "", distance: "", nmseOltIp: "", nmseOnuIndex: ""
  }));
  await db.replaceMergedOnuDataset({ runId: `edit-${Date.now()}`, operation: "merge", backup, conflicts: [], networkCount: rows.length, nmseCount: 0, rows });
  await db.recordFeishuQueryLog({ openId: "ou-admin", userName: "管理员甲", chatId: "oc-admin", text: "帮助" });
  await db.recordFeishuQueryLog({ openId: "ou-1", userName: "外勤乙", chatId: "oc-direct", text: "查用户" });

  let clock = Date.parse("2026-10-13T01:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const tick = () => { clock += 11_000; };
  const service = createEditRequestService({
    ...db,
    getOlts: () => db.getOlts(),
    lookupUserName: async (openId) => (await db.getFeishuKnownUsers()).find((user) => user.openId === openId)?.name || "",
    now: () => new Date(clock)
  });
  const sent = [];
  const app = createFeishuQueryApplication({
    stateStore: store(),
    gateway: gateway(),
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户1" }),
    editRequests: service,
    send: async (chatId, reply, options) => { sent.push({ chatId, reply, options }); },
    now
  });
  const callback = (eventId, openId, chatId, binding, formValue) => {
    tick();
    return app.handleCallback({ eventId, kind: "callback", verifiedByTransport: true, openId, chatId, binding, ...(formValue ? { formValue } : {}), messageId: `msg-${eventId}` });
  };

  // 没有审批人时提示先指定。
  const detail = await app.handleMessage({ eventId: "evt-1", openId: "ou-1", chatId: "oc-direct", text: "查用户1" });
  assert.equal(detail.kind, "onu-detail");
  assert.ok(detail.editQuery?.token);
  const noApprover = await callback("cb-0", "ou-1", "oc-direct", { token: detail.editQuery.token, index: 0, action: "onu-edit-open", expiresAt: detail.editQuery.expiresAt });
  assert.match(noApprover.message, /还没有指定资料修改审批人/);

  await db.saveEditApprover({ openId: "ou-admin", name: "管理员甲" });
  const form = await callback("cb-1", "ou-1", "oc-direct", { token: detail.editQuery.token, index: 0, action: "onu-edit-open", expiresAt: detail.editQuery.expiresAt });
  assert.equal(form.kind, "onu-edit-form");
  assert.deepEqual(form.rows, ["君汇"]);
  assert.equal(form.place, "厚街村");
  assert.equal(form.approverName, "管理员甲");
  const formCard = JSON.parse(JSON.stringify(renderReply(form).content));
  assert.equal(formCard.schema, "2.0");
  const formBlock = formCard.body.elements.find((element) => element.tag === "form");
  assert.deepEqual(formBlock.elements.filter((element) => element.tag === "input").map((element) => [element.name, element.default_value]), [["primaryAddress", "君汇"], ["place", "厚街村"]]);
  assert.equal(formBlock.elements.at(-1).form_action_type, "submit");
  assert.equal(formBlock.elements.at(-1).behaviors[0].value.action, "onu-edit-submit");

  // 什么都没改不提交。
  const nothing = await callback("cb-2", "ou-1", "oc-direct", { token: form.form.token, index: 0, action: "onu-edit-submit" }, { primaryAddress: "君汇", place: "厚街村" });
  assert.match(nothing.message, /没有修改任何内容/);

  sent.length = 0;
  const submitted = await callback("cb-3", "ou-1", "oc-direct", { token: form.form.token, index: 0, action: "onu-edit-submit" }, { primaryAddress: "顺景大厦", place: "厚街村下栅小组" });
  assert.equal(submitted.kind, "edit-request-submitted");
  assert.equal(submitted.lines.length, 2);
  const approvals = sent.filter((item) => item.reply.kind === "edit-request-approval");
  assert.equal(approvals.length, 2);
  assert.ok(approvals.every((item) => item.chatId === "ou-admin" && item.options.receiveIdType === "open_id"));
  assert.equal(sent.at(-1).options.replaceOriginal, true);
  const [addressCard, placeCard] = approvals.map((item) => item.reply);
  assert.equal(addressCard.request.previousValue, "君汇");
  assert.equal(addressCard.request.requesterName, "外勤乙");
  assert.equal(placeCard.request.proposedValue, "厚街村/下栅小组");
  assert.equal(JSON.stringify(addressCard).includes("10.0.0.9"), false);
  const approvalCard = renderReply(addressCard).content;
  assert.equal(approvalCard.schema, "2.0");
  const approvalForm = approvalCard.body.elements.find((element) => element.tag === "form");
  const approvalButtons = approvalForm.elements[1].columns.map((column) => column.elements[0].behaviors[0].value.action);
  assert.deepEqual(approvalButtons, ["edit-request-approve", "edit-request-reject"]);
  assert.equal(approvalForm.elements[0].default_value, "顺景大厦");
  // 同一张表单不能重复提交。
  const again = await callback("cb-4", "ou-1", "oc-direct", { token: form.form.token, index: 0, action: "onu-edit-submit" }, { primaryAddress: "顺景大厦", place: "" });
  assert.match(again.message, /已经提交过了/);

  // 不是审批人：拒绝。
  const forbidden = await callback("cb-5", "ou-1", "oc-direct", { token: addressCard.decision.token, index: 0, action: "edit-request-approve" }, { value: "顺景大厦" });
  assert.match(forbidden.message, /只有指定的资料修改审批人/);
  assert.equal((await db.getPonLedgerRows({ oltIp: "10.0.0.9", board: "7", pon: "8" }))[0].address, "君汇");

  // 审批人先改正再同意。
  sent.length = 0;
  const approved = await callback("cb-6", "ou-admin", "oc-admin", { token: addressCard.decision.token, index: 0, action: "edit-request-approve" }, { value: "顺景大厦 A座" });
  assert.equal(approved.kind, "edit-request-decided");
  assert.equal(approved.request.status, "approved");
  assert.equal(approved.request.finalValue, "顺景大厦 A座");
  assert.equal((await db.getPonLedgerRows({ oltIp: "10.0.0.9", board: "7", pon: "8" }))[0].address, "顺景大厦 A座");
  const assignments = (await db.getPortPlaceAssignments()).filter((item) => item.board === "7" && item.pon === "8");
  assert.deepEqual(assignments.map((item) => [item.address, item.village]), [["顺景大厦A座", "厚街村"]]);
  const notice = sent.find((item) => item.reply.kind === "edit-request-notice");
  assert.equal(notice.chatId, "oc-direct");
  assert.match(JSON.stringify(renderReply(notice.reply).content), /你的一级地址修改已同意/);
  // 重复点同意：已处理。
  const repeated = await callback("cb-7", "ou-admin", "oc-admin", { token: addressCard.decision.token, index: 0, action: "edit-request-approve" }, { value: "别的" });
  assert.equal(repeated.request.status, "approved");
  assert.equal((await db.getPonLedgerRows({ oltIp: "10.0.0.9", board: "7", pon: "8" }))[0].address, "顺景大厦 A座");

  // 归属改的是台账行：一级地址先被改名，待审批的归属申请跟着改到新地址；原值被别人改过时先提示，再同意按新原值修改。
  assert.equal(placeCard.request.kind, "row-place");
  assert.equal((await db.getEditRequest({ token: placeCard.decision.token })).rowAddress, "顺景大厦 A座");
  await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "7", pon: "8", address: "顺景大厦 A座", village: "陈屋村" });
  const conflict = await callback("cb-8", "ou-admin", "oc-admin", { token: placeCard.decision.token, index: 0, action: "edit-request-approve" }, { value: "厚街村/下栅小组" });
  assert.equal(conflict.kind, "edit-request-approval");
  assert.match(conflict.warning, /原值已变为“陈屋村”/);
  assert.equal(conflict.request.previousValue, "陈屋村");
  const placeApproved = await callback("cb-9", "ou-admin", "oc-admin", { token: placeCard.decision.token, index: 0, action: "edit-request-approve" }, { value: "厚街村/下栅小组" });
  assert.equal(placeApproved.request.status, "approved");
  await db.ensurePlaceAssignments();
  assert.deepEqual((await db.getPortPlaceAssignments()).filter((item) => item.board === "7" && item.pon === "8").map((item) => [item.address, item.label]), [["顺景大厦A座", "厚街村/下栅小组"]]);
  // 整行用户都按台账行归属算，不写单户修正。
  assert.deepEqual(await db.getOnuPlace({ oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "8", onuId: "2" }), { loid: "L2", village: "厚街村", villageGroup: "下栅", community: "" });
  assert.equal((await db.getPlaceOverrides()).some((item) => item.loid === "L1"), false);
  assert.match(placeApproved.message, /这一行的归属由“陈屋村”改为“厚街村\/下栅小组”/);

  // 直接说“……的一级地址应该是……”：多行时让外勤选行；驳回后通知外勤。
  tick();
  const nl = await app.handleMessage({ eventId: "evt-2", openId: "ou-1", chatId: "oc-direct", text: "陈屋那个口的一级地址应该是陈屋新村" });
  assert.equal(nl.kind, "onu-edit-form");
  assert.equal(nl.rows.length, 2);
  assert.equal(nl.defaultPrimaryAddress, "陈屋新村");
  const nlCard = renderReply(nl).content.body.elements.find((element) => element.tag === "form");
  assert.equal(nlCard.elements.some((element) => element.tag === "select_static"), true);
  assert.equal(nlCard.elements.some((element) => element.name === "place"), true);
  sent.length = 0;
  await callback("cb-10", "ou-1", "oc-direct", { token: nl.form.token, index: 0, action: "onu-edit-submit" }, { row: "1", primaryAddress: "陈屋新村" });
  const nlApproval = sent.find((item) => item.reply.kind === "edit-request-approval").reply;
  assert.equal(nlApproval.request.previousValue, "陈屋 B");
  sent.length = 0;
  const rejected = await callback("cb-11", "ou-admin", "oc-admin", { token: nlApproval.decision.token, index: 0, action: "edit-request-reject" }, { value: "陈屋新村" });
  assert.equal(rejected.request.status, "rejected");
  assert.equal(sent.find((item) => item.reply.kind === "edit-request-notice").reply.request.status, "rejected");
  assert.deepEqual((await db.getPonLedgerRows({ oltIp: "10.0.0.9", board: "7", pon: "9" })).map((row) => row.address), ["陈屋 A", "陈屋 B"]);

  const none = await app.handleMessage({ eventId: "evt-3", openId: "ou-1", chatId: "oc-direct", text: "不存在的地方的一级地址应该是新地址" });
  assert.match(none.message, /没有找到一级地址包含/);

  const history = await db.getEditRequests();
  assert.deepEqual(history.map((item) => item.status).sort(), ["approved", "approved", "rejected"]);
});

test("飞书回调带出表单字段：只保留合法字段名和字符串值", () => {
  const event = normalizeCallback({
    event_id: "e1",
    operator: { open_id: "ou-1" },
    context: { open_chat_id: "oc-1", open_message_id: "m1" },
    action: {
      value: { token: "t", index: 0, action: "onu-edit-submit" },
      form_value: { primaryAddress: "顺景大厦", place: "厚街村", "bad key": "x", nested: { a: 1 } }
    }
  });
  assert.deepEqual(event.formValue, { primaryAddress: "顺景大厦", place: "厚街村" });
  assert.equal(event.binding.action, "onu-edit-submit");
});

test("口语说法“把君汇小区换成顺景大厦，属于新塘村”识别为修改候选", async () => {
  const { parseLedgerEditRequest } = await import("../src/feishu/application.mjs");
  assert.deepEqual(parseLedgerEditRequest("可以将君汇小区换成顺景大厦吗？属于新塘村"), { previous: "君汇小区", next: "顺景大厦", place: "新塘村", explicit: false });
  assert.deepEqual(parseLedgerEditRequest("把君汇改成顺景大厦，归新塘村"), { previous: "君汇", next: "顺景大厦", place: "新塘村", explicit: false });
  assert.deepEqual(parseLedgerEditRequest("麻烦把君汇改为顺景大厦"), { previous: "君汇", next: "顺景大厦", place: "", explicit: false });
  assert.equal(parseLedgerEditRequest("君汇的一级地址改为顺景大厦").explicit, true);
  assert.equal(parseLedgerEditRequest("顺景大厦"), null);
  assert.equal(parseLedgerEditRequest("厚街村抢修情况"), null);
});

test("口语修改申请：台账里找到才发表单并带上归属，找不到按普通查询处理", async () => {
  await db.initDb();
  await db.replaceOlts([{ id: "olt-1", name: "厚街C300", vendor: "zte", model: "C300", version: "v", host: "10.0.0.9", snmpPort: 161, readCommunity: "public", enabled: true }]);
  await db.replacePonPorts([{ oltIp: "10.0.0.9", chassis: "1", board: "3", pon: "5", address: "君汇" }]);
  await db.saveEditApprover({ openId: "ou-admin", name: "管理员甲" });
  const service = createEditRequestService({ ...db, getOlts: () => db.getOlts() });
  const sent = [];
  let queried = 0;
  const app = createFeishuQueryApplication({
    stateStore: store(),
    gateway: { ...gateway(), queryUsers: async () => { queried += 1; return { authorizedCount: 0, candidates: [] }; } },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "x" }),
    editRequests: service,
    send: async (chatId, reply, options) => { sent.push({ chatId, reply, options }); },
    now: () => "2026-10-13T05:00:00.000Z"
  });
  const form = await app.handleMessage({ eventId: "nl-1", openId: "ou-1", chatId: "oc-direct", text: "可以将君汇小区换成顺景大厦吗？属于新塘村" });
  assert.equal(form.kind, "onu-edit-form");
  assert.equal(form.defaultPrimaryAddress, "顺景大厦");
  assert.equal(form.place, "新塘村");
  assert.equal(queried, 0);
  const formCard = renderReply(form).content.body.elements.find((element) => element.tag === "form");
  assert.deepEqual(formCard.elements.filter((element) => element.tag === "input").map((element) => [element.name, element.default_value]), [["primaryAddress", "顺景大厦"], ["place", "新塘村"]]);
  sent.length = 0;
  const submitted = await app.handleCallback({ eventId: "nl-cb", kind: "callback", verifiedByTransport: true, openId: "ou-1", chatId: "oc-direct", messageId: "m", binding: { token: form.form.token, index: 0, action: "onu-edit-submit" }, formValue: { primaryAddress: "顺景大厦", place: "新塘村" } });
  assert.equal(submitted.lines.length, 2);
  const kinds = sent.filter((item) => item.reply.kind === "edit-request-approval").map((item) => item.reply.request.kind);
  assert.deepEqual(kinds, ["primary-address", "row-place"]);
  // 台账里没有的：按普通查询处理，不拦截。
  const normal = await app.handleMessage({ eventId: "nl-2", openId: "ou-2", chatId: "oc-direct", text: "把张三的电话改成13800138000" });
  assert.notEqual(normal.kind, "onu-edit-form");
  assert.equal(queried > 0, true);
});
