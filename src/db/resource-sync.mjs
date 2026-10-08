// 资源同步任务、用户资源快照、VLAN 快照与 ONU 状态历史。
import { exec, query, sqlQuote } from "./core.mjs";

function mapResourceSyncTask(row) {
  return {
    id: row.id,
    operation: row.operation || "nmse",
    oltId: row.olt_id,
    runAt: row.run_at,
    repeatDays: Number(row.repeat_days || 0),
    status: row.status,
    resultCount: Number(row.result_count || 0),
    error: row.error || "",
    createdAt: row.created_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    lastRunAt: row.last_run_at || "",
    lastStatus: row.last_status || ""
  };
}

export async function getResourceSyncTasks({ pendingOnly = false } = {}) {
  const rows = await query(`SELECT id, operation, olt_id, run_at, repeat_days, status, result_count, error, created_at, started_at, completed_at, last_run_at, last_status
FROM resource_sync_tasks
${pendingOnly ? "WHERE status = 'pending'" : ""}
ORDER BY run_at DESC, created_at DESC;`);
  return rows.map(mapResourceSyncTask);
}

export async function createResourceSyncTask({ id, operation = "full", oltId = "", runAt, repeatDays = 0 } = {}) {
  const taskId = String(id || "").trim();
  const syncOperation = String(operation || "").trim();
  const targetOltId = String(oltId || "").trim();
  const timestamp = String(runAt || "").trim();
  const intervalDays = Number(repeatDays);
  if (!taskId || !syncOperation || !timestamp) throw new Error("定时任务参数不完整。");
  if (!["network", "nmse", "merge", "full"].includes(syncOperation)) throw new Error("同步类型无效。");
  if (!Number.isInteger(intervalDays) || intervalDays < 0 || intervalDays > 365) throw new Error("重复间隔必须是 0-365 的整数天数。");
  await exec(`INSERT INTO resource_sync_tasks (id, operation, olt_id, run_at, repeat_days)
VALUES (${sqlQuote(taskId)}, ${sqlQuote(syncOperation)}, ${sqlQuote(targetOltId)}, ${sqlQuote(timestamp)}, ${intervalDays});`);
  const [row] = await query(`SELECT id, operation, olt_id, run_at, repeat_days, status, result_count, error, created_at, started_at, completed_at, last_run_at, last_status
FROM resource_sync_tasks WHERE id = ${sqlQuote(taskId)};`);
  return mapResourceSyncTask(row);
}

export async function updateResourceSyncTask(id, update = {}) {
  const taskId = String(id || "").trim();
  const status = String(update.status || "").trim();
  const allowedStatuses = new Set(["pending", "running", "success", "failed", "canceled"]);
  if (!taskId || !allowedStatuses.has(status)) throw new Error("定时任务状态无效。");
  const resultCount = Number.isFinite(Number(update.resultCount)) ? Math.max(0, Number(update.resultCount)) : 0;
  const error = String(update.error || "").slice(0, 500);
  const fieldValue = (field, column) => Object.hasOwn(update, field) ? (update[field] ? sqlQuote(update[field]) : "NULL") : column;
  const runAt = fieldValue("runAt", "run_at");
  const startedAt = fieldValue("startedAt", "started_at");
  const completedAt = fieldValue("completedAt", "completed_at");
  const lastRunAt = fieldValue("lastRunAt", "last_run_at");
  const lastStatus = Object.hasOwn(update, "lastStatus") ? sqlQuote(update.lastStatus || "") : "last_status";
  await exec(`UPDATE resource_sync_tasks
SET run_at = ${runAt}, status = ${sqlQuote(status)}, result_count = ${resultCount}, error = ${sqlQuote(error)}, started_at = ${startedAt}, completed_at = ${completedAt}, last_run_at = ${lastRunAt}, last_status = ${lastStatus}
WHERE id = ${sqlQuote(taskId)};`);
  const [row] = await query(`SELECT id, operation, olt_id, run_at, repeat_days, status, result_count, error, created_at, started_at, completed_at, last_run_at, last_status
FROM resource_sync_tasks WHERE id = ${sqlQuote(taskId)};`);
  return row ? mapResourceSyncTask(row) : null;
}

export async function deleteResourceSyncTask(id) {
  const taskId = String(id || "").trim();
  if (!taskId) throw new Error("定时任务 ID 无效。");
  await exec(`DELETE FROM resource_sync_tasks WHERE id = ${sqlQuote(taskId)};`);
  return { id: taskId };
}

function mapResourceUser(row) {
  return {
    oltIp: row.olt_ip, gridRank: row.grid_rank, onuIndex: row.onu_index, loid: row.loid, mac: row.mac,
    pon: row.pon, ponType: row.pon_type, deviceType: row.device_type, username: row.username,
    userPhone: row.user_phone, installationAddress: row.installation_address, syncedAt: row.synced_at
  };
}

function compareResourceUserOnuIndex(left, right) {
  const parse = (value) => {
    const [ponPath = "", onuId = ""] = String(value || "").split(":", 2);
    const [chassis = "", board = "", pon = ""] = ponPath.split("/", 3);
    return [chassis, board, pon, onuId].map((part) => /^\d+$/.test(part) ? Number(part) : Number.POSITIVE_INFINITY);
  };
  const leftParts = parse(left.onuIndex);
  const rightParts = parse(right.onuIndex);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return String(left.onuIndex).localeCompare(String(right.onuIndex), "zh-Hans-CN");
}

export async function getResourceUsers({ oltIp = "", q = "" } = {}) {
  const host = String(oltIp || "").trim();
  const keyword = String(q || "").trim().toLowerCase();
  const clauses = [];
  if (host) clauses.push(`olt_ip = ${sqlQuote(host)}`);
  if (keyword) clauses.push(`(lower(onu_index) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(loid) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(mac) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(username) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(user_phone) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(installation_address) LIKE ${sqlQuote(`%${keyword}%`)})`);
  const rows = await query(`SELECT * FROM resource_user_snapshots ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY pon, onu_index;`);
  return rows.map(mapResourceUser).sort(compareResourceUserOnuIndex);
}

export async function recordOnuStatusHistory({ oltId, oltIp, rows = [] } = {}) {
  const id = String(oltId || "").trim();
  const host = String(oltIp || "").trim();
  if (!id || !host || !rows.length) return { count: 0 };
  const inserts = rows
    .filter((row) => row.chassis !== undefined && row.board !== undefined && row.pon !== undefined && row.onuId !== undefined)
    .map((row) => {
      const values = {
        chassis: row.chassis,
        board: row.board ?? row.slot,
        pon: row.pon,
        onuId: row.onuId,
        serial: row.serial || "",
        phase: row.phase || "",
        rxPower: row.rxPower || "",
        distance: row.distance || "",
        lastOnlineTime: row.lastOnlineTime || "",
        lastOfflineTime: row.lastOfflineTime || "",
        lastOfflineCause: row.lastOfflineCause || "",
        lastOfflineCauseCode: row.lastOfflineCauseCode == null ? null : row.lastOfflineCauseCode
      };
      const fields = [
        id,
        host,
        values.chassis,
        values.board,
        values.pon,
        values.onuId,
        values.serial,
        values.phase,
        values.rxPower,
        values.distance,
        values.lastOnlineTime,
        values.lastOfflineTime,
        values.lastOfflineCause,
        values.lastOfflineCauseCode
      ].map(sqlQuote);
      return `INSERT INTO onu_status_history (olt_id, olt_ip, chassis, board, pon, onu_id, serial, phase, rx_power, distance, last_online_time, last_offline_time, last_offline_cause, last_offline_cause_code)
SELECT ${fields.join(", ")} WHERE NOT EXISTS (
  SELECT 1 FROM onu_status_history
  WHERE olt_id = ${sqlQuote(id)} AND chassis = ${sqlQuote(values.chassis)} AND board = ${sqlQuote(values.board)} AND pon = ${sqlQuote(values.pon)} AND onu_id = ${sqlQuote(values.onuId)}
    AND sampled_at >= datetime('now', '-5 minutes')
    AND serial = ${sqlQuote(values.serial)} AND phase = ${sqlQuote(values.phase)} AND rx_power = ${sqlQuote(values.rxPower)}
    AND last_offline_time = ${sqlQuote(values.lastOfflineTime)} AND last_offline_cause = ${sqlQuote(values.lastOfflineCause)}
);`;
    });
  if (!inserts.length) return { count: 0 };
  await exec(`BEGIN;
${inserts.join("\n")}
DELETE FROM onu_status_history WHERE sampled_at < datetime('now', '-30 days');
COMMIT;`);
  return { count: inserts.length };
}

export async function getOnuStatusHistory({ oltId, chassis, board, pon, onuId, days, limit = 48 } = {}) {
  const safeDays = days === undefined ? null : Math.max(1, Math.min(30, Number(days) || 7));
  const dateFilter = safeDays === null ? "" : `\n  AND sampled_at >= datetime('now', '-${safeDays} days')`;
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 48));
  const rows = await query(`SELECT serial, phase, rx_power, distance, last_online_time, last_offline_time, last_offline_cause, last_offline_cause_code, sampled_at
FROM onu_status_history
WHERE olt_id = ${sqlQuote(oltId)} AND chassis = ${sqlQuote(chassis)} AND board = ${sqlQuote(board)} AND pon = ${sqlQuote(pon)} AND onu_id = ${sqlQuote(onuId)}${dateFilter}
ORDER BY sampled_at DESC LIMIT ${safeLimit};`);
  return rows.map((row) => ({
    serial: row.serial || "",
    phase: row.phase || "",
    rxPower: row.rx_power || "",
    distance: row.distance || "",
    lastOnlineTime: row.last_online_time || "",
    lastOfflineTime: row.last_offline_time || "",
    lastOfflineCause: row.last_offline_cause || "",
    lastOfflineCauseCode: row.last_offline_cause_code == null ? null : Number(row.last_offline_cause_code),
    sampledAt: row.sampled_at || ""
  }));
}

export async function getResourceUserDatasetRevision() {
  const [state] = await query("SELECT revision FROM resource_user_dataset_state WHERE id = 1;");
  const revision = String(state?.revision || "").trim();
  if (!/^[a-f0-9]{32}$/.test(revision)) {
    throw new Error("用户快照数据集版本不可用。");
  }
  return `dataset:${revision}`;
}

const administrativeAddressSuffix = /(?:市|区|县|镇|乡|街道)$/;

const duplicatedRoadVillagePrefix = /^(?<prefix>.+(?:镇|乡|街道))(?<place>[\u4e00-\u9fff]{2,})(?:大道|路|街)\k<place>村(?<tail>.*)$/;

function removeDuplicatedResourceAddressPrefix(address) {
  const match = /^(?<prefix>.+?)(?<partition>\d+[^片]*片)(?<rest>.+)$/.exec(address);
  if (!match?.groups) return address;
  const { prefix, rest } = match.groups;
  for (let start = 0; start < prefix.length; start += 1) {
    const repeatedPrefix = prefix.slice(start);
    const repeatedAt = rest.indexOf(repeatedPrefix);
    if (administrativeAddressSuffix.test(repeatedPrefix) && repeatedAt >= 0) {
      return `${prefix}${rest.slice(repeatedAt + repeatedPrefix.length)}`;
    }
  }
  return address;
}

function removeDuplicatedRoadVillagePrefix(address) {
  const match = duplicatedRoadVillagePrefix.exec(address);
  if (!match?.groups) return address;
  const { prefix, place, tail } = match.groups;
  return `${prefix}${place}村${tail}`;
}

export function normalizeResourceInstallationAddress(value) {
  let address = String(value || "").trim().replace(/#+$/g, "").trim();
  while (true) {
    const cleaned = removeDuplicatedResourceAddressPrefix(address)
      .replace(/^广东省东莞市厚街镇?\d+[^东]*?片(?:\d+厚街村)?东莞市厚街镇/, "广东省东莞市厚街镇")
      .replace(/^广东省东莞市厚街镇厚街村/, "广东省东莞市厚街镇");
    const normalized = removeDuplicatedRoadVillagePrefix(cleaned);
    if (normalized === address) return address;
    address = normalized;
  }
}

function resourceInstallationAddress(row) {
  return normalizeResourceInstallationAddress(row.useraddr || row.installationAddress || "");
}

export async function cleanResourceInstallationAddresses() {
  const [snapshotRows, checkpointRows] = await Promise.all([
    query("SELECT olt_ip, onu_index, installation_address FROM resource_user_snapshots;"),
    query("SELECT olt_ip, onu_index, installation_address FROM resource_user_checkpoints;")
  ]);
  const changedSnapshots = snapshotRows.map((row) => ({ ...row, cleaned: normalizeResourceInstallationAddress(row.installation_address) }))
    .filter((row) => row.cleaned !== row.installation_address);
  const changedCheckpoints = checkpointRows.map((row) => ({ ...row, cleaned: normalizeResourceInstallationAddress(row.installation_address) }))
    .filter((row) => row.cleaned !== row.installation_address);
  const count = changedSnapshots.length + changedCheckpoints.length;
  if (!count) return { count: 0, snapshots: 0, checkpoints: 0 };
  await exec(`BEGIN;
${changedSnapshots.map((row) => `UPDATE resource_user_snapshots SET installation_address = ${sqlQuote(row.cleaned)} WHERE olt_ip = ${sqlQuote(row.olt_ip)} AND onu_index = ${sqlQuote(row.onu_index)};`).join("\n")}
${changedCheckpoints.map((row) => `UPDATE resource_user_checkpoints SET installation_address = ${sqlQuote(row.cleaned)} WHERE olt_ip = ${sqlQuote(row.olt_ip)} AND onu_index = ${sqlQuote(row.onu_index)};`).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('clean_resource_addresses', 'admin', ${sqlQuote(`${count} rows`)});
UPDATE resource_user_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
COMMIT;`);
  return { count, snapshots: changedSnapshots.length, checkpoints: changedCheckpoints.length };
}

export async function replaceResourceUsers({ oltIp, gridRank, rows = [] } = {}) {
  const host = String(oltIp || "").trim();
  if (!host) throw new Error("缺少 OLT 地址。");
  const inserts = rows.map((row) => `INSERT INTO resource_user_snapshots (olt_ip, grid_rank, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${sqlQuote(row.onuIndexName || row.onuIndex || "")}, ${sqlQuote(row.loid || "")}, ${sqlQuote(row.mac || "")}, ${sqlQuote(row.ponNo || row.pon || "")}, ${sqlQuote(row.ponType || "")}, ${sqlQuote(row.deviceType || "")}, ${sqlQuote(row.username || "")}, ${sqlQuote(row.usertel || row.userPhone || "")}, ${sqlQuote(resourceInstallationAddress(row))});`);
  if (rows.some((row) => !String(row.onuIndexName || row.onuIndex || "").trim())) throw new Error("资源管理用户数据缺少 ONU 索引。");
  await exec(`BEGIN;
DELETE FROM resource_user_snapshots WHERE olt_ip = ${sqlQuote(host)};
${inserts.join("\n")}
UPDATE resource_user_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_users', ${sqlQuote(host)}, ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length };
}

export async function replaceResourceUsersBatch({ datasets = [] } = {}) {
  if (!Array.isArray(datasets) || datasets.some((dataset) => !String(dataset?.oltIp || "").trim())) {
    throw new Error("资源管理用户批量快照缺少 OLT 地址。");
  }
  const hosts = [...new Set(datasets.map((dataset) => String(dataset.oltIp).trim()))];
  const invalidRows = datasets.flatMap((dataset) => (Array.isArray(dataset.rows) ? dataset.rows : [])
    .filter((row) => !String(row?.onuIndexName || row?.onuIndex || "").trim()));
  if (invalidRows.length) throw new Error("资源管理用户数据缺少 ONU 索引。");
  const inserts = datasets.flatMap((dataset) => (dataset.rows || []).map((row) => `INSERT INTO resource_user_snapshots (olt_ip, grid_rank, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
VALUES (${sqlQuote(dataset.oltIp)}, ${sqlQuote(dataset.gridRank)}, ${sqlQuote(row.onuIndexName || row.onuIndex || "")}, ${sqlQuote(row.loid || "")}, ${sqlQuote(row.mac || "")}, ${sqlQuote(row.ponNo || row.pon || "")}, ${sqlQuote(row.ponType || "")}, ${sqlQuote(row.deviceType || "")}, ${sqlQuote(row.username || "")}, ${sqlQuote(row.usertel || row.userPhone || "")}, ${sqlQuote(resourceInstallationAddress(row))});`));
  await exec(`BEGIN;
DELETE FROM resource_user_snapshots WHERE olt_ip IN (${hosts.map(sqlQuote).join(", ")});
${inserts.join("\n")}
UPDATE resource_user_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_users_batch', 'nmse-pon', ${sqlQuote(`${inserts.length} rows, ${hosts.length} olts`)});
COMMIT;`);
  return { count: inserts.length, oltCount: hosts.length };
}

export async function replaceResourceUserCheckpoint({ oltIp, gridRank, expectedTotal = 0, completedPages = 0, rows = [] } = {}) {
  const host = String(oltIp || "").trim();
  if (!host) throw new Error("缺少 OLT 地址。");
  if (rows.some((row) => !String(row.onuIndexName || row.onuIndex || "").trim())) throw new Error("资源管理用户数据缺少 ONU 索引。");
  const inserts = rows.map((row) => `INSERT INTO resource_user_checkpoints (olt_ip, grid_rank, expected_total, completed_pages, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${Number(expectedTotal) || 0}, ${Number(completedPages) || 0}, ${sqlQuote(row.onuIndexName || row.onuIndex || "")}, ${sqlQuote(row.loid || "")}, ${sqlQuote(row.mac || "")}, ${sqlQuote(row.ponNo || row.pon || "")}, ${sqlQuote(row.ponType || "")}, ${sqlQuote(row.deviceType || "")}, ${sqlQuote(row.username || "")}, ${sqlQuote(row.usertel || row.userPhone || "")}, ${sqlQuote(resourceInstallationAddress(row))});`);
  await exec(`BEGIN;
DELETE FROM resource_user_checkpoints WHERE olt_ip = ${sqlQuote(host)};
${inserts.join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('checkpoint_resource_users', ${sqlQuote(host)}, ${sqlQuote(`${rows.length}/${Number(expectedTotal) || 0} rows, ${Number(completedPages) || 0} pages`)});
COMMIT;`);
  return { count: rows.length, expectedTotal: Number(expectedTotal) || 0, completedPages: Number(completedPages) || 0 };
}

export async function getResourceVlanSnapshot(oltIp) {
  const host = String(oltIp || "").trim();
  const [olt] = await query(`SELECT * FROM resource_olt_vlan_snapshots WHERE olt_ip = ${sqlQuote(host)};`);
  const ports = await query(`SELECT snapshot.board, snapshot.pon, snapshot.svlan, snapshot.previous_outer_vlan, snapshot.synced_at, ledger.pon_port, ledger.outer_vlan
FROM resource_pon_vlan_snapshots snapshot
LEFT JOIN pon_ports ledger ON ledger.olt_ip = snapshot.olt_ip AND ledger.board = snapshot.board AND ledger.pon = snapshot.pon
WHERE snapshot.olt_ip = ${sqlQuote(host)} ORDER BY CAST(snapshot.board AS INTEGER), CAST(snapshot.pon AS INTEGER);`);
  return {
    olt: olt ? { oltIp: olt.olt_ip, gridRank: olt.grid_rank, beginCvlan: olt.begin_cvlan, endCvlan: olt.end_cvlan, distributionType: olt.distribution_type, syncedAt: olt.synced_at } : null,
    ports: ports.map((row) => ({ board: row.board, pon: row.pon, ponPort: row.pon_port || "", svlan: row.svlan, previousOuterVlan: row.previous_outer_vlan || "", outerVlan: row.outer_vlan || "", syncedAt: row.synced_at }))
  };
}

export async function replaceResourceVlans({ oltIp, gridRank, ponVlans = [], cvlan = {} } = {}) {
  const host = String(oltIp || "").trim();
  if (!host) throw new Error("缺少 OLT 地址。");
  const ledger = await query(`SELECT board, pon, outer_vlan FROM pon_ports WHERE olt_ip = ${sqlQuote(host)};`);
  const previous = new Map(ledger.map((row) => [`${row.board}/${row.pon}`, row.outer_vlan || ""]));
  const rows = ponVlans.filter((row) => /^\d+$/.test(String(row.board)) && /^\d+$/.test(String(row.pon)) && /^\d{1,4}$/.test(String(row.svlan)));
  const inserts = rows.map((row) => `INSERT INTO resource_pon_vlan_snapshots (olt_ip, grid_rank, board, pon, svlan, previous_outer_vlan)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${sqlQuote(row.board)}, ${sqlQuote(row.pon)}, ${sqlQuote(row.svlan)}, ${sqlQuote(previous.get(`${row.board}/${row.pon}`) || "")});`);
  const updates = rows.map((row) => `UPDATE pon_ports SET outer_vlan = ${sqlQuote(row.svlan)} WHERE olt_ip = ${sqlQuote(host)} AND board = ${sqlQuote(row.board)} AND pon = ${sqlQuote(row.pon)};`);
  await exec(`BEGIN;
DELETE FROM resource_pon_vlan_snapshots WHERE olt_ip = ${sqlQuote(host)};
${inserts.join("\n")}
INSERT INTO resource_olt_vlan_snapshots (olt_ip, grid_rank, begin_cvlan, end_cvlan, distribution_type, synced_at)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${sqlQuote(cvlan.begin || "")}, ${sqlQuote(cvlan.end || "")}, ${sqlQuote(cvlan.distributionType || "")}, CURRENT_TIMESTAMP)
ON CONFLICT(olt_ip) DO UPDATE SET grid_rank = excluded.grid_rank, begin_cvlan = excluded.begin_cvlan, end_cvlan = excluded.end_cvlan, distribution_type = excluded.distribution_type, synced_at = CURRENT_TIMESTAMP;
${updates.join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_vlans', ${sqlQuote(host)}, ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length };
}
