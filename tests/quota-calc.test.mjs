import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePipeQuantities, computeTable2Line, computeTable4Line, isReusableQuota, normalizeSoil, pickCoreTier, roundTo, sumAmounts
} from "../src/quota/quota-calc.mjs";
import { quotaItemMap } from "./fixtures/quota-fixtures.mjs";

const items = quotaItemMap();
const asObject = (lines) => Object.fromEntries(lines.map((line) => [line.code, roundTo(line.quantity, 4)]));

test("管道计算器：开挖混凝土路面 150mm 以下 20 米（与计算器核对一致）", () => {
  const lines = calculatePipeQuantities({ trench: { 混凝土路面150mm以下: 20 } });
  assert.deepEqual(asObject(lines), {
    "YGWG-1-01": 20, "YGWG-1-02": 8, "YGWG-1-13": 8, "YGWG-1-21": 3.4, "YGWG-1-23": 3.4, "YGWG-1-26": 6.8, "YGWG-2-4": 20
  });
});

test("管道计算器：开挖 250 以下 30 米、顶管 2 孔 15 米、单页井 2 个（与计算器核对一致）", () => {
  const lines = calculatePipeQuantities({
    trench: { 混凝土路面250mm以下: 30 },
    jacking: { 2: 15 },
    wells: [{ type: "单页井", road: "混凝土路面250mm以下", count: 2 }]
  });
  assert.deepEqual(asObject(lines), {
    "YGWG-1-01": 45, "YGWG-1-03": 14.4, "YGWG-1-14": 12, "YGWG-1-21": 6.12, "YGWG-1-23": 6.12, "YGWG-1-26": 10.2, "YGWG-1-27": 2.04,
    "YGWG-2-4": 30, "YGWG-2-28": 15, "YGWG-2-29": 15, "YGWG-3-1": 2, "YGWG-4-2": 6.56
  });
});

test("管道计算器：顶管按孔数录入，3 孔 200 米生成 1 孔 200、增加 1 孔 400，施工测量含顶管长度", () => {
  const lines = asObject(calculatePipeQuantities({ jacking: { 3: 200 } }));
  assert.equal(lines["YGWG-2-28"], 200);
  assert.equal(lines["YGWG-2-29"], 400);
  assert.equal(lines["YGWG-1-01"], 200);
  assert.equal(lines["YGWG-1-02"], undefined);
});

test("管道计算器：直埋子管按千米计入人工敷设塑料子管，并计入开挖、修复和土方", () => {
  const lines = asObject(calculatePipeQuantities({ subduct: { length: 100, road: "混凝土路面150mm以下" } }));
  assert.equal(lines["YGWX-2-04"], 0.1);
  assert.equal(lines["YGWG-1-02"], 30);
  assert.equal(lines["YGWG-1-13"], 30);
  assert.equal(lines["YGWG-1-26"], 12);
  assert.equal(lines["YGWG-1-27"], undefined);
});

test("土质比例：坚石按 1 减其余补足，全为空时用默认普通土 / 砂砾土各半", () => {
  assert.deepEqual(normalizeSoil({ 普通土: 0.3, 硬土: 0.2 }), { 普通土: 0.3, 硬土: 0.2, 砂砾土: 0, 软石: 0, 坚石: 0.5 });
  assert.deepEqual(normalizeSoil({}), { 普通土: 0.5, 硬土: 0, 砂砾土: 0.5, 软石: 0, 坚石: 0 });
});

test("芯数分档：往上取最近一档，超过所有“以下”档时取不到", () => {
  const cable = [items.get("YGWX-3-09"), items.get("YGWX-3-10"), items.get("YGWX-3-11")];
  assert.equal(pickCoreTier(cable, 24).code, "YGWX-3-10");
  assert.equal(pickCoreTier(cable, 12).code, "YGWX-3-09");
  assert.equal(pickCoreTier(cable, 96), null);
  const splice = [items.get("YGWX-3-23"), items.get("YGWX-3-24"), items.get("YGWX-3-25")];
  assert.equal(pickCoreTier(splice, 24).code, "YGWX-3-24");
});

test("表二：按以显示精度为准计算，与现场表核对一致（1430.74 / 1559.55，加利旧后 1877.77 / 2046.81）", () => {
  const lines = [
    computeTable2Line({ item: items.get("YGWX-3-22"), quantity: 3 }),
    computeTable2Line({ item: items.get("YGWX-3-10"), quantity: 0.2 }),
    computeTable2Line({ item: items.get("YGWX-3-24"), quantity: 24 })
  ];
  assert.deepEqual(lines.map((line) => line.taxedUnitPrice), [65.18, 3480.47, 27.83]);
  assert.equal(sumAmounts(lines, "amount"), 1430.74);
  assert.equal(sumAmounts(lines, "taxedAmount"), 1559.55);
  const reused = computeTable2Line({ item: items.get("YGWX-3-10"), quantity: 0.2, reuse: true });
  assert.equal(reused.unitPrice, 2235.16);
  assert.equal(reused.taxedUnitPrice, 2436.32);
  assert.equal(sumAmounts([...lines, reused], "amount"), 1877.77);
  assert.equal(sumAmounts([...lines, reused], "taxedAmount"), 2046.81);
});

test("表二：地区类别取对应单价，利旧只对光缆敷设生效", () => {
  assert.equal(computeTable2Line({ item: items.get("YGWX-3-22"), quantity: 1, regionClass: "三类地区" }).unitPrice, 53.82);
  assert.equal(isReusableQuota(items.get("YGWX-3-10")), true);
  assert.equal(isReusableQuota(items.get("YGWX-3-24")), false);
  assert.equal(isReusableQuota(items.get("YGWX-3-62")), false);
  assert.equal(computeTable2Line({ item: items.get("YGWX-3-24"), quantity: 1, reuse: true }).reuse, false);
});

test("表四甲供：除税价 ROUND(H/1.13,4)，与现场表核对一致（2071.37 / 2340.60）", () => {
  const cable = computeTable4Line({ price: 2.7837, quantity: 800 });
  const splitter = computeTable4Line({ price: 18.94, quantity: 6 });
  assert.equal(cable.unitPrice, 2.4635);
  assert.equal(cable.amount, 1970.8);
  assert.equal(splitter.unitPrice, 16.7611);
  assert.equal(sumAmounts([cable, splitter], "amount"), 2071.37);
  assert.equal(sumAmounts([cable, splitter], "taxedAmount"), 2340.6);
});

test("监理费、安全生产费按模板表五；人工 + 监理费 + 安全生产费（含税）超 3000 要上 OA", async () => {
  const { computeSafety, computeSupervision, OA_THRESHOLD } = await import("../src/quota/quota-calc.mjs");
  const { computeBudget } = await import("../src/quota/budget-workbook.mjs");
  assert.deepEqual(computeSupervision({ table2Amount: 1077.53, table4Amount: 1538.82 }), { base: 2616.35, amount: 86.34, taxedAmount: 91.52 });
  // 施工费下浮：人工先还原成下浮前再计基数；监理费下浮 10%
  assert.deepEqual(computeSupervision({ table2Amount: 900, table4Amount: 100, contractorDiscount: 0.1, supervisorDiscount: 0.1 }), { base: 1100, amount: 32.67, taxedAmount: 34.63 });
  // 安全生产费（E10）= 建安费 × 2%，含税（G10）× 1.09
  assert.deepEqual(computeSafety({ base: 2616.35 }), { amount: 52.33, taxedAmount: 57.04 });
  assert.equal(OA_THRESHOLD, 3000);
  const item = { code: "YGWX-3-22", name: "光缆端开缆", detail: "", unit: "端", prices: [62.79, 59.8, 53.82, 47.84] };
  const under = computeBudget({ info: { regionClass: "二类地区", contractorTaxRate: 0.09 }, table2: [{ item, quantity: 40 }] });
  assert.equal(under.totals.table2TaxedAmount, 2607.2);
  assert.deepEqual([under.totals.supervisionTaxedAmount, under.totals.safetyTaxedAmount], [83.68, 52.15]);
  assert.equal(under.totals.oaAmount, 2743.03);
  assert.equal(under.totals.needsOa, false);
  const over = computeBudget({ info: { regionClass: "二类地区", contractorTaxRate: 0.09 }, table2: [{ item, quantity: 46 }] });
  assert.equal(over.totals.needsOa, true);
  assert.equal(over.totals.taxedTotal, Math.round((over.totals.table2TaxedAmount + over.totals.supervisionTaxedAmount + over.totals.safetyTaxedAmount) * 100) / 100);
});
