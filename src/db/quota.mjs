// 定额预算仓储（ADR-092）：预算书模板与定额库、材料单价批次、基础信息模板、预算及其表二 / 表四 / 管道录入。
import { exec, query, sqlQuote } from "./core.mjs";

const now = () => new Date().toISOString();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

function chunk(list, size) {
  const result = [];
  for (let index = 0; index < list.length; index += size) result.push(list.slice(index, index + size));
  return result;
}

// ---------------- 预算书模板与定额库 ----------------

function mapTemplate(row, withFile = false) {
  if (!row) return null;
  return {
    id: Number(row.id),
    fileName: row.file_name,
    sha256: row.sha256,
    infoCells: parseJson(row.info_cells_json, {}),
    infoDefaults: parseJson(row.info_defaults_json, {}),
    constructionUnits: parseJson(row.construction_units_json, []),
    warnings: parseJson(row.warnings_json, []),
    itemCount: Number(row.item_count || 0),
    active: Number(row.active) === 1,
    importedAt: row.imported_at,
    ...(withFile ? { fileBase64: row.file_base64 } : {})
  };
}

/** 保存模板与定额库，并设为当前模板；返回模板 id。 */
export async function saveQuotaTemplate({ fileName, sha256, fileBase64, parsed }) {
  const importedAt = now();
  await exec("UPDATE quota_templates SET active = 0;");
  const [{ id }] = await query(`INSERT INTO quota_templates (file_name, sha256, file_base64, info_cells_json, info_defaults_json, construction_units_json, warnings_json, item_count, active, imported_at)
VALUES (${sqlQuote(fileName)}, ${sqlQuote(sha256)}, ${sqlQuote(fileBase64)}, ${sqlQuote(JSON.stringify(parsed.infoCells))}, ${sqlQuote(JSON.stringify(parsed.infoDefaults))},
  ${sqlQuote(JSON.stringify(parsed.constructionUnits || []))}, ${sqlQuote(JSON.stringify(parsed.warnings || []))}, ${parsed.quotaItems.length}, 1, ${sqlQuote(importedAt)}) RETURNING id;`);
  for (const group of chunk(parsed.quotaItems, 200)) {
    const values = group.map((item) => `(${Number(id)}, ${sqlQuote(item.code)}, ${sqlQuote(item.name)}, ${sqlQuote(item.detail)}, ${sqlQuote(item.unit)},
  ${num(item.prices[0])}, ${num(item.prices[1])}, ${num(item.prices[2])}, ${num(item.prices[3])}, ${sqlQuote(item.workContent)}, ${Number(item.sort) || 0})`);
    await exec(`INSERT INTO quota_items (template_id, code, name, detail, unit, price1, price2, price3, price4, work_content, sort) VALUES ${values.join(",\n")};`);
  }
  return Number(id);
}

export async function getActiveQuotaTemplate({ withFile = false } = {}) {
  const [row] = await query(`SELECT ${withFile ? "*" : "id, file_name, sha256, info_cells_json, info_defaults_json, construction_units_json, warnings_json, item_count, active, imported_at"}
FROM quota_templates WHERE active = 1 ORDER BY id DESC LIMIT 1;`);
  return mapTemplate(row, withFile);
}

export async function getQuotaTemplate(id, { withFile = false } = {}) {
  const [row] = await query(`SELECT * FROM quota_templates WHERE id = ${Number(id) || 0};`);
  return mapTemplate(row, withFile);
}

function mapQuotaItem(row) {
  return {
    code: row.code,
    name: row.name,
    detail: row.detail,
    unit: row.unit,
    prices: [row.price1, row.price2, row.price3, row.price4].map(Number),
    workContent: row.work_content
  };
}

export async function getQuotaItems(templateId) {
  const rows = await query(`SELECT * FROM quota_items WHERE template_id = ${Number(templateId) || 0} ORDER BY sort;`);
  return rows.map(mapQuotaItem);
}

// ---------------- 材料单价 ----------------

function mapMaterial(row) {
  return {
    code: row.code,
    name: row.name,
    spec: row.spec,
    attr: row.attr,
    unit: row.unit,
    maxPrice: Number(row.max_price),
    minPrice: row.min_price === null || row.min_price === undefined ? null : Number(row.min_price),
    contractEnd: row.contract_end,
    place: row.place,
    sheet: row.sheet,
    common: Number(row.common) === 1
  };
}

export async function saveMaterialImport({ fileName, sha256, materials, summary }) {
  await exec("UPDATE material_imports SET active = 0;");
  const [{ id }] = await query(`INSERT INTO material_imports (file_name, sha256, material_count, summary_json, active, imported_at)
VALUES (${sqlQuote(fileName)}, ${sqlQuote(sha256)}, ${materials.length}, ${sqlQuote(JSON.stringify(summary || {}))}, 1, ${sqlQuote(now())}) RETURNING id;`);
  for (const group of chunk(materials, 200)) {
    const values = group.map((item) => `(${Number(id)}, ${sqlQuote(item.code)}, ${sqlQuote(item.name)}, ${sqlQuote(item.spec)}, ${sqlQuote(item.attr)}, ${sqlQuote(item.unit)},
  ${num(item.maxPrice)}, ${item.minPrice === null || item.minPrice === undefined ? "NULL" : num(item.minPrice)}, ${sqlQuote(item.contractEnd || "")}, ${sqlQuote(item.place || "")},
  ${sqlQuote(item.sheet || "")}, ${item.common ? 1 : 0})`);
    await exec(`INSERT INTO material_prices (import_id, code, name, spec, attr, unit, max_price, min_price, contract_end, place, sheet, common) VALUES ${values.join(",\n")};`);
  }
  return Number(id);
}

export async function getActiveMaterialImport() {
  const [row] = await query("SELECT * FROM material_imports WHERE active = 1 ORDER BY id DESC LIMIT 1;");
  if (!row) return null;
  return { id: Number(row.id), fileName: row.file_name, sha256: row.sha256, materialCount: Number(row.material_count), summary: parseJson(row.summary_json, {}), importedAt: row.imported_at };
}

export async function getMaterials(importId) {
  const rows = await query(`SELECT * FROM material_prices WHERE import_id = ${Number(importId) || 0} ORDER BY common DESC, code;`);
  return rows.map(mapMaterial);
}

// ---------------- 基础信息模板 ----------------

function mapPreset(row) {
  return { id: Number(row.id), name: row.name, fields: parseJson(row.fields_json, {}), isDefault: Number(row.is_default) === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getBudgetInfoPresets() {
  return (await query("SELECT * FROM budget_info_presets ORDER BY is_default DESC, id;")).map(mapPreset);
}

export async function getBudgetInfoPreset(id) {
  const [row] = await query(`SELECT * FROM budget_info_presets WHERE id = ${Number(id) || 0};`);
  return row ? mapPreset(row) : null;
}

/** 新增或修改基础信息模板；isDefault 为 true 时取消其它模板的默认。 */
export async function saveBudgetInfoPreset({ id = null, name, fields, isDefault = false }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("请填写模板名称");
  const [duplicate] = await query(`SELECT id FROM budget_info_presets WHERE name = ${sqlQuote(trimmed)} AND id <> ${Number(id) || 0};`);
  if (duplicate) throw new Error(`已有名为“${trimmed}”的基础信息模板`);
  const stamp = now();
  const clearDefault = isDefault ? "UPDATE budget_info_presets SET is_default = 0;\n" : "";
  if (id) {
    await exec(`${clearDefault}UPDATE budget_info_presets SET name = ${sqlQuote(trimmed)}, fields_json = ${sqlQuote(JSON.stringify(fields || {}))},
  is_default = CASE WHEN ${isDefault ? 1 : 0} = 1 THEN 1 ELSE is_default END, updated_at = ${sqlQuote(stamp)} WHERE id = ${Number(id)};`);
    return getBudgetInfoPreset(id);
  }
  if (clearDefault) await exec(clearDefault);
  const [row] = await query(`INSERT INTO budget_info_presets (name, fields_json, is_default, created_at, updated_at)
VALUES (${sqlQuote(trimmed)}, ${sqlQuote(JSON.stringify(fields || {}))}, ${isDefault ? 1 : 0}, ${sqlQuote(stamp)}, ${sqlQuote(stamp)}) RETURNING *;`);
  return mapPreset(row);
}

export async function deleteBudgetInfoPreset(id) {
  const presets = await getBudgetInfoPresets();
  if (presets.length <= 1) throw new Error("至少要保留一套基础信息模板");
  const target = presets.find((preset) => preset.id === Number(id));
  if (!target) return false;
  await exec(`DELETE FROM budget_info_presets WHERE id = ${Number(id)};`);
  if (target.isDefault) {
    const next = presets.find((preset) => preset.id !== Number(id));
    await exec(`UPDATE budget_info_presets SET is_default = 1 WHERE id = ${next.id};`);
  }
  return true;
}

// ---------------- 预算 ----------------

function mapBudget(row) {
  return {
    id: Number(row.id),
    name: row.name,
    location: row.location,
    info: parseJson(row.info_json, {}),
    templateId: Number(row.template_id),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.quota_count !== undefined ? { quotaCount: Number(row.quota_count), materialCount: Number(row.material_count) } : {})
  };
}

export async function createBudget({ info, templateId, createdBy = "desktop", createdByName = "" }) {
  const stamp = now();
  const [row] = await query(`INSERT INTO budgets (name, location, info_json, template_id, created_by, created_by_name, created_at, updated_at)
VALUES (${sqlQuote(info.projectName || "")}, ${sqlQuote(info.location || "")}, ${sqlQuote(JSON.stringify(info))}, ${Number(templateId)},
  ${sqlQuote(createdBy)}, ${sqlQuote(createdByName)}, ${sqlQuote(stamp)}, ${sqlQuote(stamp)}) RETURNING *;`);
  return mapBudget(row);
}

export async function getBudget(id) {
  const [row] = await query(`SELECT * FROM budgets WHERE id = ${Number(id) || 0};`);
  return row ? mapBudget(row) : null;
}

export async function listBudgets({ limit = 50, q = "" } = {}) {
  const keyword = String(q || "").trim();
  const where = keyword ? `WHERE name LIKE ${sqlQuote(`%${keyword}%`)} OR location LIKE ${sqlQuote(`%${keyword}%`)}` : "";
  const rows = await query(`SELECT b.*, (SELECT count(*) FROM budget_quota_lines WHERE budget_id = b.id) AS quota_count,
  (SELECT count(*) FROM budget_material_lines WHERE budget_id = b.id) AS material_count
FROM budgets b ${where} ORDER BY b.updated_at DESC LIMIT ${Math.max(1, Math.min(200, Number(limit) || 50))};`);
  return rows.map(mapBudget);
}

export async function updateBudgetInfo(id, info) {
  await exec(`UPDATE budgets SET name = ${sqlQuote(info.projectName || "")}, location = ${sqlQuote(info.location || "")},
  info_json = ${sqlQuote(JSON.stringify(info))}, updated_at = ${sqlQuote(now())} WHERE id = ${Number(id)};`);
  return getBudget(id);
}

export async function touchBudget(id) {
  await exec(`UPDATE budgets SET updated_at = ${sqlQuote(now())} WHERE id = ${Number(id)};`);
}

export async function deleteBudget(id) {
  const budgetId = Number(id) || 0;
  await exec(`DELETE FROM budget_quota_lines WHERE budget_id = ${budgetId};
DELETE FROM budget_material_lines WHERE budget_id = ${budgetId};
DELETE FROM budget_pipe_inputs WHERE budget_id = ${budgetId};
DELETE FROM budgets WHERE id = ${budgetId};`);
}

// ---------------- 表二 / 表四 / 管道 ----------------

function mapQuotaLine(row) {
  return { id: Number(row.id), seq: Number(row.seq), code: row.code, quantity: Number(row.quantity), reuse: Number(row.reuse) === 1, remark: row.remark, utterance: row.utterance };
}

function mapMaterialLine(row) {
  return {
    id: Number(row.id), seq: Number(row.seq), code: row.material_code, name: row.name, spec: row.spec, unit: row.unit,
    price: Number(row.price), quantity: Number(row.quantity), remark: row.remark, utterance: row.utterance
  };
}

export async function getBudgetQuotaLines(budgetId) {
  return (await query(`SELECT * FROM budget_quota_lines WHERE budget_id = ${Number(budgetId) || 0} ORDER BY seq, id;`)).map(mapQuotaLine);
}

export async function getBudgetMaterialLines(budgetId) {
  return (await query(`SELECT * FROM budget_material_lines WHERE budget_id = ${Number(budgetId) || 0} ORDER BY seq, id;`)).map(mapMaterialLine);
}

async function nextSeq(table, budgetId) {
  const [row] = await query(`SELECT coalesce(max(seq), 0) + 1 AS next FROM ${table} WHERE budget_id = ${Number(budgetId)};`);
  return Number(row?.next || 1);
}

export async function addBudgetQuotaLine(budgetId, { code, quantity, reuse = false, remark = "", utterance = "" }) {
  const seq = await nextSeq("budget_quota_lines", budgetId);
  const [row] = await query(`INSERT INTO budget_quota_lines (budget_id, seq, code, quantity, reuse, remark, utterance, created_at)
VALUES (${Number(budgetId)}, ${seq}, ${sqlQuote(code)}, ${num(quantity)}, ${reuse ? 1 : 0}, ${sqlQuote(remark)}, ${sqlQuote(utterance)}, ${sqlQuote(now())}) RETURNING *;`);
  await touchBudget(budgetId);
  return mapQuotaLine(row);
}

export async function updateBudgetQuotaLine(budgetId, lineId, { code, quantity, reuse, remark }) {
  const sets = [];
  if (code !== undefined) sets.push(`code = ${sqlQuote(code)}`);
  if (quantity !== undefined) sets.push(`quantity = ${num(quantity)}`);
  if (reuse !== undefined) sets.push(`reuse = ${reuse ? 1 : 0}`);
  if (remark !== undefined) sets.push(`remark = ${sqlQuote(remark)}`);
  if (!sets.length) return;
  await exec(`UPDATE budget_quota_lines SET ${sets.join(", ")} WHERE id = ${Number(lineId)} AND budget_id = ${Number(budgetId)};`);
  await touchBudget(budgetId);
}

export async function deleteBudgetQuotaLine(budgetId, lineId) {
  await exec(`DELETE FROM budget_quota_lines WHERE id = ${Number(lineId)} AND budget_id = ${Number(budgetId)};`);
  await touchBudget(budgetId);
}

export async function addBudgetMaterialLine(budgetId, { material, quantity, remark = "", utterance = "" }) {
  const seq = await nextSeq("budget_material_lines", budgetId);
  const [row] = await query(`INSERT INTO budget_material_lines (budget_id, seq, material_code, name, spec, unit, price, quantity, remark, utterance, created_at)
VALUES (${Number(budgetId)}, ${seq}, ${sqlQuote(material.code)}, ${sqlQuote(material.name)}, ${sqlQuote(material.spec || "")}, ${sqlQuote(material.unit || "")},
  ${num(material.maxPrice)}, ${num(quantity)}, ${sqlQuote(remark)}, ${sqlQuote(utterance)}, ${sqlQuote(now())}) RETURNING *;`);
  await touchBudget(budgetId);
  return mapMaterialLine(row);
}

export async function updateBudgetMaterialLine(budgetId, lineId, { material, quantity, remark, price }) {
  const sets = [];
  if (material) {
    sets.push(`material_code = ${sqlQuote(material.code)}`, `name = ${sqlQuote(material.name)}`, `spec = ${sqlQuote(material.spec || "")}`, `unit = ${sqlQuote(material.unit || "")}`);
    if (price === undefined) sets.push(`price = ${num(material.maxPrice)}`);
  }
  if (quantity !== undefined) sets.push(`quantity = ${num(quantity)}`);
  if (remark !== undefined) sets.push(`remark = ${sqlQuote(remark)}`);
  if (price !== undefined) sets.push(`price = ${num(price)}`);
  if (!sets.length) return;
  await exec(`UPDATE budget_material_lines SET ${sets.join(", ")} WHERE id = ${Number(lineId)} AND budget_id = ${Number(budgetId)};`);
  await touchBudget(budgetId);
}

export async function deleteBudgetMaterialLine(budgetId, lineId) {
  await exec(`DELETE FROM budget_material_lines WHERE id = ${Number(lineId)} AND budget_id = ${Number(budgetId)};`);
  await touchBudget(budgetId);
}

export async function getBudgetPipeInput(budgetId) {
  const [row] = await query(`SELECT input_json FROM budget_pipe_inputs WHERE budget_id = ${Number(budgetId) || 0};`);
  return row ? parseJson(row.input_json, {}) : {};
}

export async function saveBudgetPipeInput(budgetId, input) {
  await exec(`INSERT INTO budget_pipe_inputs (budget_id, input_json, updated_at) VALUES (${Number(budgetId)}, ${sqlQuote(JSON.stringify(input || {}))}, ${sqlQuote(now())})
ON CONFLICT(budget_id) DO UPDATE SET input_json = excluded.input_json, updated_at = excluded.updated_at;`);
  await touchBudget(budgetId);
}

// ---------------- 最近填过的编制人 / 审核 ----------------

export async function recordBudgetNames(entries) {
  const stamp = now();
  const values = Object.entries(entries).filter(([, name]) => String(name || "").trim())
    .map(([kind, name]) => `(${sqlQuote(kind)}, ${sqlQuote(String(name).trim())}, ${sqlQuote(stamp)})`);
  if (!values.length) return;
  await exec(`INSERT INTO budget_name_history (kind, name, used_at) VALUES ${values.join(", ")}
ON CONFLICT(kind, name) DO UPDATE SET used_at = excluded.used_at;`);
}

export async function getRecentBudgetNames(limit = 8) {
  const rows = await query(`SELECT kind, name FROM budget_name_history ORDER BY used_at DESC;`);
  const result = {};
  for (const row of rows) {
    result[row.kind] ||= [];
    if (result[row.kind].length < limit) result[row.kind].push(row.name);
  }
  return result;
}

// ---------------- 定额模式学到的说法 ----------------

function mapLearned(row) {
  return {
    id: Number(row.id), phrase: row.phrase, kind: row.kind, code: row.code, label: row.label, example: row.example,
    hits: Number(row.hits), corrected: Number(row.corrected) === 1, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

/** 记一条说法；同一说法再确认时更新为最新选择并累计次数。 */
export async function saveLearnedPhrase({ phrase, kind, code, label = "", example = "", corrected = false, createdBy = "" }) {
  const stamp = now();
  await exec(`INSERT INTO quota_learned_phrases (phrase, kind, code, label, example, hits, corrected, created_by, created_at, updated_at)
VALUES (${sqlQuote(phrase)}, ${sqlQuote(kind)}, ${sqlQuote(code)}, ${sqlQuote(label)}, ${sqlQuote(example)}, 1, ${corrected ? 1 : 0}, ${sqlQuote(createdBy)}, ${sqlQuote(stamp)}, ${sqlQuote(stamp)})
ON CONFLICT(phrase, kind) DO UPDATE SET code = excluded.code, label = excluded.label, example = excluded.example,
  hits = CASE WHEN quota_learned_phrases.code = excluded.code THEN quota_learned_phrases.hits + 1 ELSE 1 END,
  corrected = CASE WHEN quota_learned_phrases.code = excluded.code THEN max(quota_learned_phrases.corrected, excluded.corrected) ELSE excluded.corrected END,
  updated_at = excluded.updated_at;`);
}

export async function getLearnedPhrases({ limit = 500 } = {}) {
  return (await query(`SELECT * FROM quota_learned_phrases ORDER BY updated_at DESC LIMIT ${Math.max(1, Math.min(2000, Number(limit) || 500))};`)).map(mapLearned);
}

export async function deleteLearnedPhrase(id) {
  await exec(`DELETE FROM quota_learned_phrases WHERE id = ${Number(id) || 0};`);
}


// ---------------- 常用人工 / 材料 ----------------

/** 各定额编号、物料编码在所有预算里用过的次数（常用排序用）。 */
export async function getQuotaUsage() {
  const quota = await query("SELECT code, count(*) AS uses FROM budget_quota_lines GROUP BY code;");
  const material = await query("SELECT material_code AS code, count(*) AS uses FROM budget_material_lines GROUP BY material_code;");
  return {
    quota: Object.fromEntries(quota.map((row) => [row.code, Number(row.uses)])),
    material: Object.fromEntries(material.map((row) => [row.code, Number(row.uses)]))
  };
}

export async function getQuotaCommonOverrides() {
  return (await query("SELECT kind, item_key, pinned FROM quota_common_overrides;")).map((row) => ({ kind: row.kind, key: row.item_key, pinned: Number(row.pinned) === 1 }));
}

export async function setQuotaCommonOverride({ kind, key, pinned }) {
  await exec(`INSERT INTO quota_common_overrides (kind, item_key, pinned, updated_at) VALUES (${sqlQuote(kind)}, ${sqlQuote(key)}, ${pinned ? 1 : 0}, ${sqlQuote(now())})
ON CONFLICT(kind, item_key) DO UPDATE SET pinned = excluded.pinned, updated_at = excluded.updated_at;`);
}
