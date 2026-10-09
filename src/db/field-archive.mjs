// 抢修档案：断纤记录、抢修验收存档、同缆组与 Pi Agent 未解决问题。只读写本地 SQLite。
import { exec, query, sqlQuote } from "./core.mjs";
import { outagePonKey, normalizeQuestion } from "../outage-events.mjs";

const OPEN_MATCH_MS = 6 * 60 * 60 * 1000;
const REVIEW_STATUSES = new Set(["candidate", "active", "rejected"]);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function mapOccurrence(row) {
  return {
    id: Number(row.id),
    ponKey: row.pon_key,
    oltIp: row.olt_ip,
    chassis: row.chassis,
    board: row.board,
    pon: row.pon,
    startedAt: row.started_at,
    recoveredAt: row.recovered_at || "",
    source: row.source,
    affected: Number(row.affected || 0),
    total: Number(row.total || 0)
  };
}

/**
 * 记录断纤：同一口已有未恢复记录、或 6 小时内已记过同一次断纤时只更新，不重复记录。
 * kind=recovered 的记录直接带上恢复时间（检测时已恢复）。
 */
export async function recordOutageOccurrences(items = [], { now = new Date().toISOString() } = {}) {
  let recorded = 0;
  for (const item of items) {
    const ponKey = outagePonKey(item);
    const started = Date.parse(item.startedAt);
    if (!item.oltIp || !item.board || !item.pon || !Number.isFinite(started)) continue;
    const recent = await query(`SELECT * FROM fiber_outage_occurrences WHERE pon_key = ${sqlQuote(ponKey)} ORDER BY started_at DESC LIMIT 3;`);
    const same = recent.find((row) => row.recovered_at === "" || Math.abs(Date.parse(row.started_at) - started) <= OPEN_MATCH_MS);
    const recoveredAt = item.kind === "recovered" ? now : "";
    if (same) {
      await exec(`UPDATE fiber_outage_occurrences SET
affected = max(affected, ${Number(item.affected) || 0}),
total = max(total, ${Number(item.total) || 0}),
started_at = min(started_at, ${sqlQuote(new Date(started).toISOString())}),
recovered_at = CASE WHEN recovered_at = '' THEN ${sqlQuote(recoveredAt)} ELSE recovered_at END,
updated_at = CURRENT_TIMESTAMP
WHERE id = ${Number(same.id)};`);
      continue;
    }
    await exec(`INSERT INTO fiber_outage_occurrences (pon_key, olt_ip, chassis, board, pon, started_at, recovered_at, source, affected, total)
VALUES (${[ponKey, item.oltIp, item.chassis, item.board, item.pon, new Date(started).toISOString(), recoveredAt, item.source || ""].map((value) => sqlQuote(String(value ?? ""))).join(", ")}, ${Number(item.affected) || 0}, ${Number(item.total) || 0});`);
    recorded += 1;
  }
  return { recorded };
}

/** 这些口当前已恢复：把它们未关闭的断纤记录标记为已恢复。 */
export async function closeOutageOccurrences(ponKeys = [], { now = new Date().toISOString() } = {}) {
  const keys = [...new Set(ponKeys)].filter(Boolean);
  if (!keys.length) return;
  await exec(`UPDATE fiber_outage_occurrences SET recovered_at = ${sqlQuote(now)}, updated_at = CURRENT_TIMESTAMP
WHERE recovered_at = '' AND pon_key IN (${keys.map(sqlQuote).join(", ")});`);
}

export async function getOutageOccurrences({ since = "" } = {}) {
  const rows = await query(`SELECT * FROM fiber_outage_occurrences ${since ? `WHERE started_at >= ${sqlQuote(since)}` : ""} ORDER BY started_at;`);
  return rows.map(mapOccurrence);
}

export async function recordRepairInspection({ queryValue, ponKeys = [], verdict = "", summary = {} } = {}) {
  await exec(`INSERT INTO fiber_repair_inspections (query_value, pon_keys_json, verdict, summary_json)
VALUES (${sqlQuote(String(queryValue || ""))}, ${sqlQuote(JSON.stringify([...new Set(ponKeys)]))}, ${sqlQuote(String(verdict || ""))}, ${sqlQuote(JSON.stringify(summary || {}))});`);
}

export async function getRepairInspections({ since = "", limit = 200 } = {}) {
  const rows = await query(`SELECT * FROM fiber_repair_inspections ${since ? `WHERE inspected_at >= ${sqlQuote(since)}` : ""} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(1000, Number(limit) || 200))};`);
  return rows.map((row) => ({
    id: Number(row.id),
    queryValue: row.query_value,
    ponKeys: parseJson(row.pon_keys_json, []),
    verdict: row.verdict || "",
    summary: parseJson(row.summary_json, {}),
    inspectedAt: row.inspected_at
  }));
}

function mapCableGroup(row) {
  return {
    id: Number(row.id),
    ponKeys: parseJson(row.pon_keys_json, []),
    together: Number(row.together || 0),
    maxTogether: Number(row.max_together || 0),
    status: row.status,
    note: row.note || "",
    updatedAt: row.updated_at || ""
  };
}

/** 用最新推断结果刷新同缆组候选：已审核 / 已驳回的组保持状态，只更新同断次数。 */
export async function saveCableGroupCandidates(groups = []) {
  for (const group of groups) {
    const keys = JSON.stringify([...group.ponKeys].sort());
    await exec(`INSERT INTO cable_groups (pon_keys_json, together, max_together) VALUES (${sqlQuote(keys)}, ${Number(group.together) || 0}, ${Number(group.maxTogether) || 0})
ON CONFLICT(pon_keys_json) DO UPDATE SET together = excluded.together, max_together = excluded.max_together, updated_at = CURRENT_TIMESTAMP;`);
  }
  return getCableGroups();
}

export async function getCableGroups({ status = "" } = {}) {
  const rows = await query(`SELECT * FROM cable_groups ${REVIEW_STATUSES.has(status) ? `WHERE status = ${sqlQuote(status)}` : ""} ORDER BY status = 'candidate' DESC, max_together DESC, id DESC;`);
  return rows.map(mapCableGroup);
}

export async function reviewCableGroup(id, { status, note } = {}) {
  const [row] = await query(`SELECT * FROM cable_groups WHERE id = ${Number(id) || 0};`);
  if (!row) throw Object.assign(new Error("同缆组不存在。"), { status: 404 });
  const next = status === undefined ? row.status : String(status);
  if (!REVIEW_STATUSES.has(next)) throw Object.assign(new Error("状态无效。"), { status: 400 });
  await exec(`UPDATE cable_groups SET status = ${sqlQuote(next)}, note = ${sqlQuote(note === undefined ? row.note : String(note).slice(0, 200))}, updated_at = CURRENT_TIMESTAMP WHERE id = ${Number(row.id)};`);
  const [updated] = await query(`SELECT * FROM cable_groups WHERE id = ${Number(row.id)};`);
  return mapCableGroup(updated);
}

function mapQuestion(row) {
  return {
    id: Number(row.id),
    question: row.question,
    reason: row.reason || "",
    source: row.source || "",
    askCount: Number(row.ask_count || 0),
    status: row.status,
    memoryId: row.memory_id === null || row.memory_id === undefined ? null : Number(row.memory_id),
    firstAt: row.first_at,
    lastAt: row.last_at
  };
}

/** 记录 Pi Agent / 飞书没能解决的问题：同一问题重复出现时累计次数；已忽略的再出现会重新打开。 */
export async function recordUnresolvedQuestion({ question, reason = "", source = "" } = {}) {
  const text = String(question || "").trim().slice(0, 300);
  const normalized = normalizeQuestion(text);
  if (normalized.length < 2) return null;
  await exec(`INSERT INTO agent_unresolved_questions (normalized, question, reason, source) VALUES (${[normalized, text, reason, source].map((value) => sqlQuote(String(value))).join(", ")})
ON CONFLICT(normalized) DO UPDATE SET ask_count = ask_count + 1, last_at = CURRENT_TIMESTAMP, reason = excluded.reason, question = excluded.question,
status = CASE WHEN status = 'ignored' THEN 'open' ELSE status END;`);
  const [row] = await query(`SELECT * FROM agent_unresolved_questions WHERE normalized = ${sqlQuote(normalized)};`);
  return mapQuestion(row);
}

export async function getUnresolvedQuestions({ status = "", limit = 200 } = {}) {
  const valid = new Set(["open", "answered", "ignored"]);
  const rows = await query(`SELECT * FROM agent_unresolved_questions ${valid.has(status) ? `WHERE status = ${sqlQuote(status)}` : ""} ORDER BY status = 'open' DESC, ask_count DESC, last_at DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))};`);
  return rows.map(mapQuestion);
}

export async function updateUnresolvedQuestion(id, { status, memoryId } = {}) {
  if (!["open", "answered", "ignored"].includes(status)) throw Object.assign(new Error("状态无效。"), { status: 400 });
  await exec(`UPDATE agent_unresolved_questions SET status = ${sqlQuote(status)}${memoryId ? `, memory_id = ${Number(memoryId)}` : ""} WHERE id = ${Number(id) || 0};`);
  const [row] = await query(`SELECT * FROM agent_unresolved_questions WHERE id = ${Number(id) || 0};`);
  if (!row) throw Object.assign(new Error("问题不存在。"), { status: 404 });
  return mapQuestion(row);
}
