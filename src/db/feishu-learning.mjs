// 飞书查询日志与自我学习建议（村名别名、常用说法）。只读写本地 SQLite。
import { exec, query, sqlQuote } from "./core.mjs";

const LOG_RETENTION_DAYS = 180;
const SUGGESTION_KINDS = new Set(["alias", "phrase"]);
const SUGGESTION_STATUSES = new Set(["candidate", "active", "rejected"]);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function sqlInt(value) {
  return Number.isFinite(value) ? String(Math.trunc(value)) : "NULL";
}

function mapLog(row) {
  return {
    id: Number(row.id),
    occurredAt: row.occurred_at,
    openId: row.open_id,
    userName: row.manual_name || row.user_name || "",
    chatId: row.chat_id,
    chatType: row.chat_type,
    chatName: row.chat_name || "",
    text: row.text,
    rewrittenText: row.rewritten_text || "",
    replyKind: row.reply_kind || "",
    queryType: row.query_type || "",
    resultCount: row.result_count === null || row.result_count === undefined ? null : Number(row.result_count),
    outcome: row.outcome || "",
    source: row.source || "",
    intent: row.intent || "",
    value: row.value || "",
    feedback: row.feedback || "",
    durationMs: Number(row.duration_ms || 0)
  };
}

/** 写入一条飞书提问日志，并清理保留期之前的记录。返回新记录。 */
export async function recordFeishuQueryLog(entry = {}) {
  const columns = {
    occurred_at: String(entry.occurredAt || new Date().toISOString()),
    open_id: String(entry.openId || ""),
    user_name: String(entry.userName || "").slice(0, 64),
    chat_id: String(entry.chatId || ""),
    chat_type: entry.chatType === "group" ? "group" : "direct",
    chat_name: String(entry.chatName || "").slice(0, 120),
    text: String(entry.text || "").slice(0, 500),
    rewritten_text: String(entry.rewrittenText || "").slice(0, 500),
    reply_kind: String(entry.replyKind || ""),
    query_type: String(entry.queryType || ""),
    decision: String(entry.decision || ""),
    intent: String(entry.intent || ""),
    value: String(entry.value || "").slice(0, 120),
    source: String(entry.source || ""),
    outcome: String(entry.outcome || "")
  };
  if (!columns.open_id || !columns.text) return null;
  await exec(`INSERT INTO feishu_query_logs (${Object.keys(columns).join(", ")}, result_count, duration_ms)
VALUES (${Object.values(columns).map((value) => sqlQuote(value)).join(", ")}, ${sqlInt(entry.resultCount)}, ${sqlInt(entry.durationMs) === "NULL" ? 0 : sqlInt(entry.durationMs)});
DELETE FROM feishu_query_logs WHERE occurred_at < ${sqlQuote(new Date(Date.parse(columns.occurred_at) - LOG_RETENTION_DAYS * 86400000).toISOString())};`);
  if (columns.user_name) {
    await exec(`INSERT INTO feishu_user_names (open_id, name, source) VALUES (${sqlQuote(columns.open_id)}, ${sqlQuote(columns.user_name)}, 'feishu')
ON CONFLICT(open_id) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP WHERE feishu_user_names.source <> 'manual';`);
  }
  const [row] = await query(`SELECT * FROM feishu_query_logs WHERE open_id = ${sqlQuote(columns.open_id)} AND occurred_at = ${sqlQuote(columns.occurred_at)} ORDER BY id DESC LIMIT 1;`);
  return row ? mapLog(row) : null;
}

/** 把某人在某会话里最近一条（30 分钟内）提问标为“没用 / 不对”。 */
export async function markFeishuQueryNegative({ openId, chatId, now = new Date().toISOString() } = {}) {
  const since = new Date(Date.parse(now) - 30 * 60 * 1000).toISOString();
  await exec(`UPDATE feishu_query_logs SET feedback = 'negative' WHERE id = (
SELECT id FROM feishu_query_logs WHERE open_id = ${sqlQuote(String(openId || ""))} AND chat_id = ${sqlQuote(String(chatId || ""))} AND occurred_at >= ${sqlQuote(since)}
ORDER BY id DESC LIMIT 1);`);
}

/** 同一人同一会话在某时间之前最近的一条提问（别名学习用）。 */
export async function getPreviousFeishuQuery({ openId, chatId, beforeId, since } = {}) {
  const [row] = await query(`SELECT * FROM feishu_query_logs WHERE open_id = ${sqlQuote(String(openId || ""))} AND chat_id = ${sqlQuote(String(chatId || ""))}
AND id < ${Number(beforeId) || 0} AND occurred_at >= ${sqlQuote(String(since || ""))} ORDER BY id DESC LIMIT 1;`);
  return row ? mapLog(row) : null;
}

export async function getFeishuQueryLogs({ days = 7, outcome = "", q = "", openId = "", limit = 200, offset = 0 } = {}) {
  const clauses = [`l.occurred_at >= ${sqlQuote(new Date(Date.now() - Math.max(1, Math.min(LOG_RETENTION_DAYS, Number(days) || 7)) * 86400000).toISOString())}`];
  if (outcome === "negative") clauses.push("l.feedback = 'negative'");
  else if (outcome) clauses.push(`l.outcome = ${sqlQuote(String(outcome))}`);
  if (openId) clauses.push(`l.open_id = ${sqlQuote(String(openId))}`);
  if (q) {
    const like = sqlQuote(`%${String(q).replace(/[%_]/g, "")}%`);
    clauses.push(`(l.text LIKE ${like} OR l.user_name LIKE ${like} OR n.name LIKE ${like} OR l.chat_name LIKE ${like})`);
  }
  const where = clauses.join(" AND ");
  const from = `FROM feishu_query_logs l LEFT JOIN feishu_user_names n ON n.open_id = l.open_id AND n.source = 'manual'`;
  const [count] = await query(`SELECT count(*) AS total ${from} WHERE ${where};`);
  const rows = await query(`SELECT l.*, n.name AS manual_name ${from} WHERE ${where} ORDER BY l.id DESC
LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))} OFFSET ${Math.max(0, Number(offset) || 0)};`);
  return { total: Number(count?.total || 0), rows: rows.map(mapLog) };
}

/** 统计：各结果占比、人员活跃度、没查到 / 答错最多的说法。 */
export async function getFeishuQueryStats({ days = 7 } = {}) {
  const since = sqlQuote(new Date(Date.now() - Math.max(1, Math.min(LOG_RETENTION_DAYS, Number(days) || 7)) * 86400000).toISOString());
  const [totals] = await query(`SELECT count(*) AS total,
sum(CASE WHEN outcome = 'no-result' THEN 1 ELSE 0 END) AS no_result,
sum(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
sum(CASE WHEN feedback = 'negative' THEN 1 ELSE 0 END) AS negative,
count(DISTINCT open_id) AS users,
avg(duration_ms) AS avg_ms
FROM feishu_query_logs WHERE occurred_at >= ${since};`);
  const people = await query(`SELECT l.open_id, coalesce(max(n.name), max(l.user_name), '') AS name, count(*) AS total,
sum(CASE WHEN l.outcome = 'no-result' THEN 1 ELSE 0 END) AS no_result, max(l.occurred_at) AS last_at
FROM feishu_query_logs l LEFT JOIN feishu_user_names n ON n.open_id = l.open_id AND n.source = 'manual'
WHERE l.occurred_at >= ${since} GROUP BY l.open_id ORDER BY total DESC LIMIT 50;`);
  const problems = await query(`SELECT text, count(*) AS times, count(DISTINCT open_id) AS people, max(occurred_at) AS last_at,
sum(CASE WHEN outcome = 'no-result' THEN 1 ELSE 0 END) AS no_result,
sum(CASE WHEN feedback = 'negative' THEN 1 ELSE 0 END) AS negative,
sum(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors
FROM feishu_query_logs WHERE occurred_at >= ${since} AND (outcome IN ('no-result', 'error') OR feedback = 'negative')
GROUP BY text ORDER BY times DESC, last_at DESC LIMIT 30;`);
  const slow = await query(`SELECT query_type, count(*) AS times, avg(duration_ms) AS avg_ms FROM feishu_query_logs
WHERE occurred_at >= ${since} AND query_type <> '' GROUP BY query_type ORDER BY avg_ms DESC LIMIT 10;`);
  const llm = await query(`SELECT count(*) AS times FROM feishu_query_logs WHERE occurred_at >= ${since} AND source = 'llm';`);
  return {
    days: Number(days) || 7,
    total: Number(totals?.total || 0),
    noResult: Number(totals?.no_result || 0),
    errors: Number(totals?.errors || 0),
    negative: Number(totals?.negative || 0),
    users: Number(totals?.users || 0),
    avgMs: Math.round(Number(totals?.avg_ms || 0)),
    llmTimes: Number(llm[0]?.times || 0),
    people: people.map((row) => ({ openId: row.open_id, name: row.name || "", total: Number(row.total), noResult: Number(row.no_result || 0), lastAt: row.last_at })),
    problems: problems.map((row) => ({ text: row.text, times: Number(row.times), people: Number(row.people), lastAt: row.last_at, noResult: Number(row.no_result || 0), negative: Number(row.negative || 0), errors: Number(row.errors || 0) })),
    slow: slow.map((row) => ({ queryType: row.query_type, times: Number(row.times), avgMs: Math.round(Number(row.avg_ms || 0)) }))
  };
}

export async function setFeishuUserName(openId, name) {
  const id = String(openId || "").trim();
  const text = String(name || "").trim().slice(0, 64);
  if (!id) throw Object.assign(new Error("缺少飞书用户。"), { status: 400 });
  if (!text) {
    await exec(`DELETE FROM feishu_user_names WHERE open_id = ${sqlQuote(id)} AND source = 'manual';`);
    return { openId: id, name: "" };
  }
  await exec(`INSERT INTO feishu_user_names (open_id, name, source) VALUES (${sqlQuote(id)}, ${sqlQuote(text)}, 'manual')
ON CONFLICT(open_id) DO UPDATE SET name = excluded.name, source = 'manual', updated_at = CURRENT_TIMESTAMP;`);
  return { openId: id, name: text };
}

function mapSuggestion(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    key: row.key,
    target: row.target,
    examples: parseJson(row.examples_json, []),
    hits: Number(row.hits || 0),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** 新增或累计一条学习建议；已驳回的保持驳回，只累计次数。 */
export async function upsertFeishuLearningSuggestion({ kind, key, target, example = "" } = {}) {
  if (!SUGGESTION_KINDS.has(kind)) throw new Error("学习建议类型无效。");
  const keyText = String(key || "").trim().slice(0, 120);
  const targetText = String(target || "").trim().slice(0, 120);
  if (!keyText || !targetText) return null;
  const [existing] = await query(`SELECT * FROM feishu_learning_suggestions WHERE kind = ${sqlQuote(kind)} AND key = ${sqlQuote(keyText)} AND target = ${sqlQuote(targetText)};`);
  if (existing) {
    const examples = parseJson(existing.examples_json, []);
    if (example && !examples.includes(example)) examples.push(String(example).slice(0, 200));
    await exec(`UPDATE feishu_learning_suggestions SET hits = hits + 1, examples_json = ${sqlQuote(JSON.stringify(examples.slice(-5)))}, updated_at = CURRENT_TIMESTAMP WHERE id = ${Number(existing.id)};`);
    const [row] = await query(`SELECT * FROM feishu_learning_suggestions WHERE id = ${Number(existing.id)};`);
    return mapSuggestion(row);
  }
  await exec(`INSERT INTO feishu_learning_suggestions (kind, key, target, examples_json) VALUES (${sqlQuote(kind)}, ${sqlQuote(keyText)}, ${sqlQuote(targetText)}, ${sqlQuote(JSON.stringify(example ? [String(example).slice(0, 200)] : []))});`);
  const [row] = await query(`SELECT * FROM feishu_learning_suggestions WHERE kind = ${sqlQuote(kind)} AND key = ${sqlQuote(keyText)} AND target = ${sqlQuote(targetText)};`);
  return mapSuggestion(row);
}

export async function getFeishuLearningSuggestions({ kind = "", status = "" } = {}) {
  const clauses = [];
  if (SUGGESTION_KINDS.has(kind)) clauses.push(`kind = ${sqlQuote(kind)}`);
  if (SUGGESTION_STATUSES.has(status)) clauses.push(`status = ${sqlQuote(status)}`);
  const rows = await query(`SELECT * FROM feishu_learning_suggestions ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY status = 'candidate' DESC, hits DESC, updated_at DESC LIMIT 300;`);
  return rows.map(mapSuggestion);
}

export async function reviewFeishuLearningSuggestion(id, { status, key, target } = {}) {
  const [row] = await query(`SELECT * FROM feishu_learning_suggestions WHERE id = ${Number(id) || 0};`);
  if (!row) throw Object.assign(new Error("学习建议不存在。"), { status: 404 });
  const next = {
    status: status === undefined ? row.status : String(status),
    key: key === undefined ? row.key : String(key).trim().slice(0, 120),
    target: target === undefined ? row.target : String(target).trim().slice(0, 120)
  };
  if (!SUGGESTION_STATUSES.has(next.status)) throw Object.assign(new Error("状态无效。"), { status: 400 });
  if (!next.key || !next.target) throw Object.assign(new Error("内容不能为空。"), { status: 400 });
  if (row.kind === "phrase" && next.key.split("{value}").length !== 2) throw Object.assign(new Error("说法里必须有且只有一个 {value}。"), { status: 400 });
  await exec(`UPDATE feishu_learning_suggestions SET status = ${sqlQuote(next.status)}, key = ${sqlQuote(next.key)}, target = ${sqlQuote(next.target)}, updated_at = CURRENT_TIMESTAMP WHERE id = ${Number(row.id)};`);
  const [updated] = await query(`SELECT * FROM feishu_learning_suggestions WHERE id = ${Number(row.id)};`);
  return mapSuggestion(updated);
}

export async function deleteFeishuLearningSuggestion(id) {
  await exec(`DELETE FROM feishu_learning_suggestions WHERE id = ${Number(id) || 0};`);
}
