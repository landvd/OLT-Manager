// 人工（定额库）/ 材料（单价表）的选择目录（ADR-092）：分类、常用标记、用过的次数。桌面添加对话框和飞书表单共用。
import { isReusableQuota } from "./quota-calc.mjs";

/** 日常最常用的人工，默认就是常用；可以在桌面取消。 */
export const DEFAULT_COMMON_QUOTA = Object.freeze(["光缆端开缆", "架空光缆敷设", "管道光缆敷设", "光缆接续"]);
/** 所有预算里用过这么多次的人工 / 材料自动算常用。 */
export const AUTO_COMMON_USES = 3;
export const QUOTA_CATEGORIES = Object.freeze(["光缆线路", "设备安装", "杆路·箱体·管槽", "管道土建", "电缆·整治·其它", "监控"]);

export function quotaCategory(item) {
  const code = String(item.code || "");
  if (code.startsWith("YGWG-")) return "管道土建";
  if (code.startsWith("YGWZ-")) return "监控";
  if (code.startsWith("YGWX-1-")) return "设备安装";
  if (code.startsWith("YGWX-2-")) return "杆路·箱体·管槽";
  if (code.startsWith("YGWX-3-") && /光缆|光纤|光分配架|施工测量/.test(item.name)) return "光缆线路";
  return "电缆·整治·其它";
}

function overrideMap(overrides, kind) {
  return new Map(overrides.filter((entry) => entry.kind === kind).map((entry) => [entry.key, entry.pinned]));
}

/**
 * 人工目录：同名定额（各芯数档 / 规格档）合成一组。
 * common 按：手动设置 > 默认常用 / 用过 AUTO_COMMON_USES 次；常用组排在前面（默认顺序，其余按次数）。
 */
export function buildQuotaCatalog(items, { usage = {}, overrides = [] } = {}) {
  const manual = overrideMap(overrides, "quota");
  const groups = new Map();
  for (const item of items) {
    let group = groups.get(item.name);
    if (!group) {
      group = { name: item.name, category: quotaCategory(item), unit: item.unit, reusable: isReusableQuota(item), uses: 0, tiers: [] };
      groups.set(item.name, group);
    }
    group.uses += usage[item.code] || 0;
    group.tiers.push({ code: item.code, detail: item.detail, unit: item.unit, prices: item.prices, workContent: item.workContent });
  }
  const list = [...groups.values()].map((group) => {
    const defaultRank = DEFAULT_COMMON_QUOTA.indexOf(group.name);
    const auto = defaultRank >= 0 || group.uses >= AUTO_COMMON_USES;
    return { ...group, common: manual.has(group.name) ? manual.get(group.name) : auto, defaultRank: defaultRank >= 0 ? defaultRank : 99 };
  });
  const common = list.filter((group) => group.common).sort((a, b) => a.defaultRank - b.defaultRank || b.uses - a.uses);
  return { categories: QUOTA_CATEGORIES, groups: list.map(({ defaultRank, ...group }) => group), common: common.map((group) => group.name) };
}

/** 材料目录：分类取单价表的分表名；常用取单价表“常用物料”，可手动设置，用过 AUTO_COMMON_USES 次也算常用。 */
export function buildMaterialCatalog(materials, { usage = {}, overrides = [], today = "" } = {}) {
  const manual = overrideMap(overrides, "material");
  const categories = [];
  const items = materials.map((material) => {
    if (!categories.includes(material.sheet)) categories.push(material.sheet);
    const uses = usage[material.code] || 0;
    const auto = material.common || uses >= AUTO_COMMON_USES;
    return {
      code: material.code,
      name: material.name,
      spec: material.spec,
      attr: material.attr,
      unit: material.unit,
      maxPrice: material.maxPrice,
      sheet: material.sheet,
      contractEnd: material.contractEnd,
      expired: Boolean(material.contractEnd && today && material.contractEnd < today),
      inPriceBookCommon: Boolean(material.common),
      common: manual.has(material.code) ? manual.get(material.code) : auto,
      uses
    };
  });
  return { categories, items };
}

// 常用材料分组顺序：日常最常用的排前面（单价表分表名去掉空格和横线后比较）
const SHEET_ORDER = ["光缆", "光缆接头盒", "光缆分纤箱", "皮线光缆", "终端盒", "管材", "光交箱", "室外设备箱", "复合缆", "东莞自行采购"];

function sheetRank(sheet) {
  const key = String(sheet || "").replace(/[\s-]/g, "");
  const exact = SHEET_ORDER.indexOf(key);
  if (exact >= 0) return exact;
  const index = SHEET_ORDER.findIndex((word, position) => position > 0 && key.includes(word));
  return index < 0 ? SHEET_ORDER.length : index;
}

/** 分表名显示用：“箱体 --光缆分纤箱”→“光缆分纤箱”。 */
export function sheetLabel(sheet) {
  return String(sheet || "").replace(/\s*-+\s*/g, " · ").replace(/^箱体 · /, "");
}

/** 同组材料按芯数 / 分光比从小到大排。 */
export function materialSize(item) {
  const text = `${item.spec} ${item.attr}`;
  const ratio = text.match(/1分(\d+)/);
  if (ratio) return Number(ratio[1]);
  const cores = text.match(/(\d+)芯/);
  return cores ? Number(cores[1]) : 9999;
}

/** 材料短名：光缆显示“GYTS 24芯”，其余取规格 + 属性（去掉 #、括注、尺寸单位里的“毫米”等）。 */
export function materialShortLabel(item, limit = 26) {
  const spec = String(item.spec || "").replace(/#/g, "");
  const cores = spec.match(/(\d+)芯/);
  const model = spec.match(/^([A-Za-z]+)-?\d/);
  if (item.name === "光缆" && cores) return `${model ? `${model[1]} ` : ""}${cores[1]}芯`;
  const text = [spec, String(item.attr || "").replace(/#/g, "")].filter(Boolean).join(" ")
    .replace(/（[^）]*）|\([^)]*\)/g, " ").replace(/最大配线容量|单面操作|室内：壁挂\s*室外：壁挂、杆挂/g, " ").replace(/毫米/g, "mm")
    .replace(/\s*[,，]\s*/g, " ").replace(/(^|\s)0(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 常用材料按分表分组（分组按日常常用顺序，组内按芯数 / 分光比）。sameName：组内同名时按钮可只显示规格。 */
export function commonMaterialGroups(materialCatalog) {
  const bySheet = new Map();
  for (const item of materialCatalog.items) {
    if (!item.common) continue;
    if (!bySheet.has(item.sheet)) bySheet.set(item.sheet, []);
    bySheet.get(item.sheet).push(item);
  }
  return materialCatalog.categories.filter((sheet) => bySheet.has(sheet)).sort((a, b) => sheetRank(a) - sheetRank(b)).map((sheet) => {
    const items = [...bySheet.get(sheet)].sort((a, b) => materialSize(a) - materialSize(b));
    return { sheet, label: sheetLabel(sheet), items, sameName: items.every((item) => item.name === items[0].name) };
  });
}

/** 某个分表的材料：常用在前，再按芯数 / 分光比。 */
export function sheetMaterials(materialCatalog, sheet) {
  return materialCatalog.items.filter((item) => item.sheet === sheet).sort((a, b) => Number(b.common) - Number(a.common) || materialSize(a) - materialSize(b));
}
