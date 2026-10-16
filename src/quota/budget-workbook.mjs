// 生成预算书（ADR-092）：往模板的项目基础信息表、表二、表四甲供填数据，行不够时插行；格式与固定内容不变。
import { OA_THRESHOLD, computeSafety, computeSupervision, computeTable2Line, computeTable4Line, quantityDecimals, roundTo, sumAmounts } from "./quota-calc.mjs";
import {
  DATA_FIRST_ROW, INFO_FIELDS, SHEET_INFO, SHEET_TABLE1, SHEET_TABLE2, SHEET_TABLE4, TABLE2_FOOTER, TABLE4_FOOTER, isoDateToExcelSerial
} from "./quota-import.mjs";
import { XlsxPackage } from "./xlsx-patch.mjs";

const KM_FORMAT = "0.000_);[Red]\\(0.000\\)";

/** 按基础信息计算表二、表四各行（不写文件），供卡片、桌面预览和生成共用。 */
export function computeBudget({ info = {}, table2 = [], table4 = [] }) {
  const regionClass = info.regionClass || "二类地区";
  const taxRate = Number.isFinite(Number(info.contractorTaxRate)) ? Number(info.contractorTaxRate) : 0.09;
  const lines2 = table2.map((line) => ({
    ...line,
    calc: computeTable2Line({ item: line.item, quantity: line.quantity, regionClass, taxRate, reuse: line.reuse })
  }));
  const lines4 = table4.map((line) => ({
    ...line,
    calc: computeTable4Line({ price: line.price ?? line.material.maxPrice, quantity: line.quantity })
  }));
  const discount = Number(info.contractorDiscount) || 0;
  const table2Amount = sumAmounts(lines2.map((line) => line.calc), "amount");
  const table2Taxed = sumAmounts(lines2.map((line) => line.calc), "taxedAmount");
  const totals = {
    table2Amount: Math.round(table2Amount * (1 - discount) * 100) / 100,
    table2TaxedAmount: Math.round(table2Taxed * (1 - discount) * 100) / 100,
    table4Amount: sumAmounts(lines4.map((line) => line.calc), "amount"),
    table4TaxedAmount: sumAmounts(lines4.map((line) => line.calc), "taxedAmount")
  };
  const supervision = computeSupervision({ table2Amount: totals.table2Amount, table4Amount: totals.table4Amount, contractorDiscount: discount, supervisorDiscount: info.supervisorDiscount });
  totals.supervisionBase = supervision.base;
  totals.supervisionAmount = supervision.amount;
  totals.supervisionTaxedAmount = supervision.taxedAmount;
  const safety = computeSafety({ base: supervision.base });
  totals.safetyAmount = safety.amount;
  totals.safetyTaxedAmount = safety.taxedAmount;
  totals.taxedTotal = roundTo(totals.table2TaxedAmount + totals.table4TaxedAmount + supervision.taxedAmount + safety.taxedAmount, 2);
  // 人工（含税）+ 监理费（含税）+ 安全生产费（含税）超过 3000 要上 OA 系统
  totals.oaAmount = roundTo(totals.table2TaxedAmount + supervision.taxedAmount + safety.taxedAmount, 2);
  totals.oaThreshold = OA_THRESHOLD;
  totals.needsOa = totals.oaAmount > OA_THRESHOLD;
  return { table2: lines2, table4: lines4, totals };
}

function writeInfo(pkg, infoCells, info) {
  const cells = {};
  for (const field of INFO_FIELDS) {
    if (field.readOnly) continue;
    const ref = infoCells[field.key];
    const value = info[field.key];
    if (!ref || value === undefined || value === null) continue;
    if (field.type === "rate") cells[ref] = { num: Number(value) || 0 };
    else if (field.type === "date") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) cells[ref] = { num: isoDateToExcelSerial(value) };
    } else cells[ref] = { str: String(value) };
  }
  pkg.setCells(SHEET_INFO, cells);
}

/** 生成预算书 .xlsx，返回 { buffer, budget }。infoCells 来自 parseBudgetTemplate。 */
export function buildBudgetWorkbook({ templateBuffer, infoCells, info, table2 = [], table4 = [] }) {
  const pkg = new XlsxPackage(templateBuffer);
  const budget = computeBudget({ info, table2, table4 });
  writeInfo(pkg, infoCells, info);

  // ---------- 表二 ----------
  const footer2 = pkg.findRowByText(SHEET_TABLE2, "A", TABLE2_FOOTER);
  const styles2 = pkg.rowStyles(SHEET_TABLE2, DATA_FIRST_ROW);
  const capacity2 = footer2 - DATA_FIRST_ROW;
  const extra2 = Math.max(0, budget.table2.length - capacity2);
  // 在最后一个数据行前插入，让 SUM 等区域引用自然扩展（与宏“新增一行”在数据区内插入一致）
  pkg.insertRows(SHEET_TABLE2, footer2 - 1, extra2, DATA_FIRST_ROW, { extraMerges: [["E", "F"]], dataFirst: DATA_FIRST_ROW });
  const kmStyle = budget.table2.some((line) => quantityDecimals(line.item.unit) === 3) ? pkg.addNumberFormatStyle(Number(styles2.K), KM_FORMAT) : null;
  const cells2 = {};
  budget.table2.forEach((line, index) => {
    const row = DATA_FIRST_ROW + index;
    const { item, calc } = line;
    Object.assign(cells2, {
      [`A${row}`]: { f: "ROW()-6", v: index + 1, style: styles2.A },
      [`B${row}`]: { str: item.code, style: styles2.B },
      [`C${row}`]: { str: item.name, style: styles2.C },
      [`D${row}`]: { str: item.detail || "", style: styles2.D },
      [`E${row}`]: { str: item.workContent || "", style: styles2.E },
      [`G${row}`]: { str: item.unit, style: styles2.G },
      [`H${row}`]: calc.reuse ? { f: `(${calc.basePrice}*0.7)`, v: calc.unitPrice, style: styles2.H } : { num: calc.unitPrice, style: styles2.H },
      [`I${row}`]: { f: `${SHEET_INFO}!${infoCells.contractorTaxRate || "D15"}`, v: calc.taxRate, style: styles2.I },
      [`J${row}`]: { f: `H${row}*(1+I${row})`, v: calc.taxedUnitPrice, style: styles2.J },
      [`K${row}`]: { num: calc.quantity, style: quantityDecimals(item.unit) === 3 ? kmStyle : styles2.K },
      [`L${row}`]: { f: `H${row}*K${row}`, v: calc.amount, style: styles2.L },
      [`M${row}`]: { f: `J${row}*K${row}`, v: calc.taxedAmount, style: styles2.M },
      [`N${row}`]: { str: line.remark || (calc.reuse ? "利旧" : ""), style: styles2.N }
    });
  });
  if (Object.keys(cells2).length) pkg.setCells(SHEET_TABLE2, cells2);
  const total2 = footer2 + extra2 + 1;

  // ---------- 表四甲供 ----------
  const footer4 = pkg.findRowByText(SHEET_TABLE4, "A", TABLE4_FOOTER);
  const styles4 = pkg.rowStyles(SHEET_TABLE4, DATA_FIRST_ROW);
  const extra4 = Math.max(0, budget.table4.length - (footer4 - DATA_FIRST_ROW));
  pkg.insertRows(SHEET_TABLE4, footer4 - 1, extra4, DATA_FIRST_ROW, { dataFirst: DATA_FIRST_ROW });
  const cells4 = {};
  budget.table4.forEach((line, index) => {
    const row = DATA_FIRST_ROW + index;
    const { material, calc } = line;
    Object.assign(cells4, {
      [`A${row}`]: { f: "ROW()-6", v: index + 1, style: styles4.A },
      [`B${row}`]: { str: material.code, style: styles4.B },
      [`C${row}`]: { str: material.name, style: styles4.C },
      [`D${row}`]: { str: material.spec || "", style: styles4.D },
      [`E${row}`]: { str: material.unit, style: styles4.E },
      [`F${row}`]: { f: `ROUND(H${row}/(1+G${row}),4)`, v: calc.unitPrice, style: styles4.F },
      [`G${row}`]: { num: calc.taxRate, style: styles4.G },
      [`H${row}`]: { num: calc.taxedUnitPrice, style: styles4.H },
      [`I${row}`]: { num: calc.quantity, style: styles4.I },
      [`J${row}`]: { f: `F${row}*I${row}`, v: calc.amount, style: styles4.J },
      [`K${row}`]: { f: `H${row}*I${row}`, v: calc.taxedAmount, style: styles4.K },
      [`L${row}`]: { str: line.remark || "", style: styles4.L }
    });
  });
  if (Object.keys(cells4).length) pkg.setCells(SHEET_TABLE4, cells4);
  const total4 = footer4 + extra4;

  // 合计格和表一引用格写缓存值，不重算的预览工具也能看到金额（Excel/WPS 打开时仍会全部重算）
  // 公式保持模板原样（插行时已同步调整），只刷新缓存值
  const { totals } = budget;
  pkg.setCachedValues(SHEET_TABLE2, { [`L${total2}`]: totals.table2Amount, [`M${total2}`]: totals.table2TaxedAmount });
  pkg.setCachedValues(SHEET_TABLE4, { [`J${total4}`]: totals.table4Amount, [`K${total4}`]: totals.table4TaxedAmount });
  pkg.setCachedValues(SHEET_TABLE1, { F6: totals.table2Amount, G6: totals.table2TaxedAmount, F8: totals.table4Amount, G8: totals.table4TaxedAmount });
  return { buffer: pkg.toBuffer(), budget };
}
