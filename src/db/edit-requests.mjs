// 飞书资料修改申请（ADR-089）：外勤提交、审批人在飞书同意后修改本地 PON 台账一级地址或用户归属。
// 只读写本地 SQLite，不触发任何 OLT 命令，不回写网管二期或一期 BOSS。
import { exec, query, runSql, sqlQuote } from "./core.mjs";
import { normalizeAddressText } from "../village-regions.mjs";

function mapRequest(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    token: row.token,
    kind: row.kind,
    status: row.status,
    oltIp: row.olt_ip || "",
    oltName: row.olt_name || "",
    chassis: row.chassis || "",
    board: row.board || "",
    pon: row.pon || "",
    onuId: row.onu_id || "",
    loid: row.loid || "",
    username: row.username || "",
    userAddress: row.user_address || "",
    rowAddress: row.row_address || "",
    previousValue: row.previous_value || "",
    proposedValue: row.proposed_value || "",
    finalValue: row.final_value || "",
    requesterOpenId: row.requester_open_id || "",
    requesterName: row.requester_name || "",
    requesterChatId: row.requester_chat_id || "",
    approverOpenId: row.approver_open_id || "",
    approverName: row.approver_name || "",
    result: row.result || "",
    createdAt: row.created_at || "",
    decidedAt: row.decided_at || ""
  };
}

const REQUEST_COLUMNS = [
  ["token", "token"], ["kind", "kind"], ["olt_ip", "oltIp"], ["olt_name", "oltName"], ["chassis", "chassis"],
  ["board", "board"], ["pon", "pon"], ["onu_id", "onuId"], ["loid", "loid"], ["username", "username"],
  ["user_address", "userAddress"], ["row_address", "rowAddress"], ["previous_value", "previousValue"], ["proposed_value", "proposedValue"],
  ["requester_open_id", "requesterOpenId"], ["requester_name", "requesterName"], ["requester_chat_id", "requesterChatId"],
  ["created_at", "createdAt"]
];

export async function getEditApprover() {
  const [row] = await query("SELECT approver_open_id, approver_name, updated_at FROM feishu_edit_settings WHERE id = 1;");
  return row?.approver_open_id
    ? { openId: row.approver_open_id, name: row.approver_name || "", updatedAt: row.updated_at || "" }
    : null;
}

/** 指定审批人（一人）；openId 为空即取消。 */
export async function saveEditApprover({ openId = "", name = "" } = {}) {
  const id = String(openId || "").trim().slice(0, 100);
  await exec(`INSERT INTO feishu_edit_settings (id, approver_open_id, approver_name, updated_at)
VALUES (1, ${sqlQuote(id)}, ${sqlQuote(id ? String(name || "").trim().slice(0, 60) : "")}, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET approver_open_id = excluded.approver_open_id, approver_name = excluded.approver_name, updated_at = CURRENT_TIMESTAMP;`);
  return getEditApprover();
}

/** 和机器人说过话的飞书用户（供选择审批人），最近的在前。 */
export async function getFeishuKnownUsers({ limit = 100 } = {}) {
  // 姓名优先用桌面端备注名 / 已读取的飞书姓名（feishu_user_names），其次用日志里的姓名。
  const rows = await query(`SELECT open_id, max(occurred_at) AS last_at, count(*) AS query_count,
  coalesce(nullif((SELECT name FROM feishu_user_names AS names WHERE names.open_id = logs.open_id), ''),
    (SELECT user_name FROM feishu_query_logs AS named WHERE named.open_id = logs.open_id AND named.user_name <> '' ORDER BY named.id DESC LIMIT 1)) AS user_name
FROM feishu_query_logs AS logs GROUP BY open_id ORDER BY last_at DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 100))};`);
  return rows.map((row) => ({
    openId: row.open_id,
    name: row.user_name || "",
    lastAt: row.last_at || "",
    queryCount: Number(row.query_count || 0)
  }));
}

export async function createEditRequest(input = {}) {
  const values = REQUEST_COLUMNS.map(([, key]) => sqlQuote(String(input[key] ?? "").slice(0, 500)));
  const [row] = await query(`INSERT INTO feishu_edit_requests (${REQUEST_COLUMNS.map(([column]) => column).join(", ")})
VALUES (${values.join(", ")}) RETURNING *;`);
  return mapRequest(row);
}

export async function getEditRequest({ id, token } = {}) {
  const where = token ? `token = ${sqlQuote(String(token))}` : `id = ${Number(id) || 0}`;
  const [row] = await query(`SELECT * FROM feishu_edit_requests WHERE ${where};`);
  return mapRequest(row);
}

/** 同一目标、同一新值还在等待审批的申请（避免外勤重复提交）。 */
export async function findPendingEditRequest({ kind, oltIp, board, pon, onuId = "", loid = "", rowAddress = "", previousValue = "", proposedValue }) {
  const [row] = await query(`SELECT * FROM feishu_edit_requests WHERE status = 'pending' AND kind = ${sqlQuote(kind)}
  AND olt_ip = ${sqlQuote(oltIp)} AND board = ${sqlQuote(board)} AND pon = ${sqlQuote(pon)} AND onu_id = ${sqlQuote(onuId)}
  AND loid = ${sqlQuote(loid)} AND row_address = ${sqlQuote(rowAddress)} AND previous_value = ${sqlQuote(previousValue)} AND proposed_value = ${sqlQuote(proposedValue)}
ORDER BY id DESC LIMIT 1;`);
  return mapRequest(row);
}

export async function getEditRequests({ status = "", limit = 100 } = {}) {
  const where = ["pending", "approved", "rejected"].includes(status) ? `WHERE status = ${sqlQuote(status)}` : "";
  return (await query(`SELECT * FROM feishu_edit_requests ${where} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 100))};`)).map(mapRequest);
}

/** 原值变了：更新申请记录的原值，仍待审批。 */
export async function updateEditRequestPrevious({ token, previousValue }) {
  const [row] = await query(`UPDATE feishu_edit_requests SET previous_value = ${sqlQuote(String(previousValue ?? ""))}
WHERE token = ${sqlQuote(String(token))} AND status = 'pending' RETURNING *;`);
  return mapRequest(row);
}

/** 记录审批结果；只有仍待审批的申请会被更新，重复点击返回 null。 */
export async function decideEditRequest({ token, status, finalValue = "", approverOpenId = "", approverName = "", result = "", decidedAt }) {
  if (!["approved", "rejected"].includes(status)) throw new Error("审批结果无效。");
  const [row] = await query(`UPDATE feishu_edit_requests SET status = ${sqlQuote(status)}, final_value = ${sqlQuote(String(finalValue).slice(0, 500))},
  approver_open_id = ${sqlQuote(approverOpenId)}, approver_name = ${sqlQuote(String(approverName).slice(0, 60))},
  result = ${sqlQuote(String(result).slice(0, 500))}, decided_at = ${sqlQuote(decidedAt || new Date().toISOString())}
WHERE token = ${sqlQuote(String(token))} AND status = 'pending' RETURNING *;`);
  return mapRequest(row);
}

function mapPonRow(row) {
  return { oltIp: String(row.olt_ip).trim(), chassis: String(row.chassis || "").trim(), board: String(row.board).trim(), pon: String(row.pon).trim(), address: row.address || "" };
}

/** 某个 PON 口在台账里的各行（一级地址），同一地址只算一行。 */
export async function getPonLedgerRows({ oltIp, board, pon } = {}) {
  const rows = await query(`SELECT olt_ip, chassis, board, pon, address FROM pon_ports
WHERE trim(olt_ip) = ${sqlQuote(String(oltIp || "").trim())} AND trim(board) = ${sqlQuote(String(board || "").trim())}
  AND trim(pon) = ${sqlQuote(String(pon || "").trim())} ORDER BY id;`);
  const seen = new Set();
  return rows.map(mapPonRow).filter((row) => {
    const key = normalizeAddressText(row.address);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 按一级地址关键词查找台账行（外勤说“君汇那个口的一级地址应该是……”时使用）。 */
export async function findPonLedgerRowsByAddress(keyword, { limit = 10 } = {}) {
  const text = normalizeAddressText(keyword);
  if (text.length < 2) return [];
  const like = text.replace(/[\\%_]/g, (char) => `\\${char}`);
  const rows = await query(`SELECT olt_ip, chassis, board, pon, address FROM pon_ports
WHERE replace(replace(address, ' ', ''), char(9), '') LIKE ${sqlQuote(`%${like}%`)} ESCAPE '\\'
ORDER BY olt_ip, CAST(board AS INTEGER), CAST(pon AS INTEGER), id LIMIT ${Math.max(1, Math.min(50, Number(limit) || 10)) * 4};`);
  const seen = new Set();
  return rows.map(mapPonRow).filter((row) => {
    const key = [row.oltIp, row.board, row.pon, normalizeAddressText(row.address)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

/**
 * 修改一行台账的一级地址：台账里该口一级地址等于原值的行全部改为新值，
 * 该行按行指定的归属（键含一级地址）跟着搬到新地址。原值已不存在时返回 updated: 0。
 */
export async function applyPrimaryAddressEdit({ oltIp, board, pon, previousValue, value, source = "feishu" } = {}) {
  const previous = normalizeAddressText(previousValue);
  const next = String(value ?? "").trim();
  const nextKey = normalizeAddressText(next).slice(0, 200);
  if (!next) throw Object.assign(new Error("新的一级地址不能为空。"), { status: 400 });
  const rows = await query(`SELECT id, address FROM pon_ports
WHERE trim(olt_ip) = ${sqlQuote(String(oltIp).trim())} AND trim(board) = ${sqlQuote(String(board).trim())} AND trim(pon) = ${sqlQuote(String(pon).trim())};`);
  const ids = rows.filter((row) => normalizeAddressText(row.address) === previous).map((row) => Number(row.id));
  if (!ids.length) return { updated: 0 };
  const portWhere = `olt_ip = ${sqlQuote(String(oltIp).trim())} AND board = ${sqlQuote(String(board).trim())} AND pon = ${sqlQuote(String(pon).trim())}`;
  await runSql(`BEGIN IMMEDIATE;
UPDATE pon_ports SET address = ${sqlQuote(next)} WHERE id IN (${ids.join(", ")});
UPDATE OR REPLACE pon_place_assignments SET address = ${sqlQuote(nextKey)}, updated_at = CURRENT_TIMESTAMP
WHERE ${portWhere} AND address = ${sqlQuote(previous.slice(0, 200))};
UPDATE feishu_edit_requests SET row_address = ${sqlQuote(next)}
WHERE status = 'pending' AND kind = 'row-place' AND ${portWhere} AND replace(replace(row_address, ' ', ''), char(9), '') = ${sqlQuote(previous)};
INSERT INTO admin_events (action, source, detail) VALUES ('edit_primary_address', ${sqlQuote(source)},
  ${sqlQuote(`${oltIp} ${board}/${pon}：${previousValue} → ${next}`.slice(0, 500))});
COMMIT;`);
  return { updated: ids.length };
}

/** 某户当前的归属（合并台账归属列）。 */
export async function getOnuPlace({ oltIp, chassis, board, pon, onuId } = {}) {
  const [row] = await query(`SELECT loid, village, village_group, community FROM merged_onu_snapshots
WHERE olt_ip = ${sqlQuote(oltIp)} AND chassis = ${sqlQuote(chassis)} AND board = ${sqlQuote(board)} AND pon = ${sqlQuote(pon)} AND onu_id = ${sqlQuote(onuId)} LIMIT 1;`);
  return row ? { loid: row.loid || "", village: row.village || "", villageGroup: row.village_group || "", community: row.community || "" } : null;
}

/** 已有的归属组合：用于把外勤写的“厚街村下栅小组”拆成村和小组。 */
export async function getKnownPlaces() {
  const rows = await query(`SELECT DISTINCT village, village_group, community FROM merged_onu_snapshots WHERE village <> '' OR community <> ''
UNION SELECT DISTINCT village, village_group, community FROM pon_place_assignments;`);
  return rows.map((row) => ({ village: row.village || "", villageGroup: row.village_group || "", community: row.community || "" }));
}
