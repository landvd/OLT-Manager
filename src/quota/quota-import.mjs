// 定额预算资料导入（ADR-092）：预算书模板（.xlsx，含定额数据库与项目基础信息表）和材料单价参考表。
import XLSX from "xlsx";
import { XlsxPackage } from "./xlsx-patch.mjs";

export const SHEET_INFO = "项目基础信息表";
export const SHEET_TABLE1 = "工程造价预算表（表一）";
export const SHEET_TABLE2 = "工程费用预算表（表二）";
export const SHEET_TABLE4 = "器材预算表（表四甲供）";
export const SHEET_QUOTA = "定额数据库";
export const TABLE2_FOOTER = "人工费用降点数";
export const TABLE4_FOOTER = "甲供材料费用合计";
export const DATA_FIRST_ROW = 7;

/** 项目基础信息表各行，按 B 列序号定位（C 列名称有重复，例如三个“技术负责人”）。 */
export const INFO_FIELDS = Object.freeze([
  { serial: "1", key: "constructionUnit", label: "建设单位" },
  { serial: "2", key: "projectName", label: "项目名称", required: true },
  { serial: "3", key: "projectCode", label: "工程编号", readOnly: true },
  { serial: "4", key: "location", label: "建设地点", required: true },
  { serial: "5", key: "regionClass", label: "建设地区类别" },
  { serial: "6", key: "scale", label: "工程规模" },
  { serial: "7", key: "budgetType", label: "预算书类别" },
  { serial: "8", key: "supervisor", label: "监理单位" },
  { serial: "8.1", key: "supervisorDiscount", label: "监理费下浮率", type: "rate" },
  { serial: "8.2", key: "supervisorLead", label: "监理技术负责人" },
  { serial: "9", key: "contractor", label: "施工单位" },
  { serial: "9.1", key: "contractorDiscount", label: "施工费下浮率", type: "rate" },
  { serial: "9.2", key: "contractorTaxRate", label: "施工单位增值税税率", type: "rate" },
  { serial: "9.3", key: "contractorLead", label: "施工技术负责人" },
  { serial: "10", key: "designer", label: "设计单位" },
  { serial: "10.1", key: "surveyByNational", label: "勘察费按照国标计取" },
  { serial: "10.2", key: "designDiscount", label: "设计费下浮率", type: "rate" },
  { serial: "10.3", key: "approver", label: "批准" },
  { serial: "10.4", key: "designLead", label: "设计技术负责人" },
  { serial: "10.5", key: "preparer", label: "编制人", required: true },
  { serial: "10.6", key: "reviewer", label: "审核", required: true },
  { serial: "10.7", key: "checker", label: "校核" },
  { serial: "10.8", key: "preparedDate", label: "编制日期", type: "date" },
  { serial: "10.9", key: "designFeeRate", label: "设计费费率", type: "rate" }
]);

/** 新建预算时不取模板值、每次必须填写的项。 */
export const PER_BUDGET_FIELDS = Object.freeze(["projectName", "projectCode", "location", "preparer", "reviewer", "preparedDate"]);

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const compact = (value) => String(value ?? "").replace(/\s/g, "");

function serialKey(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : text(value);
}

/** 按 A1 起算读出二维数组（工作表的已用区域可能从 B 列开始，SheetJS 默认会把它当第 0 列）。 */
function sheetRows(sheet) {
  if (!sheet?.["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, range: { s: { r: 0, c: 0 }, e: range.e } });
}

export function excelSerialToIsoDate(serial) {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial)) * 86400000);
  return date.toISOString().slice(0, 10);
}

export function isoDateToExcelSerial(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** 解析预算书模板：校验结构，读出定额库、基础信息默认值和各行位置。 */
export function parseBudgetTemplate(buffer) {
  const pkg = new XlsxPackage(buffer);
  for (const name of [SHEET_INFO, SHEET_TABLE1, SHEET_TABLE2, SHEET_TABLE4, SHEET_QUOTA]) {
    if (!pkg.hasSheet(name)) throw new Error(`模板缺少工作表“${name}”，请确认是预算书编制程序另存的 .xlsx`);
  }
  const table2Footer = pkg.findRowByText(SHEET_TABLE2, "A", TABLE2_FOOTER);
  const table4Footer = pkg.findRowByText(SHEET_TABLE4, "A", TABLE4_FOOTER);
  if (!table2Footer || table2Footer <= DATA_FIRST_ROW) throw new Error(`表二找不到“${TABLE2_FOOTER}”行`);
  if (!table4Footer || table4Footer <= DATA_FIRST_ROW) throw new Error(`表四甲供找不到“${TABLE4_FOOTER}”行`);
  const warnings = [];
  if (!/fullPrecision="0"/.test(pkg.calcPr())) warnings.push("模板没有开启“以显示精度为准”，生成的金额可能与手工表差几分钱");

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const quotaRows = sheetRows(workbook.Sheets[SHEET_QUOTA]);
  const quotaItems = [];
  const seen = new Set();
  quotaRows.forEach((row, index) => {
    const code = text(row[1]);
    if (!/^YG[A-Z]+-\d+-\d+$/.test(code) || seen.has(code)) return;
    seen.add(code);
    const prices = [6, 7, 8, 9].map((column) => Number(row[column]));
    if (prices.some((price) => !Number.isFinite(price))) return;
    quotaItems.push({ code, name: text(row[3]), detail: text(row[4]), unit: text(row[5]), prices, workContent: text(row[10]), sort: index });
  });
  if (!quotaItems.length) throw new Error("定额数据库里没有读到定额");

  const infoRows = sheetRows(workbook.Sheets[SHEET_INFO]);
  const bySerial = new Map();
  infoRows.forEach((row, index) => {
    const key = serialKey(row[1]);
    if (key && !bySerial.has(key)) bySerial.set(key, { row: index + 1, value: row[3] });
  });
  const infoCells = {};
  const infoDefaults = {};
  for (const field of INFO_FIELDS) {
    const found = bySerial.get(field.serial);
    if (!found) throw new Error(`项目基础信息表找不到序号 ${field.serial}（${field.label}）`);
    infoCells[field.key] = `D${found.row}`;
    if (field.type === "rate") infoDefaults[field.key] = Number(found.value) || 0;
    else if (field.type === "date") infoDefaults[field.key] = typeof found.value === "number" ? excelSerialToIsoDate(found.value) : "";
    else infoDefaults[field.key] = text(found.value);
  }
  const constructionUnits = [...new Set(infoRows.slice(2).map((row) => text(row[6])).filter((value) => value.includes("分公司")))];
  return { quotaItems, infoDefaults, infoCells, constructionUnits, table2Footer, table4Footer, warnings };
}

/**
 * 解析材料单价参考表：遍历分类表（跳过目录、常用物料、光配件），按表头列名识别各列；
 * “常用物料”只用来标记常用、补合同期止和出仓地方。合同最高价为含税价。
 */
export function parseMaterialPriceBook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const materials = new Map();
  const skipped = [];
  const findColumn = (head, pattern) => head.findIndex((value) => pattern.test(value));
  const dateText = (value) => (typeof value === "number" && value > 30000 ? excelSerialToIsoDate(value) : parseChineseDate(text(value)));
  for (const sheetName of workbook.SheetNames) {
    if (["目录", "常用物料", "光配件"].includes(sheetName.trim())) continue;
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const headerIndex = rows.findIndex((row) => row.some((value) => compact(value) === "物料编码"));
    if (headerIndex < 0) {
      skipped.push({ sheet: sheetName, reason: "没有“物料编码”列" });
      continue;
    }
    const head = rows[headerIndex].map(compact);
    const columns = {
      code: head.indexOf("物料编码"),
      name: findColumn(head, /^(材料|材料名称|物料名称)$/),
      spec: findColumn(head, /^(规格型号|物料规格)$/),
      attr: findColumn(head, /^属性$/),
      unit: findColumn(head, /^单位$/),
      max: findColumn(head, /合同最高价/),
      min: findColumn(head, /合同最[低底]价/),
      end: findColumn(head, /合同期止/)
    };
    if (columns.name < 0 || columns.unit < 0) {
      skipped.push({ sheet: sheetName, reason: "没有名称或单位列" });
      continue;
    }
    // 没有“合同最高价”列时，取各供应商报价列的最大值（排除合同、备注、日期等列）
    const priceColumns = head.map((value, index) => index).filter((index) => index > columns.unit
      && (columns.max < 0 || index < columns.max)
      && ![columns.min, columns.end].includes(index)
      && !/合同|备注|期|编码|名称|规格|数量/.test(head[index]));
    let count = 0;
    for (const row of rows.slice(headerIndex + 1)) {
      const code = text(row[columns.code]);
      if (!/^\d{8}$/.test(code)) continue;
      if (materials.has(code)) {
        count += 1; // 同一物料编码在多张分类表出现时，以先出现的为准
        continue;
      }
      let max = columns.max >= 0 ? Number(row[columns.max]) : NaN;
      if (!Number.isFinite(max) || max <= 0) {
        const quotes = priceColumns.map((index) => Number(row[index])).filter((value) => Number.isFinite(value) && value > 0);
        max = quotes.length ? Math.max(...quotes) : NaN;
      }
      if (!Number.isFinite(max) || max <= 0) continue;
      const min = columns.min >= 0 ? Number(row[columns.min]) : NaN;
      materials.set(code, {
        code,
        name: text(row[columns.name]),
        spec: columns.spec >= 0 ? text(row[columns.spec]) : "",
        attr: columns.attr >= 0 && text(row[columns.attr]) !== "0" ? text(row[columns.attr]) : "",
        unit: text(row[columns.unit]),
        maxPrice: max,
        minPrice: Number.isFinite(min) && min > 0 ? min : null,
        contractEnd: columns.end >= 0 ? dateText(row[columns.end]) : "",
        place: "",
        sheet: sheetName.trim(),
        common: false
      });
      count += 1;
    }
    if (!count) skipped.push({ sheet: sheetName, reason: "没有读到带价格的物料" });
  }
  const common = workbook.Sheets["常用物料"];
  if (common) {
    const rows = sheetRows(common);
    const headerIndex = rows.findIndex((row) => row.some((value) => compact(value) === "物料编码"));
    if (headerIndex >= 0) {
      const head = rows[headerIndex].map(compact);
      const codeColumn = head.indexOf("物料编码");
      const endColumn = findColumn(head, /合同期止/);
      const placeColumn = findColumn(head, /出仓地方/);
      for (const row of rows.slice(headerIndex + 1)) {
        const material = materials.get(text(row[codeColumn]));
        if (!material) continue;
        material.common = true;
        if (!material.contractEnd && endColumn >= 0) material.contractEnd = dateText(row[endColumn]);
        if (placeColumn >= 0) material.place = text(row[placeColumn]);
      }
    }
  }
  if (!materials.size) throw new Error("单价表里没有识别到物料，请确认表头含“物料编码”“单位”“合同最高价”");
  return { materials: [...materials.values()], skipped };
}

function parseChineseDate(value) {
  const match = String(value).match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
