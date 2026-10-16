import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { buildBudgetWorkbook } from "../src/quota/budget-workbook.mjs";
import { parseBudgetTemplate, parseMaterialPriceBook } from "../src/quota/quota-import.mjs";
import { XlsxPackage, mapFormulaRows } from "../src/quota/xlsx-patch.mjs";
import { buildPriceBookWorkbook, buildTemplateWorkbook } from "./fixtures/quota-fixtures.mjs";

const T2 = "工程费用预算表（表二）";
const T4 = "器材预算表（表四甲供）";

function zipParts(buffer) {
  const zip = XLSX.CFB.read(buffer, { type: "buffer" });
  return Object.fromEntries(zip.FullPaths.map((path, index) => [path, zip.FileIndex[index]]).filter(([path, entry]) => entry.type === 2 && !/Sh33tJ5/.test(path))
    .map(([path, entry]) => [path.replace("Root Entry/", ""), Buffer.from(entry.content).toString("base64")]));
}

test("公式行号改写：区域端点、跨表引用、字符串和函数名", () => {
  const shift = (sheet, r1, r2) => [r1 >= 10 ? r1 + 3 : r1, r2 === null ? null : r2 >= 10 ? r2 + 3 : r2];
  assert.equal(mapFormulaRows("SUM(L6:L10)*(1-L11)", shift), "SUM(L6:L13)*(1-L14)");
  assert.equal(mapFormulaRows("'工程费用预算表（表二）'!L12+项目基础信息表!D15", shift), "'工程费用预算表（表二）'!L15+项目基础信息表!D18");
  assert.equal(mapFormulaRows("\"L10 不变\"&LOG10(A12)", shift), "\"L10 不变\"&LOG10(A15)");
  assert.equal(mapFormulaRows("$A$1:$N$12", shift), "$A$1:$N$15");
});

test("解析模板：定额库、基础信息默认值（B 列序号定位）、缺少以显示精度为准时给出警告", () => {
  const parsed = parseBudgetTemplate(buildTemplateWorkbook());
  assert.equal(parsed.quotaItems.length, 26);
  assert.deepEqual(parsed.quotaItems.find((item) => item.code === "YGWX-3-10").prices, [3352.74, 3193.09, 2873.78, 2554.47]);
  assert.equal(parsed.infoDefaults.regionClass, "二类地区");
  assert.equal(parsed.infoDefaults.contractorTaxRate, 0.09);
  assert.equal(parsed.infoDefaults.preparedDate, "2026-10-15");
  assert.equal(parsed.infoCells.contractorTaxRate, "D15");
  assert.equal(parsed.table2Footer, 11);
  assert.equal(parsed.table4Footer, 12);
  assert.deepEqual(parsed.constructionUnits, ["示例分公司", "另一个分公司"]);
  assert.equal(parsed.warnings.length, 1);
  assert.throws(() => parseBudgetTemplate(buildPriceBookWorkbook()), /模板缺少工作表/);
});

test("解析单价表：最高价、属性、常用物料补出仓地方与期止，没有最高价列时取报价最大值", () => {
  const { materials, skipped } = parseMaterialPriceBook(buildPriceBookWorkbook());
  const byCode = new Map(materials.map((item) => [item.code, item]));
  assert.equal(byCode.get("14010162").maxPrice, 2.7837);
  assert.equal(byCode.get("14010162").common, true);
  assert.equal(byCode.get("14010162").place, "市公司");
  assert.equal(byCode.get("14010162").contractEnd, "2027-12-31");
  assert.equal(byCode.get("14010025").common, false);
  assert.equal(byCode.get("15039655").attr, "1分8, 插片式, SC/UPC");
  assert.equal(byCode.get("30279923").maxPrice, 241.59);
  assert.ok(skipped.some((item) => item.sheet === "说明"));
});

test("生成预算书：插行后合计、表一引用、合并单元格、打印区域、千米格式和缓存值都正确，其余部件不变", () => {
  const templateBuffer = buildTemplateWorkbook();
  const parsed = parseBudgetTemplate(templateBuffer);
  const items = new Map(parsed.quotaItems.map((item) => [item.code, item]));
  const codes = [["YGWX-3-22", 3], ["YGWX-3-10", 0.2], ["YGWX-3-24", 24], ["YGWX-3-10", 0.2, true], ["YGWG-1-01", 45], ["YGWG-2-28", 15]];
  const table2 = codes.map(([code, quantity, reuse]) => ({ item: items.get(code), quantity, reuse: Boolean(reuse) }));
  const { materials } = parseMaterialPriceBook(buildPriceBookWorkbook());
  const material = new Map(materials.map((item) => [item.code, item]));
  const table4 = ["14010162", "15039746", "14010025", "14010161", "15039655", "30279923"].map((code, index) => ({ material: material.get(code), quantity: [800, 6, 10, 100, 2, 1][index], remark: index === 0 ? "架空用" : "" }));
  const info = { ...parsed.infoDefaults, projectName: "测试项目", location: "测试地点", preparer: "甲", reviewer: "乙", preparedDate: "2026-10-16" };
  const { buffer, budget } = buildBudgetWorkbook({ templateBuffer, infoCells: parsed.infoCells, info, table2, table4 });

  // 表二 6 行 > 4 空行：插 2 行，合计行从 12 移到 14
  const workbook = XLSX.read(buffer, { cellFormula: true, cellNF: true });
  const sheet2 = workbook.Sheets[T2];
  assert.equal(sheet2.L14.f, "SUM(L6:L12)*(1-L13)");
  assert.equal(sheet2.L14.v, budget.totals.table2Amount);
  assert.equal(sheet2.A13.v, "人工费用降点数");
  assert.equal(sheet2.L13.f, "H13*K13");
  assert.equal(sheet2.H10.f, "(3193.09*0.7)");
  assert.equal(sheet2.N10.v, "利旧");
  assert.equal(sheet2.I7.f, "项目基础信息表!D15");
  assert.equal(sheet2.K8.z, "0.000_);[Red]\\(0.000\\)");
  assert.equal(sheet2.E7.v, "光缆端开缆工作内容");
  const merges2 = sheet2["!merges"].map((range) => XLSX.utils.encode_range(range));
  for (const range of ["E7:F7", "E11:F11", "E12:F12", "A13:K13", "A14:K14"]) assert.ok(merges2.includes(range), range);
  assert.equal(budget.totals.table2Amount, Math.round((1877.77 + 118.35 + 2505.15) * 100) / 100);

  // 表四甲供 6 行 > 5 空行：插 1 行，合计行从 12 移到 13
  const sheet4 = workbook.Sheets[T4];
  assert.equal(sheet4.J13.f, "SUM(J7:J12)");
  assert.equal(sheet4.F7.f, "ROUND(H7/(1+G7),4)");
  assert.equal(sheet4.F7.v, 2.4635);
  assert.equal(sheet4.J7.v, 1970.8);
  assert.equal(sheet4.L7.v, "架空用");
  assert.equal(sheet4.A14.v, "说明");
  const merges4 = sheet4["!merges"].map((range) => XLSX.utils.encode_range(range));
  assert.ok(merges4.includes("A13:I13") && merges4.includes("A14:K14"));

  const table1 = workbook.Sheets["工程造价预算表（表一）"];
  assert.equal(table1.F6.f, `'${T2}'!L14`);
  assert.equal(table1.F6.v, budget.totals.table2Amount);
  assert.equal(table1.F8.f, `'${T4}'!J13`);
  assert.equal(table1.F10.f, "SUM(F6:F9)");

  const infoSheet = workbook.Sheets["项目基础信息表"];
  assert.equal(infoSheet.D4.v, "测试项目");
  assert.equal(infoSheet.D5?.v ?? "", "");
  assert.equal(infoSheet.D22.v, "甲");
  assert.equal(infoSheet.D25.v, 46311);

  const pkg = new XlsxPackage(buffer);
  assert.match(pkg.part("xl/workbook.xml"), /'工程费用预算表（表二）'!\$A\$1:\$N\$14/);

  // 只有基础信息、表一、表二、表四、样式和 workbook 变化
  const before = zipParts(templateBuffer);
  const after = zipParts(buffer);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  const changed = Object.keys(before).filter((path) => before[path] !== after[path]).sort();
  assert.deepEqual(changed, ["xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml", "xl/worksheets/sheet5.xml"]);
});

test("生成预算书：行数没超过空行时不插行，工程编号不写", () => {
  const templateBuffer = buildTemplateWorkbook();
  const parsed = parseBudgetTemplate(templateBuffer);
  const item = parsed.quotaItems.find((entry) => entry.code === "YGWX-3-22");
  const info = { ...parsed.infoDefaults, projectCode: "不应写入", projectName: "小项目" };
  const { buffer } = buildBudgetWorkbook({ templateBuffer, infoCells: parsed.infoCells, info, table2: [{ item, quantity: 1 }], table4: [] });
  const workbook = XLSX.read(buffer, { cellFormula: true });
  assert.equal(workbook.Sheets[T2].L12.f, "SUM(L6:L10)*(1-L11)");
  assert.equal(workbook.Sheets[T2].L12.v, 59.8);
  assert.equal(workbook.Sheets["项目基础信息表"].D5?.v ?? "", "");
});
