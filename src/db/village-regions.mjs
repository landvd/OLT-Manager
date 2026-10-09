// 区域字典（村 → 小组）持久化：自动发现的候选、管理员审核状态与匹配关键词。
import { exec, query, sqlQuote } from "./core.mjs";
import { REGION_STATUSES, normalizeAddressText, normalizeKeywordList } from "../village-regions.mjs";

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapRegion(row) {
  return {
    id: Number(row.id),
    village: row.village,
    name: row.name,
    includeKeywords: parseList(row.include_json),
    excludeKeywords: parseList(row.exclude_json),
    ponInclude: parseList(row.pon_include_json),
    ponExclude: parseList(row.pon_exclude_json),
    status: row.status,
    source: row.source,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function requiredName(value, label) {
  const text = normalizeAddressText(value);
  if (text.length < 2 || text.length > 32) throw Object.assign(new Error(`${label}需要 2–32 个字符。`), { status: 400 });
  return text;
}

export async function getVillageRegions({ village = "", includeRejected = true } = {}) {
  const clauses = [];
  if (village) clauses.push(`village = ${sqlQuote(normalizeAddressText(village))}`);
  if (!includeRejected) clauses.push("status <> 'rejected'");
  const rows = await query(`SELECT * FROM village_regions ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY village, status = 'rejected', name;`);
  return rows.map(mapRegion);
}

export async function getVillageRegionVillages() {
  const rows = await query(`SELECT village, count(*) AS total,
sum(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
sum(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END) AS candidate
FROM village_regions GROUP BY village ORDER BY village;`);
  return rows.map((row) => ({ village: row.village, total: Number(row.total || 0), active: Number(row.active || 0), candidate: Number(row.candidate || 0) }));
}

/** 保存自动发现的候选：已存在的同名条目（含已审核、已驳回）保持不变，只新增。 */
export async function saveVillageRegionCandidates(village, candidates = []) {
  const name = requiredName(village, "村名");
  const statements = candidates
    .map((candidate) => ({ ...candidate, name: normalizeAddressText(candidate.name) }))
    .filter((candidate) => candidate.name.length >= 2 && candidate.name.length <= 32)
    .map((candidate) => `INSERT OR IGNORE INTO village_regions (village, name, include_json, exclude_json, status, source)
VALUES (${[name, candidate.name, JSON.stringify(normalizeKeywordList(candidate.includeKeywords)), JSON.stringify(normalizeKeywordList(candidate.excludeKeywords)), "candidate", "auto"].map(sqlQuote).join(", ")});`);
  if (statements.length) await exec(`BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
  return getVillageRegions({ village: name });
}

export async function createVillageRegion({ village, name, includeKeywords, excludeKeywords = [], status = "active" } = {}) {
  const villageName = requiredName(village, "村名");
  const regionName = requiredName(name, "小组名");
  const include = normalizeKeywordList(includeKeywords);
  if (!include.length) include.push(`${villageName}${regionName}`);
  if (!REGION_STATUSES.includes(status)) throw Object.assign(new Error("区域状态无效。"), { status: 400 });
  const [existing] = await query(`SELECT id FROM village_regions WHERE village = ${sqlQuote(villageName)} AND name = ${sqlQuote(regionName)};`);
  if (existing) throw Object.assign(new Error("该村已存在同名小组。"), { status: 409 });
  await exec(`INSERT INTO village_regions (village, name, include_json, exclude_json, status, source)
VALUES (${[villageName, regionName, JSON.stringify(include), JSON.stringify(normalizeKeywordList(excludeKeywords)), status, "manual"].map(sqlQuote).join(", ")});`);
  const [row] = await query(`SELECT * FROM village_regions WHERE village = ${sqlQuote(villageName)} AND name = ${sqlQuote(regionName)};`);
  return mapRegion(row);
}

export async function updateVillageRegion(id, { name, includeKeywords, excludeKeywords, status } = {}) {
  const [row] = await query(`SELECT * FROM village_regions WHERE id = ${Number(id) || 0};`);
  if (!row) throw Object.assign(new Error("区域不存在。"), { status: 404 });
  const current = mapRegion(row);
  const next = {
    name: name === undefined ? current.name : requiredName(name, "小组名"),
    include: includeKeywords === undefined ? current.includeKeywords : normalizeKeywordList(includeKeywords),
    exclude: excludeKeywords === undefined ? current.excludeKeywords : normalizeKeywordList(excludeKeywords),
    status: status === undefined ? current.status : String(status)
  };
  if (!REGION_STATUSES.includes(next.status)) throw Object.assign(new Error("区域状态无效。"), { status: 400 });
  if (!next.include.length) throw Object.assign(new Error("至少需要一个包含关键词。"), { status: 400 });
  if (next.name !== current.name) {
    const [clash] = await query(`SELECT id FROM village_regions WHERE village = ${sqlQuote(current.village)} AND name = ${sqlQuote(next.name)} AND id <> ${current.id};`);
    if (clash) throw Object.assign(new Error("该村已存在同名小组。"), { status: 409 });
  }
  await exec(`UPDATE village_regions SET
name = ${sqlQuote(next.name)},
include_json = ${sqlQuote(JSON.stringify(next.include))},
exclude_json = ${sqlQuote(JSON.stringify(next.exclude))},
status = ${sqlQuote(next.status)},
updated_at = CURRENT_TIMESTAMP
WHERE id = ${current.id};`);
  const [updated] = await query(`SELECT * FROM village_regions WHERE id = ${current.id};`);
  return mapRegion(updated);
}

const PON_KEY = /^\d{1,3}(?:\.\d{1,3}){3}\|\d+\/\d+\/\d+$/;

/** 管理员手动勾选 / 剔除的 PON 口（键为“OLT IP|机框/板卡/PON”），两者互斥。 */
export async function updateVillageRegionPons(id, { include = [], exclude = [] } = {}) {
  const [row] = await query(`SELECT * FROM village_regions WHERE id = ${Number(id) || 0};`);
  if (!row) throw Object.assign(new Error("区域不存在。"), { status: 404 });
  const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map((item) => String(item).trim()))].filter((item) => PON_KEY.test(item)).slice(0, 500);
  const includeKeys = clean(include);
  const excludeKeys = clean(exclude).filter((key) => !includeKeys.includes(key));
  await exec(`UPDATE village_regions SET
pon_include_json = ${sqlQuote(JSON.stringify(includeKeys))},
pon_exclude_json = ${sqlQuote(JSON.stringify(excludeKeys))},
updated_at = CURRENT_TIMESTAMP
WHERE id = ${Number(id) || 0};`);
  const [updated] = await query(`SELECT * FROM village_regions WHERE id = ${Number(id) || 0};`);
  return mapRegion(updated);
}

export async function deleteVillageRegion(id) {
  await exec(`DELETE FROM village_regions WHERE id = ${Number(id) || 0};`);
}
