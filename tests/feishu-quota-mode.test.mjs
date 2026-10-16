import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import XLSX from "xlsx";
import { buildPriceBookWorkbook, buildTemplateWorkbook } from "./fixtures/quota-fixtures.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-feishu-quota-"));

const db = await import("../src/db.mjs");
const { createQuotaService } = await import("../src/quota/quota-service.mjs");
const { createFeishuQueryApplication } = await import("../src/feishu/application.mjs");
const { QUOTA_MENU_KEY, isQuotaEntry } = await import("../src/feishu/quota-mode.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");
const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

await db.initDb();
const quotaService = createQuotaService({ repo: db, now: () => new Date(2026, 9, 16, 10, 0) });
await quotaService.importTemplate({ fileName: "模板.xlsx", buffer: buildTemplateWorkbook() });
await quotaService.importMaterials({ fileName: "单价.xlsx", buffer: buildPriceBookWorkbook() });

/** 卡片里每排并排的按钮（column_set 里的按钮文字）。 */
function rowsOf(content) {
  const rows = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.tag === "column_set") {
      const texts = node.columns.flatMap((column) => column.elements.filter((element) => element.tag === "button").map((element) => element.text.content));
      if (texts.length) rows.push(texts);
    }
    Object.values(node).forEach(walk);
  };
  walk(content);
  return rows;
}

/** 手机上一排按钮的字要完整显示：3 个一排每个 ≤ 3 字，2 个一排 ≤ 5 字，最多 3 个一排。 */
function assertButtonsReadable(content, kind) {
  for (const row of rowsOf(content)) {
    if (row.length < 2) continue;
    const limit = row.length >= 3 ? 3 : 5;
    assert.ok(row.length <= 3 && row.every((text) => [...text].length <= limit), `${kind}: ${row.join(" / ")}`);
  }
}

function harness({ quotaModel = null } = {}) {
  let state = { ...emptyFeishuState(), enabled: true };
  let clock = Date.parse("2026-10-16T02:00:00.000Z");
  const sent = [];
  let counter = 0;
  const app = createFeishuQueryApplication({
    stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
    gateway: {
      listOlts: async () => [],
      queryUsers: async () => ({ authorizedCount: 0, candidates: [] }),
      queryPons: async () => ({ authorizedCount: 0, candidates: [] })
    },
    interpret: async () => ({ type: "clarification", version: 1, question: "请补充" }),
    quotaService,
    quotaModel,
    send: async (chatId, reply, options) => { sent.push({ chatId, reply, options }); return `om-${sent.length}`; },
    // 每次取时间前进 3 秒，避开每人 10 秒 3 条的限流
    now: () => new Date((clock += 3000)).toISOString()
  });
  const say = (text, openId = "ou-1") => app.handleMessage({ eventId: `m-${counter += 1}`, openId, chatId: "oc-1", kind: "direct", text });
  const click = (reply, action, { index = 0, formValue, openId = "ou-1" } = {}) => app.handleCallback({
    eventId: `c-${counter += 1}`, openId, chatId: "oc-1", messageId: "om-card", verifiedByTransport: true,
    binding: { token: reply.action.token, index, action, expiresAt: reply.action.expiresAt },
    ...(formValue ? { formValue } : {})
  });
  return { app, sent, say, click };
}

test("进入定额模式的说法", () => {
  assert.equal(isQuotaEntry("定额模式"), true);
  assert.equal(isQuotaEntry("进入定额模式"), true);
  assert.equal(isQuotaEntry("做预算"), true);
  assert.equal(isQuotaEntry("张三"), false);
  assert.equal(QUOTA_MENU_KEY, "quota-mode");
});

test("飞书定额模式：菜单进入、新建预算、录定额 / 材料 / 管道、改清单、改基础信息、生成预算书、退出", async () => {
  const { app, sent, say, click } = harness();
  const home = await app.handleMenu({ eventId: "menu-1", openId: "ou-1", eventKey: QUOTA_MENU_KEY });
  assert.equal(home.kind, "quota-home");
  assert.deepEqual(sent.at(-1).options, { receiveIdType: "open_id" });

  const form = await click(home, "quota-new");
  assert.equal(form.kind, "quota-create-form");
  assert.equal(form.presets.length, 1);
  const missing = await click(form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "飞书测试工程", location: "", preparer: "张三", reviewer: "李四" } });
  assert.match(missing.message, /请填写建设地点/);
  const created = await click(form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "飞书测试工程", location: "测试社区", preparer: "张三", reviewer: "李四" } });
  assert.equal(created.kind, "quota-summary");
  assert.match(created.note, /已新建“飞书测试工程”/);
  assert.deepEqual(sent.at(-1).options, { messageId: "om-card", replaceOriginal: true });

  let confirm = await say("3个光缆开端");
  assert.equal(confirm.kind, "quota-confirm");
  assert.match(confirm.candidates[0].title, /光缆端开缆/);
  assert.equal((await click(confirm, "quota-cancel")).title, "已取消");
  confirm = await say("3个光缆开端");
  assert.match((await click(confirm, "quota-confirm")).note, /已记入人工/);
  assert.match((await click(confirm, "quota-confirm")).message, /已经加入过/);

  confirm = await say("架空敷设24芯光缆200米利旧");
  assert.match(confirm.candidates[0].title, /架空光缆敷设 36芯以下/);
  assert.match(confirm.candidates[0].detail, /0\.2千米 · 利旧 7 折/);
  await click(confirm, "quota-confirm");

  confirm = await say("24芯熔接24芯");
  assert.match(confirm.candidates[0].title, /光缆接续 48芯以下/);
  await click(confirm, "quota-confirm");

  confirm = await say("24芯光缆800米 架空用");
  assert.equal(confirm.title, "加入材料 · 请确认");
  assert.match(confirm.candidates[0].detail, /14010162 · 800米/);
  assert.equal((await click(confirm, "quota-confirm", { openId: "ou-other" })).message, "这张卡片是别人发起的，请自己说一次。");
  await click(confirm, "quota-confirm");

  confirm = await say("顶管2孔15米");
  assert.equal(confirm.title, "加入管道工程量 · 请确认");
  await click(confirm, "quota-confirm");

  let summary = await say("清单");
  assert.equal(summary.kind, "quota-summary");
  assert.equal(summary.quotaRows.length, 3);
  assert.match(summary.quotaRows[0], /^1\. 光缆端开缆 × 3端 = 179\.40$/);
  assert.match(summary.quotaRows[1], /利旧/);
  assert.match(summary.materialRows[0], /^1\. 光缆 GYTS-24B1#, 24芯 × 800米（架空用） = 2,226\.96（含税）$/);
  assert.equal(summary.pipeRows.length, 3);

  assert.match((await say("第1项改成4")).message, /人工和材料都有第 1 项/);
  summary = await say("人工1改成4");
  assert.equal(summary.note, "已把人工第 1 项改成 4端");
  assert.match(summary.quotaRows[0], /× 4端 = 239\.20$/);
  summary = await say("删除第3项");
  assert.equal(summary.quotaRows.length, 2);
  summary = await say("地区类别改成三类");
  assert.equal(summary.note, "已把地区类别改成“三类地区”");
  assert.match(summary.quotaRows[0], /= 215\.28$/);
  assert.match((await say("工程编号改成123")).message, /规建部门/);
  assert.match((await say("第9项改成1")).message, /清单里没有第 9 项/);
  assert.match((await say("材料2改成1")).message, /材料里没有第 2 项/);

  const before = sent.length;
  const done = await say("生成预算书");
  // 这份人工 + 监理费（含税）超过 3000：标题、清单都提示上 OA
  assert.equal(done.title, "预算书已生成 · 需上 OA");
  assert.match(done.alert, /^项目人工超过 3000，需要上 OA 系统（人工 \+ 监理费 \+ 安全生产费含税 \d/);
  assert.doesNotMatch(done.message, /<font/);
  assert.match(JSON.stringify(renderReply(done).content), /<font color='red'>\*\*项目人工超过 3000/);
  assert.match((await say("清单")).oaNotice, /^项目人工超过 3000，需要上 OA 系统（人工 \+ 监理费 \+ 安全生产费含税 \d/);
  const file = sent.slice(before).find((item) => item.reply.kind === "quota-file");
  assert.match(file.reply.fileName, /^飞书测试工程-预算书-\d{8}\.xlsx$/);
  const workbook = XLSX.read(file.reply.data);
  assert.equal(workbook.Sheets["项目基础信息表"].D4.v, "飞书测试工程");
  assert.equal(workbook.Sheets["工程费用预算表（表二）"].B7.v, "YGWX-3-22");

  // 所有卡片都能渲染成飞书 JSON 2.0
  for (const { reply } of sent) {
    if (reply.kind === "quota-file") continue;
    const card = renderReply(reply);
    assert.equal(card.msgType, "interactive", reply.kind);
    assert.equal(card.content.schema, "2.0", reply.kind);
    assertButtonsReadable(card.content, reply.kind);
  }

  const exited = await say("退出");
  assert.equal(exited.title, "已退出定额模式");
  const afterExit = await say("3个光缆开端");
  assert.notEqual(afterExit.kind, "quota-confirm");
});

test("没选预算时先提示新建或打开；过期 / 伪造的按钮给出提示", async () => {
  const { sent, say, click } = harness();
  await say("定额模式");
  const prompt = await say("3个光缆开端", "ou-1");
  assert.equal(prompt.kind, "quota-home");
  assert.ok(sent.some((item) => item.reply.title === "还没有选预算"));
  const reply = await click({ action: { token: "fake", expiresAt: "2026-10-16T03:00:00.000Z" } }, "quota-confirm");
  assert.match(reply.message, /已过期/);
});

test("本地拿不准时先发“正在理解”，大模型选好后替换成确认卡片；确认后学到，下次直接用", async () => {
  let modelCalls = 0;
  const quotaModel = async ({ user }) => {
    modelCalls += 1;
    const { candidates } = JSON.parse(user);
    const id = Object.entries(candidates).find(([, label]) => label.startsWith("YGWX-3-22"))[0];
    return `{"kind":"quota","id":"${id}","quantity":3,"unit":"个"}`;
  };
  const { app, sent, say, click } = harness({ quotaModel });
  const home = await app.handleMenu({ eventId: "menu-model", openId: "ou-1", eventKey: QUOTA_MENU_KEY });
  const form = await click(home, "quota-new");
  await click(form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "大模型测试", location: "测试", preparer: "张三", reviewer: "李四" } });

  const before = sent.length;
  const confirm = await say("做3个光缆头");
  const thinking = sent.slice(before).find((item) => item.reply.title === "正在理解");
  assert.ok(thinking);
  const replaced = sent.at(-1);
  assert.equal(replaced.reply.kind, "quota-confirm");
  assert.equal(replaced.options.replaceOriginal, true);
  assert.equal(replaced.options.messageId, `om-${sent.indexOf(thinking) + 1}`);
  assert.match(confirm.candidates[0].title, /光缆端开缆/);
  assert.match(confirm.candidates[0].note, /大模型理解/);
  assert.equal(modelCalls, 1);
  await click(confirm, "quota-confirm");

  const again = await say("做2个光缆头");
  assert.equal(again.kind, "quota-confirm");
  assert.match(again.candidates[0].note, /按学过的说法/);
  assert.match(again.candidates[0].detail, /2端/);
  assert.equal(modelCalls, 1);

  // 本地拿得准的说法不问大模型
  await say("3个光缆端开缆");
  assert.equal(modelCalls, 1);
});


test("一句话说几条：拆开合成一张卡片，全部加入；上一步整批撤销；纠正数量；提问给清单；闲聊不乱给候选", async () => {
  let modelCalls = 0;
  const { app, say, click } = harness({ quotaModel: async () => { modelCalls += 1; return "{\"kind\":\"unknown\"}"; } });
  const home = await app.handleMenu({ eventId: "menu-batch", openId: "ou-1", eventKey: QUOTA_MENU_KEY });
  const form = await click(home, "quota-new");
  await click(form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "多条测试", location: "测试", preparer: "张三", reviewer: "李四" } });

  const batch = await say("人工：4端开缆，架空光缆300米；材料：24芯光缆300米，架空用");
  assert.equal(batch.kind, "quota-batch");
  assert.equal(batch.items.length, 3);
  assert.match(batch.items[0].title, /^人工：光缆端开缆/);
  assert.match(batch.items[0].detail, /4端/);
  assert.match(batch.items[1].title, /^人工：架空光缆敷设/);
  assert.match(batch.items[1].detail, /0\.3千米/);
  assert.match(batch.items[2].title, /^材料：光缆 GYTS-24B1#, 24芯/);
  assert.match(batch.items[2].detail, /300米/);
  const added = await click(batch, "quota-batch-confirm");
  assert.match(added.note, /已记入 3 条/);
  let summary = await say("清单");
  assert.equal(summary.quotaRows.length, 2);
  assert.equal(summary.materialRows.length, 1);
  assert.match(summary.materialRows[0], /（架空用）/);

  summary = await say("是架空光缆敷设500米，不是300米");
  assert.match(summary.note, /架空光缆敷设.*改成 0\.5千米/);
  summary = await say("材料是多少？");
  assert.equal(summary.kind, "quota-summary");
  summary = await say("上一步");
  assert.match(summary.note, /已撤销/);
  assert.equal(summary.quotaRows.length, 0);
  assert.equal(summary.materialRows.length, 0);
  assert.match((await say("上一步")).message, /没有可以撤销/);

  const chat = await say("你怎么傻傻的");
  assert.equal(chat.title, "没听懂");
  assert.equal(modelCalls, 0);
});

test("表单为主：清单上点＋人工 / ＋材料 / 管道 / 改，都用表单选，填错给提示", async () => {
  const { app, sent, click } = harness();
  const home = await app.handleMenu({ eventId: "menu-form", openId: "ou-1", eventKey: QUOTA_MENU_KEY });
  const form = await click(home, "quota-new");
  let summary = await click(form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "表单测试", location: "测试", preparer: "张三", reviewer: "李四" } });

  // ＋人工：常用项 → 这一项的各档
  const picker = await click(summary, "quota-add-quota");
  assert.equal(picker.kind, "quota-picker");
  assert.deepEqual(picker.common.slice(0, 3), ["光缆端开缆", "架空光缆敷设", "光缆接续"]);
  const aerial = await click(picker, "quota-pick-group", { index: 1 });
  assert.equal(aerial.kind, "quota-item-form");
  assert.deepEqual(aerial.options.map((option) => option.value), ["YGWX-3-09", "YGWX-3-10", "YGWX-3-11"]);
  assert.equal(aerial.reusable, true);
  assert.match(aerial.unitHint, /按米填/);
  const missing = await click(aerial, "quota-quota-submit", { formValue: { item: "YGWX-3-10", quantity: "", reuse: "否" } });
  assert.match(missing.message, /请填数量/);
  // 加完一项回到选人工（不回清单），接着选
  let next = await click(aerial, "quota-quota-submit", { formValue: { item: "YGWX-3-10", quantity: "300", reuse: "是" } });
  assert.equal(next.kind, "quota-picker");
  assert.match(next.note, /YGWX-3-10 × 0\.3千米（利旧）/);
  assert.deepEqual(next.added, ["1. 架空光缆敷设 36芯以下 × 0.3千米（利旧）"]);
  assert.match((await click(aerial, "quota-quota-submit", { formValue: { item: "YGWX-3-10", quantity: "300" } })).message, /已经提交过/);

  // 按分类选：同一张表单列这一类所有档位
  const category = await click(picker, "quota-pick-category", { index: 0 });
  assert.ok(category.options.some((option) => option.text.startsWith("光缆端开缆")));
  next = await click(category, "quota-quota-submit", { formValue: { item: "YGWX-3-22", quantity: "4" } });
  assert.equal(next.added.length, 2);
  assert.match(next.added[1], /光缆端开缆 × 4端/);
  const notReusable = await click(await click(picker, "quota-pick-category", { index: 0 }), "quota-quota-submit", { formValue: { item: "YGWX-3-22", quantity: "1", reuse: "是" } });
  assert.match(notReusable.message, /只有光缆敷设/);

  // 人工选好了 → 直接到常用材料表单；表单很短（选材料、数量、用途、加入），分类在“换分类”卡片里
  const materials = await click(next, "quota-add-material");
  assert.equal(materials.kind, "quota-item-form");
  assert.deepEqual(materials.options.map((option) => option.value), ["14010162", "15039746"]);
  const fieldNames = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.tag === "form") node.elements.forEach((element) => fieldNames.push(element.name));
    else Object.values(node).forEach(walk);
  })(renderReply(materials).content);
  assert.deepEqual(fieldNames, ["item", "quantity", "use", "submit"]);
  next = await click(materials, "quota-material-submit", { formValue: { item: "14010162", quantity: "500", use: "管道用" } });
  assert.equal(next.kind, "quota-item-form");
  assert.equal(next.section, "material");
  assert.match(next.added[0], /光缆 GYTS-24B1#, 24芯 × 500米（管道用）/);
  summary = await click(next, "quota-summary");
  assert.equal(summary.quotaRows.length, 2);
  assert.equal(summary.materialRows.length, 1);
  const sheets = await click(next, "quota-material-sheets");
  assert.equal(sheets.kind, "quota-material-sheets");
  assert.ok(sheets.sheets.length > 0);
  const sheetForm = await click(sheets, "quota-pick-sheet", { index: 0 });
  assert.equal(sheetForm.fromSheet, true);
  // 清单每条两行：名称、数量和金额；合计分行列出
  assert.equal(summary.quotaItems[0].title, "1. 架空光缆敷设 36芯以下");
  assert.match(summary.quotaItems[0].detail, /^0\.3千米 · 利旧 · [\d,.]+ 元$/);
  assert.match(summary.materialItems[0].detail, /^500米 · 管道用 · 含税 [\d,.]+ 元$/);
  assert.deepEqual(summary.totalsList.map((line) => line.split(" ")[0]), ["人工", "材料", "监理费", "安全生产费"]);

  // 改：人工换档、改数量（按米填），材料改数量和备注；删除
  let edit = await click(summary, "quota-edit", { index: 0 });
  assert.equal(edit.kind, "quota-edit-form");
  assert.equal(edit.quantity, "300");
  assert.equal(edit.initial, "YGWX-3-10");
  summary = await click(edit, "quota-edit-submit", { formValue: { item: "YGWX-3-11", quantity: "450", reuse: "否", remark: "" } });
  assert.match(summary.quotaRows[0], /^1\. 架空光缆敷设 72芯以下 × 0\.45千米 = /);
  edit = await click(summary, "quota-edit", { index: 2 });
  assert.equal(edit.section, "material");
  summary = await click(edit, "quota-edit-submit", { formValue: { quantity: "600", use: "", remark: "备用" } });
  assert.match(summary.materialRows[0], /× 600米（备用）/);
  edit = await click(summary, "quota-edit", { index: 1 });
  summary = await click(edit, "quota-edit-delete");
  assert.equal(summary.note, "已删除这条人工");
  assert.equal(summary.quotaRows.length, 1);

  // 基础信息卡片带返回菜单
  const info = await click(summary, "quota-info");
  assert.equal(info.kind, "quota-info");
  assert.ok(info.lines.some((line) => line.startsWith("项目名称：表单测试")));
  summary = await click(info, "quota-summary");
  assert.equal(summary.kind, "quota-summary");

  // 管道表单：填哪项算哪项
  const pipe = await click(summary, "quota-pipe");
  assert.equal(pipe.kind, "quota-pipe-form");
  assert.match((await click(pipe, "quota-pipe-submit", { formValue: {} })).message, /至少填一项/);
  summary = await click(pipe, "quota-pipe-submit", { formValue: { trenchRoad: "混凝土路面250mm以下", trenchLength: "30", jackingHoles: "2", jackingLength: "15", wellType: "单页井", wellRoad: "普通土", wellCount: "2" } });
  assert.match(summary.note, /开挖混凝土路面250mm以下 30 米，顶管 2 孔 15 米，单页井 2 个（普通土）/);
  assert.ok(summary.pipeRows.length > 3);

  for (const { reply } of sent) {
    if (reply.kind === "quota-file") continue;
    const card = renderReply(reply);
    assert.equal(card.content.schema, "2.0", reply.kind);
    assert.ok(Buffer.byteLength(JSON.stringify(card.content)) < 28000, reply.kind);
    assertButtonsReadable(card.content, reply.kind);
  }
});

test("清单：“删除预算”在“主菜单”后面，要确认；清单 / 基础信息的“主菜单”回主界面不退出；基础信息可以用表单改", async () => {
  const { app, click, say } = harness();
  let home = await app.handleMenu({ eventId: "menu-home", openId: "ou-1", eventKey: QUOTA_MENU_KEY });
  const form = await click(home, "quota-new");
  let summary = await click(form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "主菜单测试", location: "测试", preparer: "张三", reviewer: "李四" } });

  // 清单上的“主菜单”回到定额模式主界面，仍在定额模式里
  home = await click(summary, "quota-home");
  assert.equal(home.kind, "quota-home");
  assert.doesNotMatch(JSON.stringify(renderReply(home).content), /quota-delete-ask/);
  const summaryButtons = [...JSON.stringify(renderReply(summary).content).matchAll(/"content":"(生成预算书|基础信息|主菜单|删除预算)"/g)].map((match) => match[1]);
  assert.deepEqual(summaryButtons, ["生成预算书", "基础信息", "主菜单", "删除预算"]);
  // 手机上按钮字要完整显示：清单第二排拆成两排各 2 个
  assert.deepEqual(rowsOf(renderReply(summary).content).slice(-3), [["＋人工", "＋材料", "管道"], ["生成预算书", "基础信息"], ["主菜单", "删除预算"]]);
  assert.equal((await say("清单")).kind, "quota-summary");

  // 基础信息：表单默认值是现在的值，可以改；改错给提示
  const info = await click(summary, "quota-info");
  const edit = await click(info, "quota-info-edit");
  assert.equal(edit.kind, "quota-info-form");
  assert.ok(!edit.fields.some((field) => field.key === "projectCode"));
  assert.equal(edit.fields.find((field) => field.key === "contractor").value, "示例施工");
  assert.equal(edit.fields.find((field) => field.key === "contractorTaxRate").value, "9");
  assert.deepEqual(edit.fields.find((field) => field.key === "regionClass").options, ["一类地区", "二类地区", "三类地区", "四类地区"]);
  assert.match((await click(edit, "quota-info-submit", { formValue: { contractorTaxRate: "abc" } })).message, /施工单位增值税税率请填/);
  const saved = await click(edit, "quota-info-submit", { formValue: { contractor: "新施工单位", regionClass: "三类地区", contractorTaxRate: "6", location: "新地点" } });
  assert.equal(saved.kind, "quota-info");
  assert.equal(saved.note, "基础信息已保存");
  assert.ok(saved.lines.includes("施工单位：新施工单位"));
  assert.ok(saved.lines.includes("建设地区类别：三类地区"));
  assert.ok(saved.lines.includes("施工单位增值税税率：6%"));
  assert.equal((await click(saved, "quota-home")).kind, "quota-home");

  // 清单上删除预算：先确认（可取消回清单），再删，回主菜单
  summary = await click(saved, "quota-summary");
  const confirm = await click(summary, "quota-delete-ask");
  assert.equal(confirm.kind, "quota-delete-confirm");
  assert.equal(confirm.name, "主菜单测试");
  assert.equal((await click(confirm, "quota-summary")).kind, "quota-summary");
  home = await click(confirm, "quota-delete-confirm");
  assert.equal(home.note, "已删除预算“主菜单测试”");
  assert.ok(!home.budgets.some((budget) => budget.name === "主菜单测试"));
  assert.match((await click(confirm, "quota-delete-confirm")).message, /已经删除/);

  // 主菜单上的“退出定额模式”才退出
  const exited = await click(home, "quota-exit");
  assert.equal(exited.title, "已退出定额模式");
  for (const reply of [home, confirm, info, edit, saved]) {
    assert.equal(renderReply(reply).content.schema, "2.0", reply.kind);
    assertButtonsReadable(renderReply(reply).content, reply.kind);
  }
});
