// 当天装机工单（ADR-090）：外勤装完即查。只保存一期网管 BOSS 当天成功工单的坐标和用户资料，
// 不推进 BOSS 水位、不改一期源快照和合并台账；查询时叠加到台账上，下一次台账同步后自然被台账取代。
import { exec, query, runSql, sqlQuote } from "./core.mjs";

const KEEP_DAYS = 7;

function wallIso(value) {
  const ms = Date.parse(`${String(value || "").replace(" ", "T")}+08:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/** 保存一批工单：同一 LOID 只保留接收时间最新的一条；返回新增或更新的条数。 */
export async function saveBossRecentInstalls(rows = [], { fetchedAt = new Date().toISOString() } = {}) {
  const latest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const loid = String(row?.loid || "").trim().toUpperCase();
    if (!loid || !row?.receivedAt || !row?.operation) continue;
    const previous = latest.get(loid);
    if (!previous || row.receivedAt > previous.receivedAt) latest.set(loid, { ...row, loid });
  }
  const list = [...latest.values()];
  const existing = new Map();
  if (list.length) {
    const found = await query(`SELECT loid, received_at FROM boss_recent_installs WHERE loid IN (${list.map((row) => sqlQuote(row.loid)).join(", ")});`);
    for (const row of found) existing.set(row.loid, row.received_at);
  }
  const changed = list.filter((row) => !existing.has(row.loid) || row.receivedAt > existing.get(row.loid));
  const statements = changed.map((row) => {
    const values = [
      row.loid, row.operation, row.workOrder || "", row.receivedAt, row.idempotencyKey || "",
      row.oltIp || "", row.onuIndex || "", row.username || "", row.userPhone || "", row.installationAddress || "",
      row.mac || "", row.deviceType || "", fetchedAt
    ].map((value) => sqlQuote(String(value).slice(0, 300)));
    return `INSERT OR REPLACE INTO boss_recent_installs (loid, operation, work_order, received_at, event_key, olt_ip, onu_index, username, user_phone, installation_address, mac, device_type, fetched_at)
VALUES (${values.join(", ")});`;
  });
  const cutoff = new Date(Date.parse(fetchedAt) - KEEP_DAYS * 24 * 3600 * 1000);
  const cutoffWall = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(cutoff);
  await runSql(`BEGIN IMMEDIATE;
${statements.join("\n")}
DELETE FROM boss_recent_installs WHERE received_at < ${sqlQuote(`${cutoffWall} 00:00:00`)};
COMMIT;`);
  return { saved: list.length, newCount: changed.length };
}

/** 已保存工单的幂等键，再次读取时跳过详情请求。 */
export async function getBossRecentInstallKeys() {
  return new Set((await query("SELECT event_key FROM boss_recent_installs WHERE event_key <> '';")).map((row) => row.event_key));
}

/** 当天装机工单（原样），供桌面页面查看。 */
export async function getBossRecentInstalls({ limit = 200 } = {}) {
  const rows = await query(`SELECT r.*, EXISTS (SELECT 1 FROM merged_onu_snapshots m WHERE upper(trim(m.loid)) = r.loid) AS in_ledger
FROM boss_recent_installs AS r ORDER BY r.received_at DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))};`);
  return rows.map((row) => ({
    loid: row.loid,
    operation: row.operation,
    receivedAt: row.received_at,
    oltIp: row.olt_ip,
    onuIndex: row.onu_index,
    username: row.username,
    userPhone: row.user_phone,
    installationAddress: row.installation_address,
    inLedger: Boolean(Number(row.in_ledger)),
    fetchedAt: row.fetched_at
  }));
}

export async function recordBossRecentInstallRun({ trigger = "manual", status, windowStart = "", windowEnd = "", eventCount = 0, newCount = 0, error = "", startedAt, completedAt = new Date().toISOString() } = {}) {
  await exec(`INSERT INTO boss_recent_install_runs (trigger, status, window_start, window_end, event_count, new_count, error, started_at, completed_at)
VALUES (${[trigger, status, windowStart, windowEnd].map(sqlQuote).join(", ")}, ${Number(eventCount) || 0}, ${Number(newCount) || 0},
  ${sqlQuote(String(error || "").slice(0, 300))}, ${sqlQuote(startedAt || completedAt)}, ${sqlQuote(completedAt)});
DELETE FROM boss_recent_install_runs WHERE id NOT IN (SELECT id FROM boss_recent_install_runs ORDER BY id DESC LIMIT 200);`);
}

export async function getBossRecentInstallRuns({ limit = 20 } = {}) {
  const rows = await query(`SELECT * FROM boss_recent_install_runs ORDER BY id DESC LIMIT ${Math.max(1, Math.min(200, Number(limit) || 20))};`);
  return rows.map((row) => ({
    id: Number(row.id),
    trigger: row.trigger,
    status: row.status,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    eventCount: Number(row.event_count || 0),
    newCount: Number(row.new_count || 0),
    error: row.error || "",
    startedAt: row.started_at,
    completedAt: row.completed_at
  }));
}

function parseOnuIndex(value) {
  const match = String(value || "").trim().match(/^(\d+)\/(\d+)\/(\d+):(\d+)$/);
  return match ? { chassis: match[1], board: match[2], pon: match[3], onuId: match[4] } : null;
}

/**
 * 把当天工单叠加到合并台账行上（纯函数）：工单晚于台账同步时间时以工单为准——
 * 新装 / 移机 / 换机的户放到工单坐标上（同 LOID 的旧坐标、同坐标的旧户去掉），销户的户去掉。
 */
export function overlayRecentInstalls(snapshotRows = [], installs = [], { oltIp = "" } = {}) {
  const host = String(oltIp || "").trim();
  const newer = installs.filter((item) => {
    if (host && item.oltIp !== host && item.operation !== "cancel") return false;
    return true;
  });
  if (!newer.length) return snapshotRows;
  // 合并台账的 synced_at 是 SQLite UTC 时间（“2026-10-01 12:16:07”），按 UTC 解析。
  const syncedMs = (row) => {
    const value = String(row.syncedAt || "").trim();
    if (!value) return 0;
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
    return Date.parse(iso) || 0;
  };
  const byLoid = new Map(newer.map((item) => [item.loid, item]));
  const coordinates = new Map();
  for (const item of newer) {
    if (item.operation !== "cancel" && item.coordinate) coordinates.set(`${item.oltIp}|${item.onuIndex}`, item);
  }
  const replacedLoids = new Set();
  const kept = snapshotRows.filter((row) => {
    const loid = String(row.loid || "").trim().toUpperCase();
    const install = loid ? byLoid.get(loid) : null;
    if (install && Date.parse(install.receivedIso) > syncedMs(row)) {
      const sameSpot = install.operation !== "cancel" && install.oltIp === row.oltIp && install.onuIndex === row.onuIndex;
      if (sameSpot) {
        replacedLoids.add(loid);
        return true;
      }
      return false;
    }
    if (install) replacedLoids.add(loid);
    const occupant = coordinates.get(`${row.oltIp}|${row.onuIndex}`);
    if (occupant && occupant.loid !== loid && Date.parse(occupant.receivedIso) > syncedMs(row)) return false;
    return true;
  });
  const added = newer
    .filter((item) => item.operation !== "cancel" && item.coordinate && !replacedLoids.has(item.loid) && (!host || item.oltIp === host))
    .map((item) => ({
      oltIp: item.oltIp,
      chassis: item.coordinate.chassis,
      board: item.coordinate.board,
      pon: item.coordinate.pon,
      onuId: item.coordinate.onuId,
      onuIndex: item.onuIndex,
      onuIndexDisplay: item.onuIndex,
      loid: item.loid,
      loidDisplay: item.loid,
      username: item.username,
      usernameSource: "boss",
      userPhone: item.userPhone,
      installationAddress: item.installationAddress,
      mac: item.mac,
      deviceType: item.deviceType,
      village: "",
      villageGroup: "",
      community: "",
      syncedAt: item.receivedIso,
      source: "boss-recent"
    }));
  return added.length ? [...kept, ...added] : kept;
}

/** 当天工单（供叠加）：只保留坐标可解析的新装 / 移机 / 换机和销户。 */
export async function getBossRecentInstallOverlay() {
  const rows = await query("SELECT * FROM boss_recent_installs WHERE operation IN ('install', 'move', 'replace', 'cancel');");
  return rows.map((row) => ({
    loid: row.loid,
    operation: row.operation,
    oltIp: row.olt_ip,
    onuIndex: row.onu_index,
    coordinate: parseOnuIndex(row.onu_index),
    username: row.username,
    userPhone: row.user_phone,
    installationAddress: row.installation_address,
    mac: row.mac,
    deviceType: row.device_type,
    receivedIso: wallIso(row.received_at)
  }));
}
