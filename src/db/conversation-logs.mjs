// 对话调试日志（ADR-091）：飞书消息 / 按钮回调、Pi Agent 每轮问答的输入、回复和工具调用过程。
// 只存本机 SQLite，保留 30 天、最多 20000 条，供桌面“飞书查询日志 → 对话调试”排查问题。
import { exec, query, sqlQuote } from "./core.mjs";

const KEEP_DAYS = 30;
const KEEP_ROWS = 20000;
const CHANNELS = new Set(["feishu", "feishu-callback", "pi-feishu", "pi-desktop", "pi-other"]);
let insertsSincePrune = 0;

function clip(value, max) {
  const textValue = String(value ?? "");
  return textValue.length > max ? `${textValue.slice(0, max)}…（共 ${textValue.length} 字）` : textValue;
}

function mapLog(row, { full = false } = {}) {
  let trace = [];
  if (full) {
    try {
      trace = JSON.parse(row.trace_json || "[]");
    } catch {
      trace = [];
    }
  }
  return {
    id: Number(row.id),
    occurredAt: row.occurred_at,
    channel: row.channel,
    requestId: row.request_id || "",
    openId: row.open_id || "",
    userName: row.user_name || "",
    chatId: row.chat_id || "",
    chatType: row.chat_type || "",
    conversationKey: row.conversation_key || "",
    input: row.input || "",
    interpretation: row.interpretation || "",
    replyKind: row.reply_kind || "",
    replyText: full ? row.reply_text || "" : clip(row.reply_text, 300),
    source: row.source || "",
    error: row.error || "",
    durationMs: Number(row.duration_ms || 0),
    toolCount: Number(row.tool_count ?? 0),
    ...(full ? { trace } : {})
  };
}

export async function recordConversationLog(entry = {}) {
  const channel = CHANNELS.has(entry.channel) ? entry.channel : "pi-other";
  const trace = Array.isArray(entry.trace) ? entry.trace.slice(0, 40) : [];
  const values = [
    String(entry.occurredAt || new Date().toISOString()),
    channel,
    clip(entry.requestId, 200),
    clip(entry.openId, 100),
    clip(entry.userName, 64),
    clip(entry.chatId, 100),
    clip(entry.chatType, 20),
    clip(entry.conversationKey, 200),
    clip(entry.input, 2000),
    clip(entry.interpretation, 500),
    clip(entry.replyKind, 64),
    clip(entry.replyText, 12000),
    clip(JSON.stringify(trace), 60000),
    clip(entry.source, 64),
    clip(entry.error, 2000)
  ].map(sqlQuote);
  insertsSincePrune += 1;
  const prune = insertsSincePrune >= 200
    ? `\nDELETE FROM conversation_logs WHERE occurred_at < ${sqlQuote(new Date(Date.now() - KEEP_DAYS * 86400000).toISOString())};
DELETE FROM conversation_logs WHERE id <= (SELECT id FROM conversation_logs ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_ROWS});`
    : "";
  if (prune) insertsSincePrune = 0;
  await exec(`INSERT INTO conversation_logs (occurred_at, channel, request_id, open_id, user_name, chat_id, chat_type, conversation_key,
  input, interpretation, reply_kind, reply_text, trace_json, source, error, duration_ms)
VALUES (${values.join(", ")}, ${Math.max(0, Math.round(Number(entry.durationMs) || 0))});${prune}`);
}

/** 列表：按时间倒序；channel 为空表示全部，q 搜索提问、回复和人员。 */
export async function getConversationLogs({ channel = "", q = "", openId = "", days = 7, limit = 100, offset = 0 } = {}) {
  const clauses = [`occurred_at >= ${sqlQuote(new Date(Date.now() - Math.max(1, Math.min(KEEP_DAYS, Number(days) || 7)) * 86400000).toISOString())}`];
  if (channel === "pi") clauses.push("channel LIKE 'pi-%'");
  else if (CHANNELS.has(channel)) clauses.push(`channel = ${sqlQuote(channel)}`);
  if (openId) clauses.push(`open_id = ${sqlQuote(openId)}`);
  const keyword = String(q || "").trim();
  if (keyword) {
    const like = sqlQuote(`%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    clauses.push(`(input LIKE ${like} ESCAPE '\\' OR reply_text LIKE ${like} ESCAPE '\\' OR user_name LIKE ${like} ESCAPE '\\' OR error LIKE ${like} ESCAPE '\\')`);
  }
  const where = clauses.join(" AND ");
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const [count] = await query(`SELECT count(*) AS total FROM conversation_logs WHERE ${where};`);
  const rows = await query(`SELECT id, occurred_at, channel, request_id, open_id, user_name, chat_id, chat_type, conversation_key, input, interpretation,
  reply_kind, substr(reply_text, 1, 400) AS reply_text, source, error, duration_ms, json_array_length(trace_json) AS tool_count
FROM conversation_logs WHERE ${where} ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${Math.max(0, Number(offset) || 0)};`);
  return { total: Number(count?.total || 0), rows: rows.map((row) => mapLog(row)) };
}

/** 单条详情：完整回复和工具调用过程，并带出同一请求的其它记录（飞书消息与它触发的 Pi 问答）。 */
export async function getConversationLog(id) {
  const [row] = await query(`SELECT * FROM conversation_logs WHERE id = ${Number(id) || 0};`);
  if (!row) return null;
  const log = mapLog(row, { full: true });
  const related = log.requestId
    ? (await query(`SELECT * FROM conversation_logs WHERE request_id = ${sqlQuote(log.requestId)} AND id <> ${log.id} ORDER BY id;`)).map((item) => mapLog(item, { full: true }))
    : [];
  return { ...log, related };
}

/** 导出：所选记录的完整内容，连同同一请求的其它记录（飞书消息与它触发的 Pi 问答），按时间正序，最多 500 条。 */
export async function getConversationLogsForExport(ids = []) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((value) => Number.isInteger(value) && value > 0))].slice(0, 500);
  if (!list.length) return [];
  const rows = await query(`SELECT * FROM conversation_logs WHERE id IN (${list.join(", ")})
  OR (request_id <> '' AND request_id IN (SELECT request_id FROM conversation_logs WHERE id IN (${list.join(", ")}) AND request_id <> ''))
ORDER BY id LIMIT 1000;`);
  return rows.map((row) => mapLog(row, { full: true }));
}
