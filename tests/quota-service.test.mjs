import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import XLSX from "xlsx";
import { buildPriceBookWorkbook, buildTemplateWorkbook } from "./fixtures/quota-fixtures.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-quota-service-"));

const db = await import("../src/db.mjs");
const { createQuotaService } = await import("../src/quota/quota-service.mjs");

await db.initDb();
const service = createQuotaService({ repo: db, now: () => new Date(2026, 9, 16, 9, 30) });

test("没导入模板时新建预算给出明确提示", async () => {
  await assert.rejects(() => service.createBudget({ projectName: "x", location: "y", preparer: "a", reviewer: "b" }), /还没有导入预算书模板/);
});

test("导入模板与单价表：首次导入生成默认基础信息模板（不含每次必填项），单价表预览列出改价与过期", async () => {
  const result = await service.importTemplate({ fileName: "模板.xlsx", buffer: buildTemplateWorkbook() });
  assert.equal(result.itemCount, 26);
  const presets = await service.listPresets();
  assert.equal(presets.length, 1);
  assert.equal(presets[0].isDefault, true);
  assert.equal(presets[0].fields.contractor, "示例施工");
  assert.equal(presets[0].fields.projectName, undefined);
  assert.equal(presets[0].fields.preparer, undefined);

  await service.importMaterials({ fileName: "单价.xlsx", buffer: buildPriceBookWorkbook() });
  const preview = await service.previewMaterials({ buffer: buildPriceBookWorkbook({ cablePrice: 2.9 }) });
  assert.equal(preview.added, 0);
  assert.deepEqual(preview.changed.map((item) => [item.code, item.before, item.after]), [["14010162", 2.7837, 2.9]]);
  assert.ok(preview.expired.some((item) => item.code === "30279923"));
  const status = await service.status();
  assert.equal(status.template.itemCount, 26);
  assert.equal(status.materials.materialCount, 6);
});

test("新建预算：必填项目名称、建设地点、编制人、审核；工程编号留空，编制日期取当天", async () => {
  await assert.rejects(() => service.createBudget({ projectName: "", location: "y", preparer: "a", reviewer: "b" }), /请填写项目名称/);
  await assert.rejects(() => service.createBudget({ projectName: "x", location: "y", preparer: "", reviewer: "b" }), /请填写编制人/);
  const budget = await service.createBudget({ projectName: "厚街测试工程", location: "测试社区", preparer: "张三", reviewer: "李四", createdBy: "ou_test", createdByName: "测试" });
  assert.equal(budget.info.projectCode, "");
  assert.equal(budget.info.preparedDate, "2026-10-16");
  assert.equal(budget.info.contractor, "示例施工");
  assert.equal(budget.info.regionClass, "二类地区");
  const names = (await service.status()).recentNames;
  assert.deepEqual(names.preparer, ["张三"]);
  await assert.rejects(() => service.updateBudgetInfo(budget.id, { regionClass: "五类地区" }), /建设地区类别/);
  const updated = await service.updateBudgetInfo(budget.id, { projectCode: "规建填写", scale: "小型" });
  assert.equal(updated.info.projectCode, "");
  assert.equal(updated.info.scale, "小型");
});

test("录入与汇总：利旧只允许光缆敷设，管道生成的同编号并入直接录入行，改地区类别后重新取价", async () => {
  const budget = await service.createBudget({ projectName: "汇总测试", location: "测试", preparer: "张三", reviewer: "李四" });
  await service.addQuotaLine(budget.id, { code: "YGWX-3-22", quantity: 3 });
  await service.addQuotaLine(budget.id, { code: "YGWX-3-10", quantity: 0.2 });
  await service.addQuotaLine(budget.id, { code: "YGWX-3-24", quantity: 24 });
  await service.addQuotaLine(budget.id, { code: "YGWX-3-10", quantity: 0.2, reuse: true });
  await assert.rejects(() => service.addQuotaLine(budget.id, { code: "YGWX-3-24", quantity: 1, reuse: true }), /不适用利旧/);
  await assert.rejects(() => service.addQuotaLine(budget.id, { code: "YGWX-9-99", quantity: 1 }), /定额库里没有/);
  await assert.rejects(() => service.addQuotaLine(budget.id, { code: "YGWX-3-22", quantity: 0 }), /数量必须大于 0/);
  await service.addQuotaLine(budget.id, { code: "YGWG-1-01", quantity: 5 });
  await service.savePipeInput(budget.id, { jacking: { 2: 15 } });
  await service.addMaterialLine(budget.id, { code: "14010162", quantity: 800, remark: "架空用" });
  await service.addMaterialLine(budget.id, { code: "15039746", quantity: 6 });

  let view = await service.budgetView(budget.id);
  const survey = view.table2.find((line) => line.code === "YGWG-1-01");
  assert.equal(survey.quantity, 20);
  assert.equal(survey.fromPipe, true);
  assert.deepEqual(view.table2.map((line) => line.code), ["YGWX-3-22", "YGWX-3-10", "YGWX-3-24", "YGWX-3-10", "YGWG-1-01", "YGWG-2-28", "YGWG-2-29"]);
  assert.equal(view.table2[3].remark, "利旧");
  assert.equal(view.totals.table2Amount, Math.round((1877.77 + 52.6 + 2505.15 + 1735.35) * 100) / 100);
  assert.equal(view.totals.table4Amount, 2071.37);
  assert.equal(view.totals.table4TaxedAmount, 2340.6);

  await service.updateBudgetInfo(budget.id, { regionClass: "三类地区" });
  view = await service.budgetView(budget.id);
  assert.equal(view.table2[0].unitPrice, 53.82);
  assert.equal(view.table2[3].unitPrice, Math.round(2873.78 * 0.7 * 100) / 100);

  const exported = await service.exportBudget(budget.id);
  assert.equal(exported.fileName, "汇总测试-预算书-20261016.xlsx");
  const workbook = XLSX.read(exported.buffer, { cellFormula: true });
  assert.equal(workbook.Sheets["工程费用预算表（表二）"].B13.v, "YGWG-2-29");
  assert.equal(workbook.Sheets["项目基础信息表"].D4.v, "汇总测试");
});

test("单价表更新后提示材料单价变化，确认后刷新", async () => {
  const budget = await service.createBudget({ projectName: "改价测试", location: "测试", preparer: "张三", reviewer: "李四" });
  await service.addMaterialLine(budget.id, { code: "14010162", quantity: 100 });
  await service.importMaterials({ fileName: "新单价.xlsx", buffer: buildPriceBookWorkbook({ cablePrice: 2.9 }) });
  let view = await service.budgetView(budget.id);
  assert.equal(view.priceChanges.length, 1);
  assert.equal(view.table4[0].taxedUnitPrice, 2.7837);
  assert.equal(await service.refreshMaterialPrices(budget.id), 1);
  view = await service.budgetView(budget.id);
  assert.equal(view.table4[0].taxedUnitPrice, 2.9);
  assert.equal(view.priceChanges.length, 0);
});

test("基础信息模板：另存、设默认、至少保留一套", async () => {
  const [budget] = await service.listBudgets();
  const saved = await service.savePresetFromBudget(budget.id, { name: "第二套", isDefault: true });
  assert.equal(saved.isDefault, true);
  assert.equal(saved.fields.projectName, undefined);
  const presets = await service.listPresets();
  assert.equal(presets.filter((preset) => preset.isDefault).length, 1);
  await assert.rejects(() => service.savePreset({ name: "第二套", fields: {} }), /已有名为/);
  for (const preset of presets.slice(1)) await service.deletePreset(preset.id);
  await assert.rejects(() => service.deletePreset(presets[0].id), /至少要保留一套/);
});

test("说法理解：本地拿不准时问大模型，模型只能选候选；确认后学到的说法直接生效", async () => {
  const budget = await service.createBudget({ projectName: "学习测试", location: "测试", preparer: "张三", reviewer: "李四" });
  // 本地规则：“做光缆头”不像任何定额的名称
  const local = await service.interpret(budget.id, "做3个光缆头");
  assert.equal(local.confident, false);

  const pickCode = (code) => async ({ system, user }) => {
    assert.match(system, /只能从给出的候选里选/);
    const { candidates } = JSON.parse(user);
    const id = Object.entries(candidates).find(([, label]) => label.startsWith(code))?.[0];
    return `好的：{"kind":"quota","id":"${id}","quantity":3,"unit":"个","reuse":false,"remark":""}`;
  };
  let answer = await service.interpretWithModel(budget.id, "做3个光缆头", local, pickCode("YGWX-3-22"));
  assert.equal(answer.kind, "quota");
  assert.equal(answer.candidates[0].item.code, "YGWX-3-22");
  assert.equal(answer.candidates[0].source, "model");
  assert.equal(answer.candidates[0].quantity, 3);

  // 返回候选以外的编号、或调用失败：退回本地结果
  answer = await service.interpretWithModel(budget.id, "做3个光缆头", local, async () => '{"kind":"quota","id":"Q999","quantity":3}');
  assert.match(answer.modelNote, /拿不准/);
  answer = await service.interpretWithModel(budget.id, "做3个光缆头", local, async () => { throw new Error("timeout"); });
  assert.match(answer.modelNote, /没有响应/);

  // 模型选的芯数档仍按规则改：说 24 芯时即使模型选了 12 芯以下，也改到 36 芯以下
  const cableLocal = await service.interpret(budget.id, "挂24芯缆200米");
  answer = await service.interpretWithModel(budget.id, "挂24芯缆200米", cableLocal, pickCode("YGWX-3-09"));
  assert.equal(answer.candidates[0].item.code, "YGWX-3-10");
  assert.equal(answer.candidates[0].quantity, 0.2);

  // 确认后学习：同样的说法（换数量）直接按学过的处理
  await service.learnPhrase({ text: "做3个光缆头", kind: "quota", code: "YGWX-3-22", corrected: true, createdBy: "ou-1" });
  const learned = await service.interpret(budget.id, "做5个光缆头");
  assert.equal(learned.confident, true);
  assert.equal(learned.candidates[0].source, "learned");
  assert.equal(learned.candidates[0].item.code, "YGWX-3-22");
  assert.equal(learned.candidates[0].quantity, 5);
  const [row] = await service.listLearned();
  assert.equal(row.phrase, "做光缆头");
  assert.equal(row.corrected, true);
  assert.equal(row.label, "光缆端开缆");
  await service.deleteLearned(row.id);
  assert.equal((await service.interpret(budget.id, "做5个光缆头")).confident, false);
});

test("选择目录：人工按名称分组带各档，默认常用端开缆 / 架空 / 管道敷设 / 接续，可手动设置；材料常用取单价表；修改时可换档、换材料", async () => {
  let catalog = await service.catalog();
  const aerial = catalog.quota.groups.find((group) => group.name === "架空光缆敷设");
  assert.deepEqual(aerial.tiers.map((tier) => tier.code), ["YGWX-3-09", "YGWX-3-10", "YGWX-3-11"]);
  assert.equal(aerial.category, "光缆线路");
  assert.equal(aerial.reusable, true);
  assert.deepEqual(catalog.quota.common.slice(0, 3), ["光缆端开缆", "架空光缆敷设", "光缆接续"]);
  assert.equal(catalog.quota.groups.find((group) => group.name === "人工敷设塑料子管").category, "杆路·箱体·管槽");
  assert.equal(catalog.material.items.find((item) => item.code === "14010162").common, true);
  assert.equal(catalog.material.items.find((item) => item.code === "14010025").common, false);

  catalog = await service.setCommon({ kind: "quota", key: "人工敷设塑料子管", pinned: true });
  assert.ok(catalog.quota.common.includes("人工敷设塑料子管"));
  catalog = await service.setCommon({ kind: "quota", key: "光缆接续", pinned: false });
  assert.ok(!catalog.quota.common.includes("光缆接续"));
  catalog = await service.setCommon({ kind: "material", key: "14010025", pinned: true });
  assert.equal(catalog.material.items.find((item) => item.code === "14010025").common, true);
  await assert.rejects(() => service.setCommon({ kind: "x", key: "y", pinned: true }), /只能设置/);

  const budget = await service.createBudget({ projectName: "目录测试", location: "测试", preparer: "张三", reviewer: "李四" });
  const line = await service.addQuotaLine(budget.id, { code: "YGWX-3-09", quantity: 0.2 });
  await service.updateQuotaLine(budget.id, line.id, { code: "YGWX-3-10", quantity: 0.3, reuse: true });
  let view = await service.budgetView(budget.id);
  assert.deepEqual([view.quotaLines[0].code, view.quotaLines[0].quantity, view.quotaLines[0].reuse, view.quotaLines[0].remark], ["YGWX-3-10", 0.3, true, "利旧"]);
  await service.updateQuotaLine(budget.id, line.id, { reuse: false });
  view = await service.budgetView(budget.id);
  assert.equal(view.quotaLines[0].remark, "");
  await assert.rejects(() => service.updateQuotaLine(budget.id, line.id, { code: "YGWX-3-22", reuse: true }), /不适用利旧/);

  const material = await service.addMaterialLine(budget.id, { code: "14010162", quantity: 100, remark: "架空用" });
  await service.updateMaterialLine(budget.id, material.id, { code: "14010161", quantity: 120 });
  view = await service.budgetView(budget.id);
  assert.deepEqual([view.materialLines[0].code, view.materialLines[0].spec, view.materialLines[0].quantity, view.materialLines[0].remark], ["14010161", "GYTS-12B1#, 12芯", 120, "架空用"]);
});
