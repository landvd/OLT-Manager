// 未解决问题：飞书 / Gd Agent 没能解决的问题，管理员在“知识审核”里补答。只读写本地 SQLite。
import { exec, query, sqlQuote } from "./core.mjs";
import { normalizeQuestion } from "../question-text.mjs";

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

/** 记录 Gd Agent / 飞书没能解决的问题：同一问题重复出现时累计次数；已忽略的再出现会重新打开。 */
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
