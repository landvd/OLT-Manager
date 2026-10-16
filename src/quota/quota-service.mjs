// 定额预算服务（ADR-092）：导入资料、基础信息模板、预算录入与生成预算书。桌面接口与飞书定额模式共用。
// 只读写本地 SQLite 和用户导入 / 生成的文件，不访问 OLT。
import { createHash } from "node:crypto";
import { buildBudgetWorkbook, computeBudget } from "./budget-workbook.mjs";
import { OA_THRESHOLD, REGION_CLASSES, calculatePipeQuantities, isReusableQuota } from "./quota-calc.mjs";
import { buildMaterialCatalog, buildQuotaCatalog } from "./quota-catalog.mjs";
import { INFO_FIELDS, PER_BUDGET_FIELDS, parseBudgetTemplate, parseMaterialPriceBook } from "./quota-import.mjs";
import {
  learnKey, matchMaterials, matchQuotaItems, mergePipeInput, parseItemUtterance, parsePipeUtterance, parseQuotaCommand,
  poolMaterials, poolQuotaItems, resolveQuotaTier, splitUtterance, unitFactor
} from "./quota-parser.mjs";

const REQUIRED_FIELDS = INFO_FIELDS.filter((field) => field.required);
export const OA_NOTICE = `项目人工超过 ${OA_THRESHOLD}，需要上 OA 系统`;
// 计件单位之间不换算（说“3个”，定额单位是“端”时按 3 端）
const COUNT_UNITS = new Set(["个", "端", "芯", "台", "套", "处", "根", "条", "块", "只", "座", "架", "点", "项", "盘", "卷", "副", "对", "片", ""]);
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function quotaError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function presetFieldsFrom(info) {
  return Object.fromEntries(Object.entries(info).filter(([key]) => !PER_BUDGET_FIELDS.includes(key)));
}

export function createQuotaService({ repo, now = () => new Date() }) {
  const cache = { templateId: null, items: null, itemMap: null, importId: null, materials: null, materialMap: null };

  async function requireTemplate() {
    const template = await repo.getActiveQuotaTemplate();
    if (!template) throw quotaError("还没有导入预算书模板，请先在桌面“定额预算 → 模板与单价”里导入", 409);
    return template;
  }

  async function quotaItems(templateId) {
    if (cache.templateId !== templateId) {
      cache.items = await repo.getQuotaItems(templateId);
      cache.itemMap = new Map(cache.items.map((item) => [item.code, item]));
      cache.templateId = templateId;
    }
    return { items: cache.items, map: cache.itemMap };
  }

  async function materials() {
    const active = await repo.getActiveMaterialImport();
    if (!active) return { active: null, list: [], map: new Map() };
    if (cache.importId !== active.id) {
      cache.materials = await repo.getMaterials(active.id);
      cache.materialMap = new Map(cache.materials.map((item) => [item.code, item]));
      cache.importId = active.id;
    }
    return { active, list: cache.materials, map: cache.materialMap };
  }

  async function requireBudget(id) {
    const budget = await repo.getBudget(id);
    if (!budget) throw quotaError("预算不存在或已删除", 404);
    return budget;
  }

  // ---------------- 资料导入 ----------------

  async function importTemplate({ fileName = "预算书模板.xlsx", buffer }) {
    let parsed;
    try {
      parsed = parseBudgetTemplate(buffer);
    } catch (error) {
      throw quotaError(error.message);
    }
    const templateId = await repo.saveQuotaTemplate({ fileName, sha256: sha256(buffer), fileBase64: Buffer.from(buffer).toString("base64"), parsed });
    cache.templateId = null;
    const presets = await repo.getBudgetInfoPresets();
    if (!presets.length) {
      await repo.saveBudgetInfoPreset({ name: "默认模板", fields: presetFieldsFrom(parsed.infoDefaults), isDefault: true });
    }
    return { templateId, itemCount: parsed.quotaItems.length, warnings: parsed.warnings };
  }

  async function previewMaterials({ buffer }) {
    let parsed;
    try {
      parsed = parseMaterialPriceBook(buffer);
    } catch (error) {
      throw quotaError(error.message);
    }
    const { list: current } = await materials();
    const previous = new Map(current.map((item) => [item.code, item]));
    const today = localDate(now());
    const added = parsed.materials.filter((item) => !previous.has(item.code));
    const changed = parsed.materials.filter((item) => previous.has(item.code) && Math.abs(previous.get(item.code).maxPrice - item.maxPrice) > 1e-9)
      .map((item) => ({ code: item.code, name: item.name, spec: item.spec, before: previous.get(item.code).maxPrice, after: item.maxPrice }));
    const removed = current.filter((item) => !parsed.materials.some((next) => next.code === item.code)).map(({ code, name, spec }) => ({ code, name, spec }));
    const expired = parsed.materials.filter((item) => item.contractEnd && item.contractEnd < today).map(({ code, name, spec, contractEnd }) => ({ code, name, spec, contractEnd }));
    return {
      materialCount: parsed.materials.length,
      commonCount: parsed.materials.filter((item) => item.common).length,
      added: added.length,
      changed,
      removed,
      expired,
      skipped: parsed.skipped,
      parsed
    };
  }

  async function importMaterials({ fileName = "材料单价参考.xlsx", buffer }) {
    const preview = await previewMaterials({ buffer });
    const summary = { added: preview.added, changed: preview.changed.length, removed: preview.removed.length, expired: preview.expired.length, skipped: preview.skipped };
    const importId = await repo.saveMaterialImport({ fileName, sha256: sha256(buffer), materials: preview.parsed.materials, summary });
    cache.importId = null;
    return { importId, materialCount: preview.materialCount, ...summary };
  }

  async function status() {
    const template = await repo.getActiveQuotaTemplate();
    const { active } = await materials();
    return {
      template: template && { id: template.id, fileName: template.fileName, importedAt: template.importedAt, itemCount: template.itemCount, warnings: template.warnings, constructionUnits: template.constructionUnits },
      materials: active && { id: active.id, fileName: active.fileName, importedAt: active.importedAt, materialCount: active.materialCount, summary: active.summary },
      presets: await repo.getBudgetInfoPresets(),
      infoFields: INFO_FIELDS,
      regionClasses: REGION_CLASSES,
      recentNames: await repo.getRecentBudgetNames()
    };
  }

  // ---------------- 检索 ----------------

  async function searchQuota(q = "", { limit = 30 } = {}) {
    const template = await requireTemplate();
    const { items } = await quotaItems(template.id);
    const words = String(q).trim().split(/\s+/).filter(Boolean);
    const hits = words.length ? items.filter((item) => words.every((word) => `${item.code} ${item.name} ${item.detail}`.includes(word))) : items;
    return hits.slice(0, limit);
  }

  async function searchMaterials(q = "", { limit = 30 } = {}) {
    const { list } = await materials();
    const words = String(q).trim().split(/\s+/).filter(Boolean);
    const hits = words.length ? list.filter((item) => words.every((word) => `${item.code} ${item.name} ${item.spec} ${item.attr}`.includes(word))) : list;
    return hits.slice(0, limit);
  }

  /** 人工 / 材料的选择目录：分类、常用、用过的次数（桌面添加对话框、飞书表单用）。 */
  async function catalog() {
    const template = await requireTemplate();
    const { items } = await quotaItems(template.id);
    const { list } = await materials();
    const [usage, overrides] = await Promise.all([repo.getQuotaUsage(), repo.getQuotaCommonOverrides()]);
    return {
      quota: buildQuotaCatalog(items, { usage: usage.quota, overrides }),
      material: buildMaterialCatalog(list, { usage: usage.material, overrides, today: localDate(now()) })
    };
  }

  /** 设为常用 / 取消常用：人工按项目名称，材料按物料编码。 */
  async function setCommon({ kind, key, pinned }) {
    if (!["quota", "material"].includes(kind)) throw quotaError("只能设置人工或材料的常用");
    const value = String(key || "").trim();
    if (!value) throw quotaError("缺少要设置的项目");
    await repo.setQuotaCommonOverride({ kind, key: value, pinned: Boolean(pinned) });
    return catalog();
  }

  /** 没选预算时桌面右边的概览：预算数、本月新建、最近几份的金额和 OA 提醒、资料状态。 */
  async function overview({ recentLimit = 6 } = {}) {
    const budgets = await repo.listBudgets({ limit: 200 });
    const month = localDate(now()).slice(0, 7);
    const recent = [];
    for (const budget of budgets.slice(0, recentLimit)) {
      try {
        const view = await budgetView(budget.id);
        recent.push({
          id: budget.id, name: budget.name, location: budget.location, updatedAt: budget.updatedAt,
          createdBy: budget.createdBy, createdByName: budget.createdByName, regionClass: budget.info.regionClass,
          quotaCount: budget.quotaCount, materialCount: budget.materialCount,
          table2TaxedAmount: view.totals.table2TaxedAmount, table4TaxedAmount: view.totals.table4TaxedAmount,
          supervisionTaxedAmount: view.totals.supervisionTaxedAmount, safetyTaxedAmount: view.totals.safetyTaxedAmount, taxedTotal: view.totals.taxedTotal,
          oaAmount: view.totals.oaAmount, needsOa: view.totals.needsOa
        });
      } catch {
        // 模板已删的旧预算不影响概览
      }
    }
    return {
      budgetCount: budgets.length,
      monthCount: budgets.filter((budget) => String(budget.info.preparedDate || "").startsWith(month)).length,
      feishuCount: budgets.filter((budget) => budget.createdBy !== "desktop").length,
      oaCount: recent.filter((budget) => budget.needsOa).length,
      oaThreshold: OA_THRESHOLD,
      recent
    };
  }

  // ---------------- 基础信息模板 ----------------

  async function savePreset({ id, name, fields, isDefault }) {
    const clean = Object.fromEntries(Object.entries(fields || {}).filter(([key]) => INFO_FIELDS.some((field) => field.key === key) && !PER_BUDGET_FIELDS.includes(key)));
    return repo.saveBudgetInfoPreset({ id, name, fields: clean, isDefault });
  }

  async function savePresetFromBudget(budgetId, { name, isDefault = false }) {
    const budget = await requireBudget(budgetId);
    return repo.saveBudgetInfoPreset({ name, fields: presetFieldsFrom(budget.info), isDefault });
  }

  // ---------------- 预算 ----------------

  function validateInfo(info) {
    for (const field of REQUIRED_FIELDS) {
      if (!String(info[field.key] ?? "").trim()) throw quotaError(`请填写${field.label}`);
    }
    if (!REGION_CLASSES.includes(info.regionClass)) throw quotaError(`建设地区类别只能是${REGION_CLASSES.join("、")}`);
    for (const field of INFO_FIELDS.filter((item) => item.type === "rate")) {
      const value = Number(info[field.key]);
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw quotaError(`${field.label}应在 0%～100% 之间`);
    }
  }

  async function createBudget({ presetId = null, projectName, location, preparer, reviewer, createdBy = "desktop", createdByName = "" }) {
    const template = await requireTemplate();
    const presets = await repo.getBudgetInfoPresets();
    const preset = presets.find((item) => item.id === Number(presetId)) || presets.find((item) => item.isDefault) || presets[0];
    const info = {
      ...presetFieldsFrom(template.infoDefaults),
      ...(preset ? preset.fields : {}),
      projectName: String(projectName || "").trim(),
      location: String(location || "").trim(),
      preparer: String(preparer || "").trim(),
      reviewer: String(reviewer || "").trim(),
      projectCode: "",
      preparedDate: localDate(now())
    };
    validateInfo(info);
    const budget = await repo.createBudget({ info, templateId: template.id, createdBy, createdByName });
    await repo.recordBudgetNames({ preparer: info.preparer, reviewer: info.reviewer });
    return budget;
  }

  async function updateBudgetInfo(id, patch = {}) {
    const budget = await requireBudget(id);
    const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => INFO_FIELDS.some((field) => field.key === key && !field.readOnly)));
    for (const field of INFO_FIELDS.filter((item) => item.type === "rate")) {
      if (allowed[field.key] !== undefined) allowed[field.key] = Number(allowed[field.key]);
    }
    if (allowed.preparedDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(allowed.preparedDate))) throw quotaError("编制日期格式应为 年-月-日");
    const info = { ...budget.info, ...allowed, projectCode: "" };
    validateInfo(info);
    const updated = await repo.updateBudgetInfo(id, info);
    await repo.recordBudgetNames({ preparer: info.preparer, reviewer: info.reviewer });
    return updated;
  }

  /** 表二输出行：直接录入的行按顺序；管道生成的同编号定额并入未利旧、无备注的直接录入行，否则追加。 */
  function mergeTable2(directLines, pipeLines, itemMap) {
    const merged = directLines.map((line) => ({ code: line.code, quantity: line.quantity, reuse: line.reuse, remark: line.remark, lineIds: [line.id], fromPipe: false }));
    for (const pipe of pipeLines) {
      const target = merged.find((line) => line.code === pipe.code && !line.reuse && !line.remark);
      if (target) {
        target.quantity += pipe.quantity;
        target.fromPipe = true;
      } else {
        merged.push({ code: pipe.code, quantity: pipe.quantity, reuse: false, remark: "", lineIds: [], fromPipe: true });
      }
    }
    const missing = merged.filter((line) => !itemMap.has(line.code)).map((line) => line.code);
    return { lines: merged.filter((line) => itemMap.has(line.code)).map((line) => ({ ...line, item: itemMap.get(line.code) })), missing };
  }

  async function budgetView(id) {
    const budget = await requireBudget(id);
    const { map: itemMap } = await quotaItems(budget.templateId);
    const [quotaLines, materialLines, pipeInput] = await Promise.all([
      repo.getBudgetQuotaLines(id), repo.getBudgetMaterialLines(id), repo.getBudgetPipeInput(id)
    ]);
    const pipeLines = calculatePipeQuantities(pipeInput);
    const { lines: table2Input, missing } = mergeTable2(quotaLines, pipeLines, itemMap);
    const { map: materialMap } = await materials();
    const table4Input = materialLines.map((line) => ({
      lineId: line.id,
      material: { code: line.code, name: line.name, spec: line.spec, unit: line.unit, maxPrice: line.price },
      price: line.price,
      quantity: line.quantity,
      remark: line.remark
    }));
    const computed = computeBudget({ info: budget.info, table2: table2Input, table4: table4Input });
    const priceChanges = materialLines.filter((line) => materialMap.has(line.code) && Math.abs(materialMap.get(line.code).maxPrice - line.price) > 1e-9)
      .map((line) => ({ lineId: line.id, code: line.code, name: line.name, before: line.price, after: materialMap.get(line.code).maxPrice }));
    return {
      budget,
      quotaLines: quotaLines.map((line) => ({ ...line, item: itemMap.get(line.code) || null })),
      materialLines,
      pipeInput,
      pipeLines: pipeLines.map((line) => ({ ...line, item: itemMap.get(line.code) || null })),
      table2: computed.table2.map((line) => ({ code: line.code, name: line.item.name, detail: line.item.detail, unit: line.item.unit, remark: line.remark || (line.calc.reuse ? "利旧" : ""), lineIds: line.lineIds, fromPipe: line.fromPipe, ...line.calc })),
      table4: computed.table4.map((line) => ({ lineId: line.lineId, code: line.material.code, name: line.material.name, spec: line.material.spec, unit: line.material.unit, remark: line.remark, ...line.calc })),
      totals: computed.totals,
      // 人工 + 监理费 + 安全生产费（含税）超过 3000：桌面红字并弹警告、飞书卡片红字
      oaNotice: computed.totals.needsOa ? `${OA_NOTICE}（人工 + 监理费 + 安全生产费含税 ${computed.totals.oaAmount.toFixed(2)}）` : "",
      warnings: [
        ...missing.map((code) => `定额 ${code} 在当前模板的定额库里找不到，生成时会跳过`),
        ...(priceChanges.length ? [`有 ${priceChanges.length} 项材料单价与最新单价表不同`] : [])
      ],
      priceChanges
    };
  }

  async function addQuotaLine(budgetId, { code, quantity, reuse = false, remark = "", utterance = "" }) {
    const budget = await requireBudget(budgetId);
    const { map } = await quotaItems(budget.templateId);
    const item = map.get(String(code || "").trim());
    if (!item) throw quotaError(`定额库里没有 ${code}`);
    if (!(Number(quantity) > 0)) throw quotaError("数量必须大于 0");
    if (reuse && !isReusableQuota(item)) throw quotaError(`“${item.name}”不适用利旧打折，只有光缆敷设（不含皮线）可以利旧`);
    return repo.addBudgetQuotaLine(budgetId, { code: item.code, quantity: Number(quantity), reuse: Boolean(reuse), remark: remark || (reuse ? "利旧" : ""), utterance });
  }

  /** 修改人工：数量、利旧、备注，也可以换成同名的另一档（code）。 */
  async function updateQuotaLine(budgetId, lineId, patch = {}) {
    const budget = await requireBudget(budgetId);
    if (patch.quantity !== undefined && !(Number(patch.quantity) > 0)) throw quotaError("数量必须大于 0");
    const line = (await repo.getBudgetQuotaLines(budgetId)).find((entry) => entry.id === Number(lineId));
    if (!line) throw quotaError("这条人工已不存在", 404);
    const { map } = await quotaItems(budget.templateId);
    const code = patch.code !== undefined ? String(patch.code).trim() : line.code;
    const item = map.get(code);
    if (!item) throw quotaError(`定额库里没有 ${code}`);
    const reuse = patch.reuse !== undefined ? Boolean(patch.reuse) : line.reuse;
    if (reuse && !isReusableQuota(item)) throw quotaError(`“${item.name}”不适用利旧打折，只有光缆敷设（不含皮线）可以利旧`);
    let remark = patch.remark !== undefined ? String(patch.remark).trim() : line.remark;
    // 利旧的备注默认写“利旧”；取消利旧时去掉自动写的“利旧”
    if (reuse && !remark) remark = "利旧";
    if (!reuse && remark === "利旧") remark = "";
    return repo.updateBudgetQuotaLine(budgetId, lineId, {
      code,
      ...(patch.quantity !== undefined ? { quantity: Number(patch.quantity) } : {}),
      reuse,
      remark
    });
  }

  async function addMaterialLine(budgetId, { code, quantity, remark = "", utterance = "" }) {
    await requireBudget(budgetId);
    const { map } = await materials();
    const material = map.get(String(code || "").trim());
    if (!material) throw quotaError(`单价表里没有物料编码 ${code}`);
    if (!(Number(quantity) > 0)) throw quotaError("数量必须大于 0");
    return repo.addBudgetMaterialLine(budgetId, { material, quantity: Number(quantity), remark, utterance });
  }

  /** 修改材料：数量、备注；换了物料编码时按最新单价表换成那种材料。 */
  async function updateMaterialLine(budgetId, lineId, patch = {}) {
    await requireBudget(budgetId);
    if (patch.quantity !== undefined && !(Number(patch.quantity) > 0)) throw quotaError("数量必须大于 0");
    const line = (await repo.getBudgetMaterialLines(budgetId)).find((entry) => entry.id === Number(lineId));
    if (!line) throw quotaError("这条材料已不存在", 404);
    let material;
    if (patch.code !== undefined && String(patch.code).trim() !== line.code) {
      material = (await materials()).map.get(String(patch.code).trim());
      if (!material) throw quotaError(`单价表里没有物料编码 ${patch.code}`);
    }
    return repo.updateBudgetMaterialLine(budgetId, lineId, {
      ...(material ? { material } : {}),
      ...(patch.quantity !== undefined ? { quantity: Number(patch.quantity) } : {}),
      ...(patch.remark !== undefined ? { remark: String(patch.remark).trim() } : {})
    });
  }

  /** 按最新单价表刷新预算里的材料单价（用户确认后调用）。 */
  async function refreshMaterialPrices(budgetId) {
    const view = await budgetView(budgetId);
    for (const change of view.priceChanges) await repo.updateBudgetMaterialLine(budgetId, change.lineId, { price: change.after });
    return view.priceChanges.length;
  }

  async function savePipeInput(budgetId, input = {}) {
    await requireBudget(budgetId);
    const clean = {
      trench: Object.fromEntries(Object.entries(input.trench || {}).filter(([, length]) => Number(length) > 0).map(([road, length]) => [road, Number(length)])),
      jacking: Object.fromEntries(Object.entries(input.jacking || {}).filter(([holes, length]) => Number(holes) >= 1 && Number(holes) <= 9 && Number(length) > 0).map(([holes, length]) => [String(Math.round(Number(holes))), Number(length)])),
      wells: (Array.isArray(input.wells) ? input.wells : []).filter((well) => well?.type && Number(well.count) > 0).map((well) => ({ type: well.type, road: well.road || "", count: Number(well.count) })),
      subduct: input.subduct && Number(input.subduct.length) > 0 ? { length: Number(input.subduct.length), road: input.subduct.road || "" } : null,
      ...(input.soil ? { soil: input.soil } : {})
    };
    await repo.saveBudgetPipeInput(budgetId, clean);
    return clean;
  }

  /** 换算成定额 / 物料的单位；不能换算时 note 说明，数量按原数。 */
  function convertQuantity(quantity, fromUnit, toUnit) {
    if (quantity === null || quantity === undefined) return { quantity: null };
    const factor = unitFactor(fromUnit, toUnit);
    if (factor !== null) return { quantity: Math.round(quantity * factor * 1e6) / 1e6, note: factor === 1 || !fromUnit ? "" : `${quantity}${fromUnit} = ${Math.round(quantity * factor * 1e6) / 1e6}${toUnit}` };
    if (COUNT_UNITS.has(fromUnit) && COUNT_UNITS.has(toUnit)) return { quantity, note: "" };
    return { quantity, note: `说的单位是“${fromUnit}”，定额单位是“${toUnit}”，请核对数量` };
  }

  // ---------------- 说法理解（飞书定额模式）：学到的说法 → 本地规则 → 拿不准时问大模型 ----------------

  const learnedCache = { list: null };
  async function learnedPhrases() {
    learnedCache.list ||= await repo.getLearnedPhrases({ limit: 2000 });
    return learnedCache.list;
  }

  async function sources(budgetId) {
    const budget = budgetId ? await repo.getBudget(budgetId) : null;
    const template = budget ? { id: budget.templateId } : await requireTemplate();
    const { items, map: itemMap } = await quotaItems(template.id);
    const { list: materialList, map: materialMap } = await materials();
    return { items, itemMap, materialList, materialMap };
  }

  const withQuantity = (parsed, entry, unit) => ({ ...entry, ...convertQuantity(parsed.quantity, parsed.unit, unit) });

  function sameChoice(a, b) {
    return (a.item && b.item && a.item.code === b.item.code) || (a.material && b.material && a.material.code === b.material.code);
  }

  /** 本地规则是否拿得准：首选够像，且没有分不清的不同名候选。 */
  function confidentLocal(kind, candidates) {
    const [top, second] = candidates;
    if (!top) return false;
    if (kind === "quota") {
      if (top.score < 0.85) return false;
      return !(second && second.item.name !== top.item.name && second.score >= top.score - 0.08);
    }
    if (top.score < 0.9) return false;
    return !(second && second.material.name !== top.material.name && second.score >= top.score - 0.05);
  }

  /**
   * 解析一句话（不落库）。返回 kind：command / error / pipe / quota / material / unknown；
   * quota、material 带 candidates（首选在前，source 为 learned / rule / model）和 confident（本地是否拿得准）。
   */
  async function interpret(budgetId, text) {
    const command = parseQuotaCommand(text);
    if (command) return { kind: "command", ...command };
    const pipe = parsePipeUtterance(text);
    if (pipe) return pipe.error ? { kind: "error", message: pipe.error } : { kind: "pipe", ...pipe };
    const parsed = parseItemUtterance(text);
    if (!parsed.keywords) return { kind: "unknown", parsed, confident: false };
    const { items, itemMap, materialList, materialMap } = await sources(budgetId);
    const localQuota = () => matchQuotaItems(items, parsed).map((entry) => withQuantity(parsed, { ...entry, source: "rule" }, entry.item.unit));
    const localMaterial = () => matchMaterials(materialList, parsed).map((entry) => withQuantity(parsed, { ...entry, source: "rule" }, entry.material.unit));

    // 1) 学到的说法：完全相同的说法直接按学过的处理（芯数、规格仍按规则定档）
    const key = learnKey(parsed);
    const learned = (await learnedPhrases()).filter((entry) => entry.phrase === key)
      .sort((a, b) => (a.kind === parsed.mode ? -1 : 0) - (b.kind === parsed.mode ? -1 : 0))[0];
    if (learned) {
      if (learned.kind === "quota" && itemMap.has(learned.code)) {
        const item = resolveQuotaTier(items, itemMap.get(learned.code), parsed);
        const first = withQuantity(parsed, { item, score: 1, source: "learned", reason: `按学过的说法“${learned.example || learned.phrase}”` }, item.unit);
        const rest = localQuota().filter((entry) => !sameChoice(entry, first));
        return { kind: "quota", parsed, candidates: [first, ...rest].slice(0, 4), confident: true };
      }
      if (learned.kind === "material" && materialMap.has(learned.code)) {
        const material = materialMap.get(learned.code);
        const first = withQuantity(parsed, { material, score: 1, source: "learned", reason: `按学过的说法“${learned.example || learned.phrase}”` }, material.unit);
        const rest = localMaterial().filter((entry) => !sameChoice(entry, first));
        return { kind: "material", parsed, candidates: [first, ...rest].slice(0, 4), confident: true };
      }
    }

    // 2) 本地规则
    let kind = parsed.mode;
    let candidates = kind === "quota" ? localQuota() : localMaterial();
    if (!candidates.length) {
      // 没指明类型时另一边也找一找
      const other = kind === "quota" ? localMaterial() : localQuota();
      if (other.length) {
        kind = kind === "quota" ? "material" : "quota";
        candidates = other;
      }
    }
    if (!candidates.length) return { kind: "unknown", parsed, confident: false };
    return { kind, parsed, candidates, confident: confidentLocal(kind, candidates) };
  }

  /** 一句话说了几条时逐段解析；只有一段时返回 null（按单条处理）。 */
  async function interpretMany(budgetId, text) {
    const parts = splitUtterance(text);
    if (parts.length <= 1) return null;
    const results = [];
    for (const part of parts) results.push({ text: part, ...(await interpret(budgetId, part)) });
    return results;
  }

  const MODEL_SYSTEM = [
    "你是广东广电网络工程预算的录入助手：把外勤说的一句话对应到候选清单里的一条定额（表二）或一种材料（表四甲供）。",
    "只能从给出的候选里选，用候选编号（Q 开头是定额，M 开头是材料）；只返回一个 JSON，不要任何其它文字。",
    "JSON 格式：{\"kind\":\"quota|material|unknown\",\"id\":\"Q3\",\"quantity\":数字,\"unit\":\"句子里的单位\",\"reuse\":false,\"remark\":\"\"}",
    "规则：敷设、布放、安装、熔接、接续、开挖、测试、调试等施工动作是定额；光缆、分路器、箱体、接头盒等要买的东西是材料。",
    "熔接就是接续；光缆按芯数就高一档（24芯选“36芯以下”或“48芯以下”中最小且不小于24的一档）。",
    "利旧（reuse=true）只适用于光缆敷设；remark 填用途，例如“架空用”，没有就留空。",
    "参考例子是现场确认过的说法；无法判断时返回 {\"kind\":\"unknown\"}。"
  ].join("\n");

  function relevantExamples(list, key, limit = 12) {
    const chars = new Set([...key]);
    return list.map((entry) => ({ entry, share: [...entry.phrase].filter((char) => chars.has(char)).length / Math.max(1, entry.phrase.length) }))
      .filter((item) => item.share >= 0.5).sort((a, b) => b.share - a.share).slice(0, limit)
      .map(({ entry }) => `${entry.example || entry.phrase} → ${entry.code} ${entry.label}`);
  }

  /**
   * 本地拿不准时问大模型：只给原话、本地候选池和相关的已学说法，模型只能选候选编号；
   * 返回的编号不在候选里、数量不合法或调用失败时退回本地结果（带 modelNote 说明）。
   */
  async function interpretWithModel(budgetId, text, local, askModel) {
    const parsed = local.parsed || parseItemUtterance(text);
    const { items, materialList } = await sources(budgetId);
    const quotaPool = poolQuotaItems(items, parsed);
    const materialPool = poolMaterials(materialList, parsed);
    if (!quotaPool.length && !materialPool.length) return { ...local, modelNote: "大模型也没有可选的候选" };
    const pool = {};
    quotaPool.forEach((item, index) => { pool[`Q${index + 1}`] = { kind: "quota", item, label: `${item.code} ${item.name}${item.detail ? ` ${item.detail}` : ""} [${item.unit}]` }; });
    materialPool.forEach((material, index) => { pool[`M${index + 1}`] = { kind: "material", material, label: `${material.code} ${material.name} ${material.spec}${material.attr ? ` ${material.attr}` : ""} [${material.unit}]` }; });
    const user = JSON.stringify({
      text,
      candidates: Object.fromEntries(Object.entries(pool).map(([id, entry]) => [id, entry.label])),
      examples: relevantExamples(await learnedPhrases(), learnKey(parsed))
    });
    let answer;
    try {
      const output = String(await askModel({ system: MODEL_SYSTEM, user, maxTokens: 200 }) || "");
      const start = output.indexOf("{");
      const end = output.lastIndexOf("}");
      answer = start >= 0 && end > start ? JSON.parse(output.slice(start, end + 1)) : null;
    } catch {
      return { ...local, modelNote: "大模型暂时没有响应，先按本地规则" };
    }
    const chosen = answer && pool[String(answer.id || "").trim()];
    if (!chosen || answer.kind === "unknown") return { ...local, modelNote: "大模型也拿不准，请从候选里选" };
    const quantity = parsed.quantity ?? (Number(answer.quantity) > 0 ? Number(answer.quantity) : null);
    const unit = parsed.quantity !== null ? parsed.unit : String(answer.unit || "");
    const modelParsed = { ...parsed, quantity, unit, reuse: parsed.reuse || answer.reuse === true, remark: parsed.remark || String(answer.remark || "").slice(0, 20) };
    let first;
    if (chosen.kind === "quota") {
      const item = resolveQuotaTier(items, chosen.item, parsed);
      first = withQuantity(modelParsed, { item, score: 1, source: "model", reason: "大模型理解" }, item.unit);
    } else {
      first = withQuantity(modelParsed, { material: chosen.material, score: 1, source: "model", reason: "大模型理解" }, chosen.material.unit);
    }
    const rest = (local.kind === chosen.kind ? local.candidates || [] : []).filter((entry) => !sameChoice(entry, first));
    return { kind: chosen.kind, parsed: modelParsed, candidates: [first, ...rest].slice(0, 4), confident: true, modelUsed: true };
  }

  /** 确认加入时记下说法（确认后直接生效）。corrected：用户没选推荐项，改选了别的候选。 */
  async function learnPhrase({ text, kind, code, corrected = false, createdBy = "" }) {
    const parsed = parseItemUtterance(text);
    const phrase = learnKey(parsed);
    if (!phrase || !["quota", "material"].includes(kind)) return null;
    let label = "";
    if (kind === "quota") {
      const { items } = await quotaItems((await requireTemplate()).id);
      const item = items.find((entry) => entry.code === code);
      label = item ? `${item.name}${item.detail ? ` ${item.detail}` : ""}` : "";
    } else {
      const material = (await materials()).map.get(code);
      label = material ? `${material.name} ${material.spec}` : "";
    }
    await repo.saveLearnedPhrase({ phrase, kind, code, label, example: String(text).trim().slice(0, 60), corrected, createdBy });
    learnedCache.list = null;
    return { phrase, kind, code, label };
  }

  async function deleteLearned(id) {
    await repo.deleteLearnedPhrase(id);
    learnedCache.list = null;
  }

  async function mergePipe(budgetId, addition) {
    await requireBudget(budgetId);
    return savePipeInput(budgetId, mergePipeInput(await repo.getBudgetPipeInput(budgetId), addition));
  }

  async function exportBudget(budgetId) {
    const view = await budgetView(budgetId);
    const template = await repo.getQuotaTemplate(view.budget.templateId, { withFile: true });
    if (!template) throw quotaError("这份预算用的预算书模板已不存在，请重新导入模板", 409);
    if (!view.table2.length && !view.table4.length) throw quotaError("预算里还没有任何人工或材料");
    const { map: itemMap } = await quotaItems(view.budget.templateId);
    const table2 = view.table2.map((line) => ({ item: itemMap.get(line.code), quantity: line.quantity, reuse: line.reuse, remark: line.remark }));
    const table4 = view.materialLines.map((line) => ({ material: { code: line.code, name: line.name, spec: line.spec, unit: line.unit, maxPrice: line.price }, price: line.price, quantity: line.quantity, remark: line.remark }));
    const { buffer, budget } = buildBudgetWorkbook({
      templateBuffer: Buffer.from(template.fileBase64, "base64"),
      infoCells: template.infoCells,
      info: view.budget.info,
      table2,
      table4
    });
    const stamp = localDate(now()).replace(/-/g, "");
    const safeName = String(view.budget.name || "预算").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 60);
    return { fileName: `${safeName}-预算书-${stamp}.xlsx`, buffer, totals: budget.totals };
  }

  return {
    importTemplate,
    previewMaterials: async (args) => {
      const { parsed, ...preview } = await previewMaterials(args);
      return preview;
    },
    importMaterials,
    status,
    searchQuota,
    searchMaterials,
    catalog,
    setCommon,
    overview,
    listPresets: () => repo.getBudgetInfoPresets(),
    savePreset,
    savePresetFromBudget,
    deletePreset: (id) => repo.deleteBudgetInfoPreset(id),
    listBudgets: (options) => repo.listBudgets(options),
    createBudget,
    updateBudgetInfo,
    deleteBudget: (id) => repo.deleteBudget(id),
    budgetView,
    addQuotaLine,
    updateQuotaLine,
    deleteQuotaLine: (budgetId, lineId) => repo.deleteBudgetQuotaLine(budgetId, lineId),
    addMaterialLine,
    updateMaterialLine,
    deleteMaterialLine: (budgetId, lineId) => repo.deleteBudgetMaterialLine(budgetId, lineId),
    refreshMaterialPrices,
    savePipeInput,
    mergePipe,
    interpret,
    interpretMany,
    interpretWithModel,
    learnPhrase,
    listLearned: () => repo.getLearnedPhrases({ limit: 500 }),
    deleteLearned,
    exportBudget
  };
}
