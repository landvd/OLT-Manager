// 用户归属（村 / 小组 / 小区）持久化：批量规则、单户修正，以及合并台账归属列的按需重算（ADR-087）。
import { createHash } from "node:crypto";
import { exec, query, runSql, sqlQuote } from "./core.mjs";
import { getVillageRegions } from "./village-regions.mjs";
import { normalizeAddressText, normalizeKeywordList } from "../village-regions.mjs";
import { computePlaceAssignments, effectivePortAssignments, normalizePlaceRule, placeLabel, ponPlaceKey, portVillageRecommendations, summarizePonPlaces, suggestUnassignedKeywords } from "../onu-places.mjs";

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapRule(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    target: row.target,
    includeKeywords: parseList(row.include_json),
    excludeKeywords: parseList(row.exclude_json),
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapOverride(row) {
  return {
    id: Number(row.id),
    loid: row.loid || "",
    oltIp: row.olt_ip || "",
    chassis: row.chassis || "",
    board: row.board || "",
    pon: row.pon || "",
    onuId: row.onu_id || "",
    village: row.village || "",
    villageGroup: row.village_group || "",
    community: row.community || "",
    note: row.note || "",
    updatedAt: row.updated_at || ""
  };
}

function mapPlaceUser(row) {
  return {
    oltIp: row.olt_ip,
    chassis: row.chassis,
    board: row.board,
    pon: row.pon,
    onuId: row.onu_id,
    loid: row.loid || "",
    username: row.username || "",
    installationAddress: row.installation_address || "",
    village: row.village || "",
    villageGroup: row.village_group || "",
    community: row.community || "",
    placeSource: row.place_source || "",
    place: placeLabel({ village: row.village, villageGroup: row.village_group, community: row.community })
  };
}

export async function getPlaceRules() {
  return (await query("SELECT * FROM place_rules ORDER BY kind, target, id;")).map(mapRule);
}

export async function createPlaceRule(input = {}) {
  const rule = normalizePlaceRule(input);
  const [row] = await query(`INSERT INTO place_rules (kind, target, include_json, exclude_json, note)
VALUES (${[rule.kind, rule.target, JSON.stringify(rule.includeKeywords), JSON.stringify(rule.excludeKeywords), String(input.note || "").slice(0, 200)].map(sqlQuote).join(", ")})
RETURNING *;`);
  return mapRule(row);
}

export async function updatePlaceRule(id, input = {}) {
  const ruleId = Number(id);
  const [current] = await query(`SELECT * FROM place_rules WHERE id = ${ruleId};`);
  if (!current) throw Object.assign(new Error("规则不存在。"), { status: 404 });
  const rule = normalizePlaceRule({ ...mapRule(current), ...input });
  const [row] = await query(`UPDATE place_rules SET kind = ${sqlQuote(rule.kind)}, target = ${sqlQuote(rule.target)},
include_json = ${sqlQuote(JSON.stringify(rule.includeKeywords))}, exclude_json = ${sqlQuote(JSON.stringify(rule.excludeKeywords))},
note = ${sqlQuote(String(input.note ?? current.note ?? "").slice(0, 200))}, updated_at = CURRENT_TIMESTAMP
WHERE id = ${ruleId} RETURNING *;`);
  return mapRule(row);
}

export async function deletePlaceRule(id) {
  await exec(`DELETE FROM place_rules WHERE id = ${Number(id)};`);
  return { ok: true };
}

export async function getPlaceOverrides() {
  return (await query("SELECT * FROM onu_place_overrides ORDER BY updated_at DESC, id DESC;")).map(mapOverride);
}

/**
 * 保存单户修正：有 LOID 时按 LOID 定位，否则按坐标定位；三个归属字段都为空时删除修正，恢复按规则计算。
 */
export async function savePlaceOverride(input = {}) {
  const loid = String(input.loid ?? "").trim();
  const coordinate = ["oltIp", "chassis", "board", "pon", "onuId"].map((key) => String(input[key] ?? "").trim());
  if (!loid && coordinate.some((part) => !part)) throw Object.assign(new Error("单户修正需要 LOID 或完整坐标。"), { status: 400 });
  const fields = ["village", "villageGroup", "community"].map((key) => normalizeAddressText(input[key]).slice(0, 32));
  const where = loid
    ? `loid = ${sqlQuote(loid)}`
    : `loid = '' AND olt_ip = ${sqlQuote(coordinate[0])} AND chassis = ${sqlQuote(coordinate[1])} AND board = ${sqlQuote(coordinate[2])} AND pon = ${sqlQuote(coordinate[3])} AND onu_id = ${sqlQuote(coordinate[4])}`;
  if (fields.every((value) => !value)) {
    await exec(`DELETE FROM onu_place_overrides WHERE ${where};`);
    return null;
  }
  const values = [loid, ...coordinate, ...fields, String(input.note || "").slice(0, 200)].map(sqlQuote).join(", ");
  const [row] = await query(`BEGIN;
DELETE FROM onu_place_overrides WHERE ${where};
INSERT INTO onu_place_overrides (loid, olt_ip, chassis, board, pon, onu_id, village, village_group, community, note)
VALUES (${values}) RETURNING *;
COMMIT;`);
  return mapOverride(row);
}

export async function deletePlaceOverride(id) {
  await exec(`DELETE FROM onu_place_overrides WHERE id = ${Number(id)};`);
  return { ok: true };
}

// 指纹覆盖所有会改变归属结果的输入：台账版本与行数、资料修正（会直接改地址）、区域字典、规则、单户修正。
function mapPortAssignment(row) {
  const item = {
    oltIp: row.olt_ip,
    board: row.board,
    pon: row.pon,
    address: row.address || "",
    village: row.village || "",
    villageGroup: row.village_group || "",
    community: row.community || "",
    updatedAt: row.updated_at || ""
  };
  return { ...item, label: placeLabel(item) };
}

/** 按 PON 台账行（口 + 一级地址）指定的归属。 */
export async function getPortPlaceAssignments() {
  return (await query("SELECT * FROM pon_place_assignments ORDER BY olt_ip, CAST(board AS INTEGER), CAST(pon AS INTEGER), address;")).map(mapPortAssignment);
}

function rowKeyParts(input = {}) {
  const [oltIp, board, pon] = ["oltIp", "board", "pon"].map((key) => String(input?.[key] ?? (key === "board" ? input?.slot : "") ?? "").trim());
  return [oltIp, board, pon, normalizeAddressText(input?.address).slice(0, 200)];
}

function rowStatements(parts, fields) {
  const [oltIp, board, pon, address] = parts;
  const where = `olt_ip = ${sqlQuote(oltIp)} AND board = ${sqlQuote(board)} AND pon = ${sqlQuote(pon)} AND address = ${sqlQuote(address)}`;
  return fields.every((value) => !value)
    ? `DELETE FROM pon_place_assignments WHERE ${where};`
    : `INSERT INTO pon_place_assignments (olt_ip, board, pon, address, village, village_group, community)
VALUES (${[...parts, ...fields].map(sqlQuote).join(", ")})
ON CONFLICT (olt_ip, board, pon, address) DO UPDATE SET village = excluded.village, village_group = excluded.village_group,
  community = excluded.community, updated_at = CURRENT_TIMESTAMP;`;
}

/** 给一行 PON 台账（口 + 一级地址）指定归属；三项都为空时删除，恢复自动计算。 */
export async function savePortPlaceAssignment(input = {}) {
  const parts = rowKeyParts(input);
  if (parts.slice(0, 3).some((part) => !part)) throw Object.assign(new Error("需要 OLT IP、板卡和 PON。"), { status: 400 });
  const fields = ["village", "villageGroup", "community"].map((key) => normalizeAddressText(input[key]).slice(0, 32));
  await exec(rowStatements(parts, fields));
  if (fields.every((value) => !value)) return null;
  const [row] = await query(`SELECT * FROM pon_place_assignments WHERE olt_ip = ${sqlQuote(parts[0])} AND board = ${sqlQuote(parts[1])}
  AND pon = ${sqlQuote(parts[2])} AND address = ${sqlQuote(parts[3])};`);
  return mapPortAssignment(row);
}

/** 批量给多行台账指定同一归属；三项都为空时这些行全部恢复自动。一个事务内完成。 */
export async function savePortPlaceAssignments({ ports = [], village = "", villageGroup = "", community = "" } = {}) {
  const list = (Array.isArray(ports) ? ports : []).slice(0, 5000).map(rowKeyParts);
  if (!list.length) throw Object.assign(new Error("请先选择台账行。"), { status: 400 });
  if (list.some((parts) => parts.slice(0, 3).some((part) => !part))) throw Object.assign(new Error("每一行都需要 OLT IP、板卡和 PON。"), { status: 400 });
  const fields = [village, villageGroup, community].map((value) => normalizeAddressText(value).slice(0, 32));
  const unique = [...new Map(list.map((parts) => [parts.join("|"), parts])).values()];
  await runSql(`BEGIN IMMEDIATE;\n${unique.map((parts) => rowStatements(parts, fields)).join("\n")}\nCOMMIT;`);
  return { saved: unique.length, cleared: fields.every((value) => !value), label: placeLabel({ village: fields[0], villageGroup: fields[1], community: fields[2] }) };
}

async function placeFingerprint({ regions, rules, overrides, ports }) {
  const [state] = await query(`SELECT
  (SELECT revision FROM merged_onu_dataset_state WHERE id = 1) AS revision,
  (SELECT count(*) FROM merged_onu_snapshots) AS row_count,
  (SELECT count(*) || ':' || ifnull(max(reviewed_at), '') FROM agent_user_corrections WHERE status = 'active') AS corrections;`);
  const relevantRegions = regions
    .filter((region) => region.status === "active")
    .map((region) => [region.id, region.village, region.name, region.includeKeywords, region.excludeKeywords, region.transfer]);
  return createHash("sha256")
    .update(JSON.stringify([state?.revision, state?.row_count, state?.corrections, relevantRegions, rules, overrides,
      ports.map((port) => [port.oltIp, port.board, port.pon, port.village, port.villageGroup, port.community])]))
    .digest("hex");
}

let recomputing = null;

/** 按需重算合并台账的归属列：输入没有变化时只做一次指纹比对。 */
export async function ensurePlaceAssignments({ force = false } = {}) {
  if (recomputing) return recomputing;
  recomputing = (async () => {
    const [regions, rules, overrides, ports] = await Promise.all([getVillageRegions({}), getPlaceRules(), getPlaceOverrides(), getPortPlaceAssignments()]);
    const fingerprint = await placeFingerprint({ regions, rules, overrides, ports });
    const [state] = await query("SELECT fingerprint FROM place_assignment_state WHERE id = 1;");
    if (!force && state?.fingerprint === fingerprint) return { recomputed: false, changed: 0 };
    const rows = (await query(`SELECT olt_ip, chassis, board, pon, onu_id, loid, installation_address,
village, village_group, community, place_source FROM merged_onu_snapshots;`)).map((row) => ({
      oltIp: row.olt_ip,
      chassis: row.chassis,
      board: row.board,
      pon: row.pon,
      onuId: row.onu_id,
      loid: row.loid,
      installationAddress: row.installation_address,
      current: [row.village, row.village_group, row.community, row.place_source].join("\u0001")
    }));
    // 各行归属相同的口整口套用；分路（各行不同）的口不套用，口上用户按地址自动判断。
    const assignments = computePlaceAssignments(rows, { regions, rules, overrides, ports: effectivePortAssignments(ports).ports });
    const changed = assignments.filter((item, index) =>
      [item.village, item.villageGroup, item.community, item.placeSource].join("\u0001") !== rows[index].current);
    const inserts = [];
    for (let index = 0; index < changed.length; index += 400) {
      const values = changed.slice(index, index + 400).map((item) => `(${[
        item.oltIp, item.chassis, item.board, item.pon, item.onuId, item.village, item.villageGroup, item.community, item.placeSource
      ].map(sqlQuote).join(", ")})`);
      inserts.push(`INSERT INTO temp_onu_places VALUES ${values.join(",\n")};`);
    }
    await runSql(`BEGIN IMMEDIATE;
CREATE TEMP TABLE IF NOT EXISTS temp_onu_places (olt_ip TEXT, chassis TEXT, board TEXT, pon TEXT, onu_id TEXT, village TEXT, village_group TEXT, community TEXT, place_source TEXT);
DELETE FROM temp_onu_places;
${inserts.join("\n")}
UPDATE merged_onu_snapshots SET village = t.village, village_group = t.village_group, community = t.community, place_source = t.place_source
FROM temp_onu_places AS t
WHERE merged_onu_snapshots.olt_ip = t.olt_ip AND merged_onu_snapshots.chassis = t.chassis AND merged_onu_snapshots.board = t.board
  AND merged_onu_snapshots.pon = t.pon AND merged_onu_snapshots.onu_id = t.onu_id;
DELETE FROM temp_onu_places;
UPDATE place_assignment_state SET fingerprint = ${sqlQuote(fingerprint)}, computed_at = CURRENT_TIMESTAMP WHERE id = 1;
COMMIT;`);
    return { recomputed: true, changed: changed.length };
  })();
  try {
    return await recomputing;
  } finally {
    recomputing = null;
  }
}

/** 归属总览：各村（含小组）户数、各小区户数、未归村户数和来源分布。 */
export async function getPlaceSummary() {
  await ensurePlaceAssignments();
  const [villages, communities, [totals], sources, [state]] = await Promise.all([
    query(`SELECT village, village_group, count(*) AS users FROM merged_onu_snapshots WHERE village <> ''
GROUP BY village, village_group ORDER BY village, village_group;`),
    query("SELECT community, count(*) AS users FROM merged_onu_snapshots WHERE community <> '' GROUP BY community ORDER BY users DESC, community;"),
    query(`SELECT count(*) AS users,
  sum(CASE WHEN trim(installation_address) = '' THEN 1 ELSE 0 END) AS empty_address,
  sum(CASE WHEN village = '' AND community = '' AND trim(installation_address) <> '' THEN 1 ELSE 0 END) AS unassigned
FROM merged_onu_snapshots;`),
    query("SELECT place_source, count(*) AS users FROM merged_onu_snapshots GROUP BY place_source;"),
    query("SELECT computed_at FROM place_assignment_state WHERE id = 1;")
  ]);
  const byVillage = new Map();
  for (const row of villages) {
    if (!byVillage.has(row.village)) byVillage.set(row.village, { village: row.village, users: 0, groups: [] });
    const entry = byVillage.get(row.village);
    entry.users += Number(row.users);
    if (row.village_group) entry.groups.push({ name: row.village_group, users: Number(row.users) });
  }
  return {
    totalUsers: Number(totals?.users || 0),
    emptyAddress: Number(totals?.empty_address || 0),
    unassigned: Number(totals?.unassigned || 0),
    sources: Object.fromEntries(sources.map((row) => [row.place_source || "none", Number(row.users)])),
    villages: [...byVillage.values()].sort((left, right) => right.users - left.users),
    communities: communities.map((row) => ({ name: row.community, users: Number(row.users) })),
    computedAt: state?.computed_at || ""
  };
}

/** 按归属筛选用户：village / group / community / unassigned / 关键词（姓名、地址、LOID）。 */
/** 各 PON 口已归村户数按村聚合，用于给没归村的户推荐村。 */
async function portRecommendations() {
  const rows = await query(`SELECT olt_ip, board, pon, village, count(*) AS users FROM merged_onu_snapshots
WHERE village <> '' GROUP BY olt_ip, board, pon, village;`);
  return portVillageRecommendations(rows.map((row) => ({ oltIp: row.olt_ip, board: row.board, pon: row.pon, village: row.village, users: row.users })));
}

/**
 * 按归属筛选用户：village / group / community / unassigned（含 includeEmpty 时包括地址为空）/ 关键词。
 * 没有村的户附上按所在 PON 口的推荐（recommendation）；recommendedOnly 只返回有推荐的户。
 */
export async function getPlaceUsers({ village = "", group = "", community = "", unassigned = false, includeEmpty = false, recommendedOnly = false, q = "", limit = 200 } = {}) {
  await ensurePlaceAssignments();
  const clauses = [];
  if (unassigned) clauses.push(`village = '' AND community = ''${includeEmpty ? "" : " AND trim(installation_address) <> ''"}`);
  if (village) clauses.push(`village = ${sqlQuote(normalizeAddressText(village))}`);
  if (group) clauses.push(`village_group = ${sqlQuote(normalizeAddressText(group))}`);
  if (community) clauses.push(`community = ${sqlQuote(normalizeAddressText(community))}`);
  if (recommendedOnly) clauses.push("village = ''");
  const keyword = normalizeAddressText(q);
  if (keyword) {
    const like = sqlQuote(`%${keyword.replace(/[%_]/g, "")}%`);
    clauses.push(`(replace(installation_address, ' ', '') LIKE ${like} OR username LIKE ${like} OR loid LIKE ${like})`);
  }
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  // 只看有推荐时先取全部候选再过滤（没归村的户最多几千户）。
  const [rows, recommendations] = await Promise.all([
    query(`SELECT olt_ip, chassis, board, pon, onu_id, loid, username, installation_address, village, village_group, community, place_source
FROM merged_onu_snapshots ${where}
ORDER BY trim(installation_address) = '', village, village_group, community, olt_ip, CAST(board AS INTEGER), CAST(pon AS INTEGER), installation_address${recommendedOnly ? "" : ` LIMIT ${safeLimit}`};`),
    portRecommendations()
  ]);
  let mapped = rows.map((row) => {
    const user = mapPlaceUser(row);
    const recommendation = user.village ? null : recommendations.get(ponPlaceKey(user)) || null;
    return recommendation ? { ...user, recommendation } : user;
  });
  let total;
  if (recommendedOnly) {
    mapped = mapped.filter((user) => user.recommendation);
    total = mapped.length;
    mapped = mapped.slice(0, safeLimit);
  } else {
    total = Number((await query(`SELECT count(*) AS total FROM merged_onu_snapshots ${where};`))[0]?.total || 0);
  }
  return { total, rows: mapped };
}

/**
 * 批量采纳推荐：把村写入单户修正，保留该户已有的小组、小区修正。
 * items: [{ loid, oltIp, chassis, board, pon, onuId, village }]
 */
export async function acceptPlaceRecommendations(items = []) {
  const existing = indexExistingOverrides(await getPlaceOverrides());
  let saved = 0;
  for (const item of Array.isArray(items) ? items.slice(0, 2000) : []) {
    const village = normalizeAddressText(item?.village);
    if (!village) continue;
    const previous = existing(item) || {};
    await savePlaceOverride({ ...item, village, villageGroup: previous.villageGroup || "", community: previous.community || "" });
    saved += 1;
  }
  return { saved };
}

function indexExistingOverrides(overrides) {
  const byLoid = new Map(overrides.filter((item) => item.loid).map((item) => [item.loid, item]));
  const key = (item) => [item.oltIp, item.chassis, item.board, item.pon, item.onuId].map((part) => String(part ?? "").trim()).join("|");
  const byCoordinate = new Map(overrides.filter((item) => !item.loid).map((item) => [key(item), item]));
  return (item) => {
    const loid = String(item?.loid ?? "").trim();
    return loid ? byLoid.get(loid) : byCoordinate.get(key(item));
  };
}

/** 未归村地址的批量规则建议。 */
export async function getPlaceSuggestions({ limit = 30 } = {}) {
  await ensurePlaceAssignments();
  const rows = await query(`SELECT installation_address FROM merged_onu_snapshots
WHERE village = '' AND community = '' AND trim(installation_address) <> '';`);
  return suggestUnassignedKeywords(rows.map((row) => ({ installationAddress: row.installation_address })), { limit });
}

/** 规则预览：按关键词能匹配多少户，其中多少户目前未归村。 */
export async function previewPlaceRule(input = {}) {
  await ensurePlaceAssignments();
  const include = normalizeKeywordList(input.includeKeywords);
  const exclude = normalizeKeywordList(input.excludeKeywords);
  if (!include.length) return { matched: 0, unassigned: 0, samples: [] };
  const like = (keyword) => `replace(installation_address, ' ', '') LIKE ${sqlQuote(`%${keyword.replace(/[%_]/g, "")}%`)}`;
  const where = `(${include.map(like).join(" OR ")})${exclude.length ? ` AND NOT (${exclude.map(like).join(" OR ")})` : ""}`;
  const [[counts], samples] = await Promise.all([
    query(`SELECT count(*) AS matched, sum(CASE WHEN village = '' AND community = '' THEN 1 ELSE 0 END) AS unassigned
FROM merged_onu_snapshots WHERE ${where};`),
    query(`SELECT installation_address, village, village_group, community FROM merged_onu_snapshots WHERE ${where} LIMIT 5;`)
  ]);
  return {
    matched: Number(counts?.matched || 0),
    unassigned: Number(counts?.unassigned || 0),
    samples: samples.map((row) => ({
      address: row.installation_address,
      place: placeLabel({ village: row.village, villageGroup: row.village_group, community: row.community })
    }))
  };
}

/** PON 台账按口汇总归属，键为 OLT IP|板卡|PON。 */
/** PON 台账按口汇总归属，键为 OLT IP|板卡|PON；手动指定过的口带上 assigned（手动值）。 */
export async function getPonPlaceSummary() {
  await ensurePlaceAssignments();
  const [rows, ports] = await Promise.all([
    query("SELECT olt_ip, board, pon, village, village_group, community FROM merged_onu_snapshots;"),
    getPortPlaceAssignments()
  ]);
  const summary = summarizePonPlaces(rows.map((row) => ({
    oltIp: row.olt_ip,
    board: row.board,
    pon: row.pon,
    village: row.village,
    villageGroup: row.village_group,
    community: row.community
  })));
  // 每个口带上各行（一级地址）的手动值 rows；各行不同即为分路（split），整口不套用。
  const { splitKeys } = effectivePortAssignments(ports);
  for (const port of ports) {
    const key = ponPlaceKey(port);
    const entry = summary[key] || { total: 0, places: [], text: "" };
    entry.rows = { ...(entry.rows || {}), [normalizeAddressText(port.address)]: port };
    entry.split = splitKeys.has(key);
    summary[key] = entry;
  }
  return summary;
}
