// 定额预算计算规则（ADR-092）：表二、表四甲供与管道工程量计算器。
// 预算书模板开启了“以显示精度为准”，每个格子按它显示的小数位取整后再参与下一步计算，
// 这样卡片和桌面显示的金额与打开 Excel/WPS 后看到的完全一致。

export const REGION_CLASSES = ["一类地区", "二类地区", "三类地区", "四类地区"];
export const MATERIAL_TAX_RATE = 0.13;
export const REUSE_DISCOUNT = 0.7;
// 监理费（模板表五第 9 行）：监理费计费基数 × 3.3% × (1 − 监理费下浮率)，含税再 × (1 + 6%)
export const SUPERVISION_RATE = 0.033;
export const SUPERVISION_TAX_RATE = 0.06;
// 安全生产费（模板表五第 10 行）：建安费（表一 F15）× 2%，含税再 × (1 + 9%)
export const SAFETY_RATE = 0.02;
export const SAFETY_TAX_RATE = 0.09;
// 人工（含税）+ 监理费（含税）+ 安全生产费（含税）超过这个数，项目要上 OA 系统
export const OA_THRESHOLD = 3000;

/** 按小数位四舍五入，先用 toPrecision 消掉浮点误差（例如 1.005）。 */
export function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number((Number(value) * factor).toPrecision(15))) / factor;
}

export function regionIndex(regionClass) {
  const index = REGION_CLASSES.indexOf(String(regionClass || "").trim());
  return index < 0 ? 1 : index;
}

/** 利旧只适用于光缆敷设类定额；光缆接续、端开缆和皮线光缆不打折。 */
export function isReusableQuota(item) {
  const name = String(item?.name || "");
  return name.includes("光缆敷设") && !name.includes("皮线");
}

export function quantityDecimals(unit) {
  return String(unit || "").trim() === "千米" ? 3 : 2;
}

/** 表二一行：H 按地区类别取价（利旧打 7 折），J=H*(1+I)，L=H*K，M=J*K。 */
export function computeTable2Line({ item, quantity, regionClass = "二类地区", taxRate = 0.09, reuse = false }) {
  const basePrice = roundTo(Number(item.prices?.[regionIndex(regionClass)] ?? 0), 2);
  const applyReuse = reuse && isReusableQuota(item);
  const unitPrice = applyReuse ? roundTo(basePrice * REUSE_DISCOUNT, 2) : basePrice;
  const taxedUnitPrice = roundTo(unitPrice * (1 + taxRate), 2);
  const qty = roundTo(quantity, quantityDecimals(item.unit));
  return {
    basePrice,
    reuse: applyReuse,
    unitPrice,
    taxRate,
    taxedUnitPrice,
    quantity: qty,
    amount: roundTo(unitPrice * qty, 2),
    taxedAmount: roundTo(taxedUnitPrice * qty, 2)
  };
}

/** 表四甲供一行：H 为合同最高价（含税），F=ROUND(H/(1+G),4)，J=F*I，K=H*I。 */
export function computeTable4Line({ price, quantity, taxRate = MATERIAL_TAX_RATE }) {
  const taxedUnitPrice = roundTo(price, 4);
  const unitPrice = roundTo(taxedUnitPrice / (1 + taxRate), 4);
  const qty = roundTo(quantity, 2);
  return {
    unitPrice,
    taxRate,
    taxedUnitPrice,
    quantity: qty,
    amount: roundTo(unitPrice * qty, 2),
    taxedAmount: roundTo(taxedUnitPrice * qty, 2)
  };
}

export function sumAmounts(lines, field) {
  return roundTo(lines.reduce((total, line) => total + Number(line[field] || 0), 0), 2);
}

/**
 * 芯数分档：在同名定额的“X芯以下 / X芯以上”档位里取不小于 cores 的最小一档；
 * 超过所有“以下”档时取“以上”档。返回匹配的定额，找不到时返回 null。
 */
export function pickCoreTier(items, cores) {
  const tiers = items.map((item) => {
    const detail = String(item.detail || "");
    const below = detail.match(/(\d+)芯以下/);
    const above = detail.match(/(\d+)芯以上/);
    return { item, below: below ? Number(below[1]) : null, above: above ? Number(above[1]) : null };
  });
  const fits = tiers.filter((tier) => tier.below !== null && tier.below >= cores).sort((a, b) => a.below - b.below);
  if (fits.length) return fits[0].item;
  const top = tiers.filter((tier) => tier.above !== null && cores > tier.above).sort((a, b) => b.above - a.above);
  return top.length ? top[0].item : null;
}

// ---------------- 管道工程量计算器（《管道工程量计算器》生成数据表公式移植） ----------------

/** 开挖路面：开挖定额、修复定额（无修复的为 null）。顺序与计算器“填写数据”第 2–13 行一致。 */
export const PIPE_ROADS = [
  { key: "混凝土路面150mm以下", open: "YGWG-1-02", repair: "YGWG-1-13" },
  { key: "混凝土路面250mm以下", open: "YGWG-1-03", repair: "YGWG-1-14" },
  { key: "混凝土路面350mm以下", open: "YGWG-1-04", repair: "YGWG-1-14" },
  { key: "混凝土路面450mm以下", open: "YGWG-1-05", repair: "YGWG-1-14" },
  { key: "柏油路面150mm以下", open: "YGWG-1-06", repair: "YGWG-1-15" },
  { key: "柏油路面250mm以下", open: "YGWG-1-07", repair: "YGWG-1-16" },
  { key: "砂石路面150mm以下", open: "YGWG-1-08", repair: "YGWG-1-17" },
  { key: "砂石路面250mm以下", open: "YGWG-1-09", repair: "YGWG-1-18" },
  { key: "水泥花砖路面", open: "YGWG-1-10", repair: "YGWG-1-19" },
  { key: "条石路面", open: "YGWG-1-11", repair: null },
  { key: "绿化带路面", open: "YGWG-1-12", repair: "YGWG-1-20" },
  { key: "普通开挖", open: null, repair: null }
];

export const PIPE_WELLS = {
  单页井: { area: 1 * 1.2, depth: 0.85, plaster: 3.28, code: "YGWG-3-1" },
  双页井: { area: 1.3 * 1.6, depth: 0.85, plaster: 5.28, code: "YGWG-3-2" },
  人手井: { area: 0.4 * 0.4 * 3.14, depth: 0.85, plaster: 3.02, code: "YGWG-3-7" },
  监控井: { area: 0.9 * 0.8, depth: 0.6, plaster: 1.28, code: "YGWG-3-4" }
};

export const PIPE_SOILS = [
  { key: "普通土", code: "YGWG-1-21" },
  { key: "硬土", code: "YGWG-1-22" },
  { key: "砂砾土", code: "YGWG-1-23" },
  { key: "软石", code: "YGWG-1-24" },
  { key: "坚石", code: "YGWG-1-25" }
];

export const DEFAULT_SOIL = Object.freeze({ 普通土: 0.5, 砂砾土: 0.5 });

const TRENCH_WIDTH = 0.4;
const TRENCH_DEPTH = 0.85;
const SUBDUCT_WIDTH = 0.3;
const SUBDUCT_DEPTH = 0.4;

const positive = (value) => Math.max(0, Number(value) || 0);

/**
 * 输入：
 * - trench：{ 路面 key: 长度（米） }，开挖和敷管一律 1 孔
 * - jacking：{ 孔数(1~9): 长度（米） }
 * - wells：[{ type: "单页井"|"双页井"|"人手井"|"监控井", road: 路面 key, count }]
 * - subduct：{ length, road } 直埋子管（1 孔）
 * - soil：{ 普通土, 硬土, 砂砾土, 软石, 坚石 } 比例，默认普通土 / 砂砾土各 50%
 * 返回 [{ code, quantity }]，数量为 0 的不返回；顶管用当前定额库编号 YGWG-2-28 / 2-29。
 */
export function calculatePipeQuantities({ trench = {}, jacking = {}, wells = [], subduct = null, soil = DEFAULT_SOIL } = {}) {
  const result = new Map();
  const add = (code, value) => {
    if (!code || !value) return;
    result.set(code, (result.get(code) || 0) + value);
  };
  const trenchLength = (road) => positive(trench[road]);
  const totalTrench = PIPE_ROADS.reduce((sum, road) => sum + trenchLength(road.key), 0);
  const jackingEntries = Object.entries(jacking).map(([holes, length]) => [Math.min(9, Math.max(1, Math.round(Number(holes) || 1))), positive(length)]);
  const totalJacking = jackingEntries.reduce((sum, [, length]) => sum + length, 0);
  const subductLength = positive(subduct?.length);
  const wellList = (Array.isArray(wells) ? wells : []).filter((well) => PIPE_WELLS[well?.type] && positive(well.count));

  add("YGWG-1-01", totalTrench + totalJacking + subductLength);
  for (const road of PIPE_ROADS) {
    const wellArea = wellList.filter((well) => well.road === road.key).reduce((sum, well) => sum + PIPE_WELLS[well.type].area * positive(well.count), 0);
    const subductArea = subduct?.road === road.key ? subductLength * SUBDUCT_WIDTH : 0;
    add(road.open, trenchLength(road.key) * TRENCH_WIDTH + wellArea + subductArea);
    // 修复只算沟和直埋子管，井不修复（与计算器一致）
    add(road.repair, trenchLength(road.key) * TRENCH_WIDTH + subductArea);
  }
  const trenchVolume = totalTrench * TRENCH_WIDTH * TRENCH_DEPTH;
  const wellVolume = wellList.reduce((sum, well) => sum + PIPE_WELLS[well.type].area * PIPE_WELLS[well.type].depth * positive(well.count), 0);
  const subductVolume = subductLength * SUBDUCT_WIDTH * SUBDUCT_DEPTH;
  const excavation = trenchVolume + wellVolume + subductVolume;
  const ratios = normalizeSoil(soil);
  for (const item of PIPE_SOILS) add(item.code, excavation * ratios[item.key]);
  const backfill = trenchVolume + subductVolume;
  add("YGWG-1-26", backfill);
  add("YGWG-1-27", excavation - backfill);
  add("YGWG-2-4", totalTrench);
  add("YGWG-2-28", totalJacking);
  add("YGWG-2-29", jackingEntries.reduce((sum, [holes, length]) => sum + length * (holes - 1), 0));
  for (const well of wellList) add(PIPE_WELLS[well.type].code, positive(well.count));
  add("YGWG-4-2", wellList.reduce((sum, well) => sum + PIPE_WELLS[well.type].plaster * positive(well.count), 0));
  if (subductLength) add("YGWX-2-04", subductLength / 1000);

  return [...result].map(([code, quantity]) => ({ code, quantity: roundTo(quantity, 6) })).filter((line) => line.quantity > 0);
}

/** 土质比例：未给出的项按 0；坚石 = 1 − 其余之和（与计算器一致）；全为 0 时用默认值。 */
export function normalizeSoil(soil = DEFAULT_SOIL) {
  const source = soil && Object.keys(soil).length ? soil : DEFAULT_SOIL;
  const ratios = Object.fromEntries(PIPE_SOILS.map((item) => [item.key, Math.max(0, Number(source[item.key]) || 0)]));
  const others = ratios.普通土 + ratios.硬土 + ratios.砂砾土 + ratios.软石;
  if (others <= 0 && ratios.坚石 <= 0) return normalizeSoil(DEFAULT_SOIL);
  ratios.坚石 = Math.max(0, roundTo(1 - others, 6));
  return ratios;
}

/**
 * 监理费，按模板“以显示精度为准”逐格取 2 位：
 * 计费基数（表一 F17）= 人工除税 ÷ (1 − 施工费下浮率) + 材料（表四甲供）除税（表三、表四乙供本程序不录，为 0）；
 * 监理费（表五 E9）= 基数 × 3.3% × (1 − 监理费下浮率)；含税（G9）= E9 × 1.06。
 */
export function computeSupervision({ table2Amount = 0, table4Amount = 0, contractorDiscount = 0, supervisorDiscount = 0 } = {}) {
  const labor = Number(contractorDiscount) < 1 ? roundTo(Number(table2Amount) / (1 - (Number(contractorDiscount) || 0)), 2) : 0;
  const base = roundTo(labor + Number(table4Amount || 0), 2);
  const amount = roundTo(base * SUPERVISION_RATE * (1 - (Number(supervisorDiscount) || 0)), 2);
  return { base, amount, taxedAmount: roundTo(amount * (1 + SUPERVISION_TAX_RATE), 2) };
}

/**
 * 安全生产费：建安费（表一 F15 = 设计费计费基数 F16 − 表三设备，本程序表三为 0，与监理费计费基数相同）× 2%（表五 E10），
 * 含税（G10）= E10 × 1.09。
 */
export function computeSafety({ base = 0 } = {}) {
  const amount = roundTo(Number(base || 0) * SAFETY_RATE, 2);
  return { amount, taxedAmount: roundTo(amount * (1 + SAFETY_TAX_RATE), 2) };
}
