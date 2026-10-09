// 合并 ONU 数据源、BOSS 增量、同步运行/租约/manifest 与统一数据集。
import { randomUUID } from "node:crypto";
import { createSourceManifest, parseManifest, serializeManifest } from "../merged-onu-manifest.mjs";
import { buildSourceManifest } from "../merged-onu-runtime.mjs";
import { previousShanghaiCalendarDate } from "../nmse-boss-sync.mjs";
import { exec, query, runSql, sqlQuote } from "./core.mjs";

function mapMergedOnuSnapshot(row) {
  return {
    oltIp: row.olt_ip,
    chassis: row.chassis,
    board: row.board,
    pon: row.pon,
    onuId: row.onu_id,
    onuIndex: `${row.chassis}/${row.board}/${row.pon}:${row.onu_id}`,
    onuIndexDisplay: row.onu_index_display || "",
    deviceName: row.device_name || "",
    deviceNumber: row.device_number || "",
    loid: row.loid || "",
    loidDisplay: row.loid_display || "",
    mac: row.mac || "",
    serial: row.serial || "",
    username: row.username || "",
    usernameSource: row.username_source || "network",
    userPhone: row.user_phone || "",
    installationAddress: row.installation_address || "",
    deviceType: row.device_type || "",
    ponType: row.pon_type || "",
    phase: row.phase || "",
    rxPower: row.rx_power || "",
    distance: row.distance || "",
    nmseOltIp: row.nmse_olt_ip || "",
    nmseOnuIndex: row.nmse_onu_index || "",
    syncedAt: row.synced_at || ""
  };
}

function mapMergedOnuNetworkSource(row) {
  let duplicateConflicts = [];
  try {
    duplicateConflicts = JSON.parse(row.duplicate_conflicts_json || "[]");
  } catch {
    duplicateConflicts = [];
  }
  return {
    oltIp: row.olt_ip || "",
    chassis: row.chassis || "",
    board: row.board || "",
    pon: row.pon || "",
    onuId: row.onu_id || "",
    onuIndex: `${row.chassis || ""}/${row.board || ""}/${row.pon || ""}:${row.onu_id || ""}`,
    onuIndexDisplay: row.onu_index_display || "",
    deviceName: row.device_name || "",
    deviceNumber: row.device_number || "",
    loid: row.loid || "",
    loidDisplay: row.loid_display || "",
    mac: row.mac || "",
    serial: row.serial || "",
    username: row.username || "",
    userPhone: row.user_phone || "",
    installationAddress: row.installation_address || "",
    deviceType: row.device_type || "",
    ponType: row.pon_type || "",
    phase: row.phase || "",
    rxPower: row.rx_power || "",
    distance: row.distance || "",
    duplicateCount: Number(row.duplicate_count || 1),
    duplicateConflicts: Array.isArray(duplicateConflicts) ? duplicateConflicts : [],
    syncedAt: row.synced_at || ""
  };
}

function mapMergedOnuNmseSource(row) {
  return {
    oltIp: row.olt_ip || "",
    onuIndex: row.onu_index_display || "",
    onuIndexDisplay: row.onu_index_display || "",
    loid: row.loid || "",
    loidDisplay: row.loid_display || "",
    mac: row.mac || "",
    pon: row.pon || "",
    ponType: row.pon_type || "",
    deviceType: row.device_type || "",
    username: row.username || "",
    userPhone: row.user_phone || "",
    installationAddress: row.installation_address || "",
    syncedAt: row.synced_at || ""
  };
}

function serializeRunSummary(summary) {
  if (!summary || typeof summary !== "object") return "{}";
  return JSON.stringify(summary);
}

function parseRunSummary(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 一期 BOSS 已入库工单的幂等键（用于增量重叠窗口跳过详情请求）。 */
export async function getNmseBossEventKeys({ since = "" } = {}) {
  const rows = await query(`SELECT event_key FROM nmse_boss_change_events${since ? ` WHERE received_at >= ${sqlQuote(since)}` : ""};`);
  return new Set(rows.map((row) => String(row.event_key)));
}

export async function getMergedOnuNetworkSource() {
  const rows = await query(`SELECT * FROM merged_onu_network_snapshots
ORDER BY olt_ip, CAST(chassis AS INTEGER), CAST(board AS INTEGER), CAST(pon AS INTEGER), CAST(onu_id AS INTEGER);`);
  return rows.map(mapMergedOnuNetworkSource);
}

export async function getMergedOnuNmseSource() {
  const [rows, names] = await Promise.all([
    query(`SELECT olt_ip, onu_index_display, loid, loid_display, mac, pon, pon_type, device_type, username, user_phone, installation_address, synced_at
FROM merged_onu_nmse_snapshots ORDER BY id;`),
    query("SELECT loid, username, received_at, synced_at FROM nmse_boss_name_snapshots ORDER BY loid;")
  ]);
  const namesByLoid = new Map(names.map((row) => [String(row.loid || "").trim().toUpperCase(), row]));
  const matched = new Set();
  const projected = rows.map((row) => {
    const loid = String(row.loid || "").trim().toUpperCase();
    const name = namesByLoid.get(loid);
    if (name) matched.add(loid);
    return mapMergedOnuNmseSource(name ? { ...row, username: name.username || row.username, synced_at: name.synced_at || row.synced_at } : row);
  });
  for (const [loid, name] of namesByLoid) {
    if (!loid || matched.has(loid)) continue;
    projected.push(mapMergedOnuNmseSource({ loid, loid_display: loid, username: name.username, synced_at: name.synced_at }));
  }
  return projected;
}

export async function getMergedOnuSourceStatus() {
  const [state] = await query("SELECT * FROM merged_onu_source_state WHERE id = 1;");
  const [bossState] = await query("SELECT coverage_through FROM nmse_boss_sync_state WHERE id = 1;");
  const coverageThrough = bossState?.coverage_through || "";
  const source = (revision, count, updatedAt, coverageThrough = "") => ({
    synced: Boolean(String(updatedAt || "").trim()),
    revision: revision ? `source:${revision}` : "",
    count: Number(count || 0),
    updatedAt: updatedAt || "",
    snapshotAt: updatedAt || "",
    coverageThrough: coverageThrough || ""
  });
  return {
    network: source(state?.network_revision, state?.network_count, state?.network_updated_at),
    nmse: source(state?.nmse_revision, state?.nmse_count, state?.nmse_updated_at, coverageThrough)
  };
}

function mergedOnuNetworkSourceValues(row) {
  return [
    row.oltIp || "", row.chassis || "", row.board || "", row.pon || "", row.onuId || "",
    row.onuIndexDisplay || row.onuIndex || "", row.deviceName || "", row.deviceNumber || "", row.loid || "",
    row.loidDisplay || row.loid || "", row.mac || "", row.serial || "", row.username || "",
    row.userPhone || "", row.installationAddress || "", row.deviceType || "", row.ponType || "",
    row.phase || "", row.rxPower || "", row.distance || "",
    Number(row.duplicateCount || 1),
    JSON.stringify(Array.isArray(row.duplicateConflicts) ? row.duplicateConflicts : [])
  ].map(sqlQuote);
}

export async function replaceMergedOnuNetworkSource({ rows = [], manifestContext = null } = {}) {
  const invalid = rows.filter((row) => [row?.oltIp, row?.chassis, row?.board, row?.pon, row?.onuId].some((value) => !String(value ?? "").trim()));
  if (invalid.length) throw new Error("网管二期源快照包含缺少主键坐标的记录。");
  const inserts = rows.map((row) => `INSERT INTO merged_onu_network_snapshots
(olt_ip, chassis, board, pon, onu_id, onu_index_display, device_name, device_number, loid, loid_display, mac, serial, username, user_phone, installation_address, device_type, pon_type, phase, rx_power, distance, duplicate_count, duplicate_conflicts_json)
VALUES (${mergedOnuNetworkSourceValues(row).join(", ")});`);
  const sourceRevision = manifestContext ? randomUUID().replace(/-/g, "") : "";
  const sourceManifest = manifestContext ? buildSourceManifest({
    source: "network",
    runId: manifestContext.runId,
    idempotencyKey: manifestContext.idempotencyKey || "",
    startedAt: manifestContext.startedAt,
    completedAt: manifestContext.completedAt || new Date().toISOString(),
    targetOltIds: manifestContext.targetOltIds || [...new Set(rows.map((r) => r.oltIp).filter(Boolean))],
    sourceRevision: `source:${sourceRevision}`,
    rowCount: rows.length,
    windowStart: manifestContext.windowStart,
    windowEnd: manifestContext.windowEnd
  }) : null;
  await exec(`BEGIN;
DELETE FROM merged_onu_network_snapshots;
${inserts.join("\n")}
UPDATE merged_onu_source_state SET network_revision = ${sourceRevision ? sqlQuote(sourceRevision) : "lower(hex(randomblob(16)))"}, network_count = ${rows.length}, network_updated_at = CURRENT_TIMESTAMP WHERE id = 1;
${sourceManifest ? `INSERT INTO merged_onu_sync_manifests
(run_id, manifest_type, source, idempotency_key, manifest_json, source_revision_json, target_olt_ids_json, window_start, window_end, row_count, status)
VALUES (${[manifestContext.runId, "source", "network", sourceManifest.idempotencyKey || "", serializeManifest(sourceManifest), JSON.stringify(sourceManifest.sourceRevision), JSON.stringify(sourceManifest.targetOltIds), sourceManifest.windowStart, sourceManifest.windowEnd, rows.length, sourceManifest.status].map((value, index) => index === 4 ? sqlQuote(value) : (index === 9 ? String(value) : sqlQuote(value))).join(", ")})
ON CONFLICT(run_id, manifest_type, source) DO UPDATE SET manifest_json=excluded.manifest_json, source_revision_json=excluded.source_revision_json, target_olt_ids_json=excluded.target_olt_ids_json, window_start=excluded.window_start, window_end=excluded.window_end, row_count=excluded.row_count, status=excluded.status, updated_at=CURRENT_TIMESTAMP;` : ""}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_merged_onu_network_source', 'oss-ngb', ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length, source: (await getMergedOnuSourceStatus()).network, manifest: sourceManifest };
}

export async function replaceMergedOnuNmseSource({ rows = [] } = {}) {
  const invalid = rows.filter((row) => !String(row?.oltIp || "").trim() || (!String(row?.onuIndexDisplay || row?.onuIndex || "").trim() && !String(row?.loid || "").trim()));
  if (invalid.length) throw new Error("NMSE-PON 源快照包含无法归属的记录。");
  const inserts = rows.map((row) => `INSERT INTO merged_onu_nmse_snapshots
(olt_ip, onu_index_display, loid, loid_display, username, user_phone, installation_address)
VALUES (${[
    row.oltIp,
    row.onuIndexDisplay || row.onuIndex || "",
    row.loid || "",
    row.loidDisplay || row.loid || "",
    row.username || "",
    row.userPhone || "",
    row.installationAddress || ""
  ].map(sqlQuote).join(", ")});`);
  await exec(`BEGIN;
DELETE FROM merged_onu_nmse_snapshots;
${inserts.join("\n")}
UPDATE merged_onu_source_state SET nmse_revision = lower(hex(randomblob(16))), nmse_count = ${rows.length}, nmse_updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_merged_onu_nmse_source', 'nmse-pon', ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length, source: (await getMergedOnuSourceStatus()).nmse };
}

export async function getNmseBossSyncState() {
  const [row] = await query("SELECT watermark, last_window_start, last_window_end, coverage_through, name_history_start, name_history_end, name_history_completed_at, name_history_count, name_history_skipped_count, name_history_conflict_count, updated_at FROM nmse_boss_sync_state WHERE id = 1;");
  return {
    watermark: row?.watermark || "",
    lastWindowStart: row?.last_window_start || "",
    lastWindowEnd: row?.last_window_end || "",
    coverageThrough: row?.coverage_through || "",
    nameHistoryStart: row?.name_history_start || "",
    nameHistoryEnd: row?.name_history_end || "",
    nameHistoryCompletedAt: row?.name_history_completed_at || "",
    nameHistoryCount: Number(row?.name_history_count || 0),
    nameHistorySkippedCount: Number(row?.name_history_skipped_count || 0),
    nameHistoryConflictCount: Number(row?.name_history_conflict_count || 0),
    updatedAt: row?.updated_at || ""
  };
}

export async function initializeNmseBossSyncState({ watermark } = {}) {
  const value = String(watermark || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2}) 00:00:00$/.exec(value);
  const validDate = match && (() => {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
  })();
  if (!validDate) throw new Error("一期 BOSS 初始水位必须是有效的 YYYY-MM-DD 00:00:00。");
  const coverageThrough = previousShanghaiCalendarDate(value);
  const today = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const eligible = Date.UTC(today.year, today.month - 1, today.day) - 24 * 60 * 60 * 1000;
  if (Date.parse(`${value.replace(" ", "T")}+08:00`) > eligible) throw new Error("一期 BOSS 初始水位不能晚于昨日 00:00:00。");
  await exec(`BEGIN;
UPDATE nmse_boss_sync_state SET watermark=${sqlQuote(value)}, coverage_through=${sqlQuote(coverageThrough)}, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND watermark='';
COMMIT;`);
  const state = await getNmseBossSyncState();
  if (state.watermark && state.watermark !== value) { const error = new Error("一期 BOSS 水位已经初始化，只能保留已有水位。"); error.status = 409; throw error; }
  return state;
}

export async function resetNmseBossNameHistory() {
  await exec(`BEGIN;
UPDATE nmse_boss_sync_state
SET name_history_completed_at = '',
    name_history_count = 0,
    name_history_skipped_count = 0,
    name_history_conflict_count = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('reset_nmse_boss_name_history', 'nmse-boss', 'Reset name history completion status');
COMMIT;`);
  return getNmseBossSyncState();
}

const NMSE_EFFECTIVE_SOURCE_COUNT_SQL = `(SELECT count(*) FROM merged_onu_nmse_snapshots) +
  (SELECT count(*) FROM nmse_boss_name_snapshots names
   WHERE NOT EXISTS (SELECT 1 FROM merged_onu_nmse_snapshots snapshot WHERE upper(trim(snapshot.loid)) = upper(trim(names.loid))))`;

/** Atomically install the one-time historical BOSS LOID/name directory. */
export async function replaceNmseBossNameHistory({
  rows = [],
  watermark,
  windowStart = "",
  windowEnd = "",
  coverageThrough = "",
  eventCount = 0,
  skippedCount = 0,
  conflictCount = 0,
  manifestContext = null,
  force = false
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError("BOSS 历史姓名必须是数组。");
  if (!String(watermark || "").trim() || !String(windowStart || "").trim() || !String(windowEnd || "").trim()) throw new Error("BOSS 历史姓名缺少完整时间范围。");
  const seen = new Set();
  for (const row of rows) {
    const loid = String(row?.loid || "").trim().toUpperCase();
    if (!loid || !String(row?.username || "").trim() || !String(row?.receivedAt || "").trim()) throw new Error("BOSS 历史姓名包含无法按 LOID 归属的记录。");
    if (seen.has(loid)) throw new Error("BOSS 历史姓名包含重复 LOID。");
    seen.add(loid);
  }
  const [current] = await query("SELECT watermark, name_history_completed_at FROM nmse_boss_sync_state WHERE id=1;");
  const wallMs = (value) => Date.parse(`${String(value || "").replace(" ", "T")}+08:00`);
  if (!force && String(current?.name_history_completed_at || "").trim()) { const error = new Error("一期 BOSS 历史姓名已经初始化，不会重复覆盖。"); error.status = 409; throw error; }
  if (!force && current?.watermark && wallMs(watermark) < wallMs(current.watermark)) { const error = new Error("BOSS 历史姓名截止时间早于现有增量水位，已拒绝提交。"); error.status = 409; throw error; }
  const inserts = rows.map((row) => `INSERT INTO nmse_boss_name_snapshots (loid, username, work_order, received_at)
VALUES (${[String(row.loid).trim().toUpperCase(), row.username, row.workOrder || "", row.receivedAt].map(sqlQuote).join(", ")});`);
  const sourceRevision = randomUUID().replace(/-/g, "");
  const completedAt = manifestContext?.completedAt || new Date().toISOString();
  const sourceManifest = manifestContext ? createSourceManifest({
    source: "nmse", sourceKind: "nmse-boss-incremental-overlay",
    scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" },
    collectionStartedAt: manifestContext.startedAt, collectionCompletedAt: completedAt,
    windowStart: manifestContext.windowStart, windowEnd: manifestContext.windowEnd,
    sourceRevision: `source:${sourceRevision}`, targetOltIds: manifestContext.targetOltIds,
    rowCount: rows.length, status: "complete", runId: manifestContext.runId, idempotencyKey: "",
    exclusiveWatermark: manifestContext.windowEnd,
    coverageThrough: manifestContext.coverageThrough || coverageThrough,
    checkpoint: { status: "complete", cursor: null, updatedAt: completedAt }
  }) : null;
  await exec(`.bail on
BEGIN IMMEDIATE;
DELETE FROM nmse_boss_name_snapshots;
${inserts.join("\n")}
UPDATE merged_onu_nmse_snapshots
SET username=(SELECT names.username FROM nmse_boss_name_snapshots names WHERE upper(trim(names.loid))=upper(trim(merged_onu_nmse_snapshots.loid))), synced_at=CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM nmse_boss_name_snapshots names WHERE upper(trim(names.loid))=upper(trim(merged_onu_nmse_snapshots.loid)));
UPDATE nmse_boss_sync_state SET watermark=${sqlQuote(watermark)}, last_window_start=${sqlQuote(windowStart)}, last_window_end=${sqlQuote(windowEnd)}, coverage_through=${sqlQuote(coverageThrough)},
  name_history_start=${sqlQuote(windowStart)}, name_history_end=${sqlQuote(windowEnd)}, name_history_completed_at=${sqlQuote(completedAt)},
  name_history_count=${Number(rows.length)}, name_history_skipped_count=${Number(skippedCount) || 0}, name_history_conflict_count=${Number(conflictCount) || 0}, updated_at=CURRENT_TIMESTAMP WHERE id=1;
UPDATE merged_onu_source_state SET nmse_revision=${sqlQuote(sourceRevision)}, nmse_count=${NMSE_EFFECTIVE_SOURCE_COUNT_SQL}, nmse_updated_at=CURRENT_TIMESTAMP WHERE id=1;
UPDATE resource_user_dataset_state SET revision=lower(hex(randomblob(16))), updated_at=CURRENT_TIMESTAMP WHERE id=1;
${sourceManifest ? `INSERT INTO merged_onu_sync_manifests
(run_id, manifest_type, source, idempotency_key, manifest_json, source_revision_json, target_olt_ids_json, window_start, window_end, row_count, status)
VALUES (${[manifestContext.runId, "source", "nmse", sourceManifest.idempotencyKey || "", `json_set(${sqlQuote(serializeManifest(sourceManifest))}, '$.rowCount', ${NMSE_EFFECTIVE_SOURCE_COUNT_SQL})`, JSON.stringify(sourceManifest.sourceRevision), JSON.stringify(sourceManifest.targetOltIds), sourceManifest.windowStart, sourceManifest.windowEnd, NMSE_EFFECTIVE_SOURCE_COUNT_SQL, sourceManifest.status].map((value, index) => index === 4 || index === 9 ? String(value) : sqlQuote(value)).join(", ")})
ON CONFLICT(run_id, manifest_type, source) DO UPDATE SET manifest_json=excluded.manifest_json, source_revision_json=excluded.source_revision_json, target_olt_ids_json=excluded.target_olt_ids_json, window_start=excluded.window_start, window_end=excluded.window_end, row_count=excluded.row_count, status=excluded.status, updated_at=CURRENT_TIMESTAMP;` : ""}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_nmse_boss_name_history', 'nmse-boss', ${sqlQuote(`${Number(eventCount) || 0} events; ${rows.length} names; ${Number(skippedCount) || 0} skipped; ${Number(conflictCount) || 0} conflicts`)});
COMMIT;`);
  const source = (await getMergedOnuSourceStatus()).nmse;
  return { count: source.count, nameCount: rows.length, watermark: String(watermark), windowStart: String(windowStart), windowEnd: String(windowEnd), coverageThrough: String(coverageThrough), source };
}

/** Apply only successfully fetched, normalized BOSS rows in one transaction. */
export async function applyNmseBossIncrementalChanges({ rows = [], watermark, windowStart = "", windowEnd = "", coverageThrough = "", manifestContext = null } = {}) {
  if (!String(watermark || "").trim()) throw new Error("BOSS 增量同步缺少成功水位。");
  if (!Array.isArray(rows)) throw new TypeError("BOSS 增量变更必须是数组。");
  const effectiveCoverageThrough = String(coverageThrough || manifestContext?.coverageThrough || "").trim();
  const [currentBossState] = await query("SELECT watermark FROM nmse_boss_sync_state WHERE id = 1;");
  const currentWatermark = String(currentBossState?.watermark || "").trim();
  const wallMs = (value) => Date.parse(`${String(value || "").replace(" ", "T")}+08:00`);
  if (currentWatermark && wallMs(watermark) < wallMs(currentWatermark)) {
    const error = new Error("BOSS 水位不能回退，已拒绝提交。");
    error.status = 409;
    throw error;
  }
  if (currentWatermark && (!windowStart || !windowEnd || wallMs(windowStart) > wallMs(currentWatermark) || wallMs(windowEnd) < wallMs(currentWatermark))) {
    const error = new Error("BOSS 增量时间窗口与当前水位不一致，已拒绝提交。");
    error.status = 409;
    throw error;
  }
  const orderKeys = new Map();
  const batchKeys = new Set();
  let effectiveRowsForConflict = [];
  const orderedRows = [...rows].sort((left, right) => `${String(left?.receivedAt || "")}|${String(left?.idempotencyKey || "")}`.localeCompare(`${String(right?.receivedAt || "")}|${String(right?.idempotencyKey || "")}`));
  for (const row of orderedRows) {
    if (!row?.loid || !row?.receivedAt) continue;
    const tie = `${String(row.loid).trim().toUpperCase()}|${String(row.receivedAt).trim()}`;
    const key = String(row.idempotencyKey || "").trim();
    if (key && batchKeys.has(key)) {
      const error = new Error("BOSS 同批记录包含重复幂等键，已拒绝提交。");
      error.status = 409;
      throw error;
    }
    if (key) batchKeys.add(key);
    const previous = orderKeys.get(tie);
    if (previous && previous !== key) {
      const error = new Error("BOSS 同一 LOID 和接收时间存在无法排序的多条工单，已拒绝提交。");
      error.status = 409;
      throw error;
    }
    orderKeys.set(tie, key);
  }
  const identities = [...new Set(orderedRows.map((row) => String(row?.loid || "").trim().toUpperCase()).filter(Boolean))];
  let mutationRows = orderedRows;
  if (identities.length) {
    const clauses = identities.map((loid) => `upper(trim(loid))=${sqlQuote(loid)}`).join(" OR ");
    const historical = await query(`SELECT event_key, loid, operation, received_at, olt_ip, onu_index, username, user_phone, installation_address, mac, pon, pon_type, device_type FROM nmse_boss_change_events WHERE ${clauses};`);
    const currentResource = await query(`SELECT olt_ip, onu_index, loid, grid_rank, mac, pon, pon_type, device_type, username, user_phone, installation_address FROM resource_user_snapshots WHERE ${clauses};`);
    const currentNmse = await query(`SELECT olt_ip, onu_index_display AS onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address FROM merged_onu_nmse_snapshots WHERE ${clauses};`);
    const historicalNames = await query(`SELECT loid, username FROM nmse_boss_name_snapshots WHERE ${clauses};`);
    const latestHistoricalByLoid = new Map();
    for (const item of historical) {
      const loid = String(item.loid || "").trim().toUpperCase();
      const previous = latestHistoricalByLoid.get(loid);
      if (!previous || wallMs(item.received_at) > wallMs(previous.received_at)) latestHistoricalByLoid.set(loid, item);
    }
    const latestIncomingByLoid = new Map();
    for (const row of orderedRows) {
      const loid = String(row?.loid || "").trim().toUpperCase();
      if (!loid) continue;
      const previous = latestIncomingByLoid.get(loid);
      if (!previous || wallMs(row.receivedAt) > wallMs(previous.receivedAt)) latestIncomingByLoid.set(loid, row);
    }
    // SQL newer-event guards apply only the newest effective event per LOID.
    // Use the same projection for coordinate preflight so a legal move/cancel
    // in this overlapping window can release a coordinate before another LOID
    // claims it.
    effectiveRowsForConflict = [...latestIncomingByLoid.values()].filter((row) => {
      const previous = latestHistoricalByLoid.get(String(row.loid).trim().toUpperCase());
      return !previous || wallMs(row.receivedAt) > wallMs(previous.received_at);
    });
    const previousByLoid = new Map();
    for (const item of [...historicalNames, ...currentNmse, ...currentResource]) {
      const loid = String(item.loid || "").trim().toUpperCase();
      const previous = previousByLoid.get(loid) || {};
      for (const [field, dbField] of Object.entries({ gridRank: "grid_rank", mac: "mac", pon: "pon", ponType: "pon_type", deviceType: "device_type", username: "username", userPhone: "user_phone", installationAddress: "installation_address" })) {
        if (!String(previous[field] || "").trim() && String(item[dbField] || "").trim()) previous[field] = item[dbField];
      }
      previousByLoid.set(loid, previous);
    }
    const preservedFields = ["gridRank", "mac", "pon", "ponType", "deviceType", "username", "userPhone", "installationAddress"];
    mutationRows = orderedRows.map((row) => {
      if (row?.operation === "cancel") return row;
      const loid = String(row?.loid || "").trim().toUpperCase();
      const previous = previousByLoid.get(loid) || {};
      const enriched = { ...row };
      for (const field of preservedFields) if (!String(enriched[field] || "").trim() && String(previous[field] || "").trim()) enriched[field] = previous[field];
      previousByLoid.set(loid, { ...previous, ...Object.fromEntries(preservedFields.map((field) => [field, enriched[field]])) });
      return enriched;
    });
    for (const row of orderedRows) {
      const loid = String(row?.loid || "").trim().toUpperCase();
      const receivedAt = String(row?.receivedAt || "").trim();
      const existing = historical.filter((item) => String(item.loid || "").trim().toUpperCase() === loid && item.received_at === receivedAt);
      const key = String(row?.idempotencyKey || "").trim();
      if (existing.some((item) => item.event_key !== key)) {
        const error = new Error("BOSS 历史事件存在同一 LOID 和接收时间的不同工单，已拒绝提交。");
        error.status = 409;
        throw error;
      }
      const same = existing.find((item) => item.event_key === key);
      if (same && same.operation !== row.operation) {
        const error = new Error("BOSS 同一幂等键对应的业务操作类型发生冲突，已拒绝提交。");
        error.status = 409;
        throw error;
      }
    }
    for (const loid of identities) {
      const duplicateCoordinates = new Set([...currentResource, ...currentNmse]
        .filter((row) => String(row.loid || "").trim().toUpperCase() === loid)
        .map((row) => `${String(row.olt_ip || "").trim()}|${String(row.onu_index || "").trim()}`)
        .filter((coordinate) => coordinate !== "|"));
      if (duplicateCoordinates.size > 1) {
        const error = new Error("BOSS 现有 LOID 对应多个旧快照，无法安全判断迁移目标，已拒绝提交。");
        error.status = 409;
        throw error;
      }
    }
  }
  const coordinates = effectiveRowsForConflict.filter((row) => row?.operation !== "cancel" && row?.oltIp && row?.onuIndex);
  if (coordinates.length) {
    const keys = coordinates.map((row) => `(${sqlQuote(row.oltIp)}, ${sqlQuote(row.onuIndex)})`).join(", ");
    const conflicts = await query(`SELECT olt_ip, onu_index, loid FROM resource_user_snapshots WHERE (olt_ip, onu_index) IN (${keys})
UNION ALL
SELECT olt_ip, onu_index_display AS onu_index, loid FROM merged_onu_nmse_snapshots WHERE (olt_ip, onu_index_display) IN (${keys});`);
    const incoming = new Map();
    const incomingRows = new Map();
    const releasedLoids = new Set(effectiveRowsForConflict.map((row) => String(row?.loid || "").trim().toUpperCase()).filter(Boolean));
    const existingByCoordinate = new Map();
    for (const row of conflicts) {
      const coordinate = `${row.olt_ip}|${row.onu_index}`;
      const loid = String(row.loid || "").trim().toUpperCase();
      if (!loid) continue;
      if (existingByCoordinate.has(coordinate) && existingByCoordinate.get(coordinate) !== loid) {
        const error = new Error("BOSS 现有快照将同一坐标分配给多个 LOID，已拒绝提交。");
        error.status = 409;
        throw error;
      }
      existingByCoordinate.set(coordinate, loid);
    }
    const occupancy = new Map([...existingByCoordinate.entries()].filter(([, loid]) => !releasedLoids.has(loid)));
    for (const row of coordinates) {
      const coordinate = `${row.oltIp}|${row.onuIndex}`;
      const wanted = String(row.loid).trim().toUpperCase();
      if (incoming.has(coordinate) && incoming.get(coordinate) !== wanted) {
        const prior = incomingRows.get(coordinate);
        const isSameCustomer = Boolean(
          (prior?.username && row.username && String(prior.username).trim() === String(row.username).trim()) ||
          (prior?.userPhone && row.userPhone && String(prior.userPhone).trim() === String(row.userPhone).trim())
        );
        const isLater = wallMs(row.receivedAt) > wallMs(prior?.receivedAt);
        if (isSameCustomer && isLater) {
          incoming.set(coordinate, wanted);
          incomingRows.set(coordinate, row);
          continue;
        }
        const error = new Error("BOSS 同批最终状态将同一坐标分配给多个 LOID，已拒绝提交。");
        error.status = 409;
        throw error;
      }
      incoming.set(coordinate, wanted);
      incomingRows.set(coordinate, row);
      occupancy.set(coordinate, wanted);
    }
  }
  const inserts = [];
  const nameUpserts = [];
  const mutations = [];
  for (const row of orderedRows) {
    const key = String(row.idempotencyKey || `${row.workOrder || ""}|${row.loid || ""}|${row.receivedAt || ""}`).trim();
    const rowLoid = String(row.loid || "").trim().toUpperCase();
    if (!key) throw new Error("BOSS 增量记录缺少幂等键。");
    if (!["install", "move", "replace", "cancel"].includes(row.operation)) throw new Error("BOSS 增量记录操作类型无效。");
    inserts.push(`INSERT OR IGNORE INTO nmse_boss_change_events
(event_key, work_order, loid, operation, received_at, olt_ip, onu_index, username, user_phone, installation_address, mac, pon, pon_type, device_type)
VALUES (${[key, row.workOrder, row.loid, row.operation, row.receivedAt, row.oltIp, row.onuIndex, row.username, row.userPhone, row.installationAddress, row.mac, row.pon, row.ponType, row.deviceType].map(sqlQuote).join(", ")});
INSERT OR IGNORE INTO temp_nmse_boss_new_events (event_key) SELECT ${sqlQuote(key)} WHERE changes() = 1;`);
    if (rowLoid && String(row.username || "").trim()) {
      nameUpserts.push(`INSERT INTO nmse_boss_name_snapshots (loid, username, work_order, received_at)
VALUES (${[rowLoid, row.username, row.workOrder || "", row.receivedAt].map(sqlQuote).join(", ")})
ON CONFLICT(loid) DO UPDATE SET
  username = CASE
    WHEN length(trim(excluded.username)) >= 2 OR length(trim(nmse_boss_name_snapshots.username)) <= 1
    THEN excluded.username
    ELSE nmse_boss_name_snapshots.username
  END,
  work_order = CASE
    WHEN length(trim(excluded.username)) >= 2 OR length(trim(nmse_boss_name_snapshots.username)) <= 1
    THEN excluded.work_order
    ELSE nmse_boss_name_snapshots.work_order
  END,
  received_at = excluded.received_at,
  synced_at = CURRENT_TIMESTAMP
WHERE excluded.received_at >= nmse_boss_name_snapshots.received_at;`);
    }
    const mutationRow = mutationRows[orderedRows.indexOf(row)] || row;
    const loid = String(mutationRow.loid || "").trim().toUpperCase();
    if (!loid) continue;
    if (mutationRow.operation === "cancel") {
      mutations.push(`DELETE FROM resource_user_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)} AND EXISTS (SELECT 1 FROM temp_nmse_boss_new_events WHERE event_key = ${sqlQuote(key)}) AND NOT EXISTS (SELECT 1 FROM nmse_boss_change_events newer WHERE upper(trim(newer.loid)) = ${sqlQuote(loid)} AND newer.received_at > ${sqlQuote(row.receivedAt)});`);
      mutations.push(`DELETE FROM merged_onu_nmse_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)} AND EXISTS (SELECT 1 FROM temp_nmse_boss_new_events WHERE event_key = ${sqlQuote(key)}) AND NOT EXISTS (SELECT 1 FROM nmse_boss_change_events newer WHERE upper(trim(newer.loid)) = ${sqlQuote(loid)} AND newer.received_at > ${sqlQuote(row.receivedAt)});`);
      continue;
    }
    if (!String(mutationRow.onuIndex || "").trim() || !String(mutationRow.oltIp || "").trim()) continue;
    mutations.push(`DELETE FROM resource_user_snapshots WHERE (upper(trim(loid)) = ${sqlQuote(loid)} OR (olt_ip = ${sqlQuote(mutationRow.oltIp)} AND onu_index = ${sqlQuote(mutationRow.onuIndex)})) AND EXISTS (SELECT 1 FROM temp_nmse_boss_new_events WHERE event_key = ${sqlQuote(key)}) AND NOT EXISTS (SELECT 1 FROM nmse_boss_change_events newer WHERE upper(trim(newer.loid)) = ${sqlQuote(loid)} AND newer.received_at > ${sqlQuote(row.receivedAt)});`);
    mutations.push(`INSERT INTO resource_user_snapshots
(olt_ip, grid_rank, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
SELECT ${[mutationRow.oltIp, mutationRow.gridRank || "", mutationRow.onuIndex, loid, mutationRow.mac, mutationRow.pon, mutationRow.ponType, mutationRow.deviceType, mutationRow.username, mutationRow.userPhone, mutationRow.installationAddress].map(sqlQuote).join(", ")}
WHERE EXISTS (SELECT 1 FROM temp_nmse_boss_new_events WHERE event_key = ${sqlQuote(key)}) AND NOT EXISTS (SELECT 1 FROM nmse_boss_change_events newer WHERE upper(trim(newer.loid)) = ${sqlQuote(loid)} AND newer.received_at > ${sqlQuote(row.receivedAt)})
ON CONFLICT(olt_ip, onu_index) DO UPDATE SET loid=excluded.loid, grid_rank=excluded.grid_rank, mac=excluded.mac, pon=excluded.pon, pon_type=excluded.pon_type, device_type=excluded.device_type, username=excluded.username, user_phone=excluded.user_phone, installation_address=excluded.installation_address, synced_at=CURRENT_TIMESTAMP;`);
    mutations.push(`DELETE FROM merged_onu_nmse_snapshots WHERE (upper(trim(loid)) = ${sqlQuote(loid)} OR (olt_ip = ${sqlQuote(mutationRow.oltIp)} AND onu_index_display = ${sqlQuote(mutationRow.onuIndex)})) AND EXISTS (SELECT 1 FROM temp_nmse_boss_new_events WHERE event_key = ${sqlQuote(key)}) AND NOT EXISTS (SELECT 1 FROM nmse_boss_change_events newer WHERE upper(trim(newer.loid)) = ${sqlQuote(loid)} AND newer.received_at > ${sqlQuote(row.receivedAt)});`);
    mutations.push(`INSERT INTO merged_onu_nmse_snapshots (olt_ip, onu_index_display, loid, loid_display, mac, pon, pon_type, device_type, username, user_phone, installation_address)
SELECT ${[mutationRow.oltIp, mutationRow.onuIndex, loid, loid, mutationRow.mac, mutationRow.pon, mutationRow.ponType, mutationRow.deviceType, mutationRow.username, mutationRow.userPhone, mutationRow.installationAddress].map(sqlQuote).join(", ")}
WHERE EXISTS (SELECT 1 FROM temp_nmse_boss_new_events WHERE event_key = ${sqlQuote(key)}) AND NOT EXISTS (SELECT 1 FROM nmse_boss_change_events newer WHERE upper(trim(newer.loid)) = ${sqlQuote(loid)} AND newer.received_at > ${sqlQuote(row.receivedAt)});`);
  }
  const sourceRevision = manifestContext ? randomUUID().replace(/-/g, "") : "";
  const sourceManifest = manifestContext ? createSourceManifest({
    source: "nmse", sourceKind: "nmse-boss-incremental-overlay",
    scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" },
    collectionStartedAt: manifestContext.startedAt, collectionCompletedAt: manifestContext.completedAt || new Date().toISOString(),
    windowStart: manifestContext.windowStart || windowStart, windowEnd: manifestContext.windowEnd || windowEnd,
    sourceRevision: `source:${sourceRevision}`, targetOltIds: manifestContext.targetOltIds || [...new Set(orderedRows.map((row) => row.oltIp).filter(Boolean))],
    rowCount: orderedRows.length, status: "complete", runId: manifestContext.runId, idempotencyKey: "",
    exclusiveWatermark: manifestContext.windowEnd || windowEnd,
    coverageThrough: manifestContext.coverageThrough || effectiveCoverageThrough || null,
    checkpoint: { status: "complete", cursor: null, updatedAt: manifestContext.completedAt || new Date().toISOString() }
  }) : null;
  // Keep the complete event/snapshot/watermark/manifest update atomic. The
  // sqlite CLI otherwise continues after a statement error and could reach
  // COMMIT with only part of the batch applied.
  await exec(`.bail on
BEGIN IMMEDIATE;
CREATE TEMP TABLE IF NOT EXISTS temp_nmse_boss_new_events (event_key TEXT PRIMARY KEY);
DELETE FROM temp_nmse_boss_new_events;
${inserts.join("\n")}
${nameUpserts.join("\n")}
${mutations.join("\n")}
UPDATE nmse_boss_sync_state SET watermark=${sqlQuote(watermark)}, last_window_start=${sqlQuote(windowStart)}, last_window_end=${sqlQuote(windowEnd)}, coverage_through=COALESCE(NULLIF(${sqlQuote(effectiveCoverageThrough)}, ''), coverage_through), updated_at=CURRENT_TIMESTAMP WHERE id=1;
UPDATE nmse_boss_sync_state SET name_history_count=(SELECT count(*) FROM nmse_boss_name_snapshots) WHERE id=1 AND name_history_completed_at<>'';
UPDATE merged_onu_source_state SET nmse_revision=${sourceRevision ? sqlQuote(sourceRevision) : "lower(hex(randomblob(16)))"}, nmse_count=${NMSE_EFFECTIVE_SOURCE_COUNT_SQL}, nmse_updated_at=CURRENT_TIMESTAMP WHERE id=1;
UPDATE resource_user_dataset_state SET revision=lower(hex(randomblob(16))), updated_at=CURRENT_TIMESTAMP WHERE id=1;
${sourceManifest ? `INSERT INTO merged_onu_sync_manifests
(run_id, manifest_type, source, idempotency_key, manifest_json, source_revision_json, target_olt_ids_json, window_start, window_end, row_count, status)
VALUES (${[manifestContext.runId, "source", "nmse", sourceManifest.idempotencyKey || "", `json_set(${sqlQuote(serializeManifest(sourceManifest))}, '$.rowCount', ${NMSE_EFFECTIVE_SOURCE_COUNT_SQL})`, JSON.stringify(sourceManifest.sourceRevision), JSON.stringify(sourceManifest.targetOltIds), sourceManifest.windowStart, sourceManifest.windowEnd, NMSE_EFFECTIVE_SOURCE_COUNT_SQL, sourceManifest.status].map((value, index) => index === 4 || index === 9 ? String(value) : sqlQuote(value)).join(", ")})
ON CONFLICT(run_id, manifest_type, source) DO UPDATE SET manifest_json=excluded.manifest_json, source_revision_json=excluded.source_revision_json, target_olt_ids_json=excluded.target_olt_ids_json, window_start=excluded.window_start, window_end=excluded.window_end, row_count=excluded.row_count, status=excluded.status, updated_at=CURRENT_TIMESTAMP;` : ""}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_nmse_boss_incremental', 'nmse-boss', ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  let persistedManifest = sourceManifest;
  if (sourceManifest) {
    const loaded = await getMergedOnuSyncManifest({ runId: manifestContext.runId, manifestType: "source", source: "nmse" });
    if (loaded) {
      const { persistedAt, ...manifest } = loaded;
      persistedManifest = manifest;
    }
  }
  return { count: rows.length, watermark: String(watermark), windowStart: String(windowStart || ""), windowEnd: String(windowEnd || ""), coverageThrough: effectiveCoverageThrough, source: { revision: sourceRevision ? `source:${sourceRevision}` : "" }, manifest: persistedManifest };
}

export async function recordMergedOnuSourceSyncSuccess({
  runId,
  operation,
  networkCount = 0,
  nmseCount = 0,
  backup = null,
  startedAt = "",
  completedAt = "",
  summary = null
} = {}) {
  const id = String(runId || "").trim();
  const sourceOperation = String(operation || "").trim();
  if (!id || !["network", "nmse"].includes(sourceOperation)) throw new Error("合并 ONU 源同步运行参数无效。");
  const output = await runSql(`.bail on
BEGIN IMMEDIATE;
INSERT INTO merged_onu_sync_runs
(id, operation, status, network_count, nmse_count, merged_count, conflict_count, backup_path, backup_bytes, backup_sha256, error, started_at, completed_at, summary_json)
VALUES (${[
    id, sourceOperation, "success", Number(networkCount) || 0, Number(nmseCount) || 0, 0, 0,
    backup?.path || "", Number(backup?.bytes || 0), backup?.sha256 || "", "",
    startedAt || new Date().toISOString(), completedAt || new Date().toISOString(), serializeRunSummary(summary)
  ].map(sqlQuote).join(", ")})
ON CONFLICT(id) DO UPDATE SET
  network_count=excluded.network_count, nmse_count=excluded.nmse_count,
  backup_path=excluded.backup_path, backup_bytes=excluded.backup_bytes, backup_sha256=excluded.backup_sha256,
  error=excluded.error, started_at=excluded.started_at, completed_at=excluded.completed_at, summary_json=excluded.summary_json
WHERE merged_onu_sync_runs.operation=excluded.operation AND merged_onu_sync_runs.status=excluded.status;
SELECT changes() AS persisted,
       operation AS existing_operation,
       status AS existing_status
FROM merged_onu_sync_runs WHERE id=${sqlQuote(id)};
COMMIT;`, { json: true });
  const [persisted] = JSON.parse(output || "[]");
  if (Number(persisted?.persisted || 0) !== 1) {
    throw new Error(`合并 ONU 源同步运行 ${id} 已存在不兼容的审计记录（${persisted?.existing_operation || "unknown"}/${persisted?.existing_status || "unknown"}）。`);
  }
  return { runId: id, operation: sourceOperation, status: "success" };
}

export async function getMergedOnuSnapshots({ oltIp = "" } = {}) {
  const host = String(oltIp || "").trim();
  const rows = await query(`SELECT * FROM merged_onu_snapshots${host ? ` WHERE olt_ip = ${sqlQuote(host)}` : ""}
ORDER BY olt_ip, CAST(chassis AS INTEGER), CAST(board AS INTEGER), CAST(pon AS INTEGER), CAST(onu_id AS INTEGER);`);
  return rows.map(mapMergedOnuSnapshot);
}

/** 合并台账中出现过的 PON 口坐标（夜间光功率采集按口读取时与 PON 台账取并集）。 */
export async function getMergedOnuPonCoordinates() {
  const rows = await query("SELECT DISTINCT olt_ip, chassis, board, pon FROM merged_onu_snapshots;");
  return rows.map((row) => ({ oltIp: row.olt_ip, chassis: row.chassis, board: row.board, pon: row.pon }));
}

/** 区域字典统计只需要地址和坐标，避免读取整张合并快照的全部字段。 */
export async function getMergedOnuAddressIndex() {
  const rows = await query("SELECT olt_ip, chassis, board, pon, onu_id, installation_address FROM merged_onu_snapshots WHERE installation_address <> '';");
  return rows.map((row) => ({
    oltIp: row.olt_ip,
    onuIndex: `${row.chassis}/${row.board}/${row.pon}:${row.onu_id}`,
    installationAddress: row.installation_address
  }));
}

export async function getMergedOnuConflicts({ runId = "" } = {}) {
  const id = String(runId || "").trim();
  const rows = await query(`SELECT run_id, reason, olt_ip, onu_index_display, loid, detail, created_at
FROM merged_onu_conflicts${id ? ` WHERE run_id = ${sqlQuote(id)}` : ""} ORDER BY id;`);
  return rows.map((row) => ({
    runId: row.run_id,
    reason: row.reason,
    oltIp: row.olt_ip,
    onuIndexDisplay: row.onu_index_display || "",
    loid: row.loid || "",
    detail: row.detail || "",
    createdAt: row.created_at || ""
  }));
}

export async function getMergedOnuSyncRuns({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await query(`SELECT id, operation, status, network_count, nmse_count, merged_count, conflict_count,
backup_path, backup_bytes, backup_sha256, error, started_at, completed_at, summary_json
FROM merged_onu_sync_runs ORDER BY started_at DESC LIMIT ${safeLimit};`);
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation || "full",
    status: row.status,
    networkCount: Number(row.network_count || 0),
    nmseCount: Number(row.nmse_count || 0),
    mergedCount: Number(row.merged_count || 0),
    conflictCount: Number(row.conflict_count || 0),
    backupPath: row.backup_path || "",
    backupBytes: Number(row.backup_bytes || 0),
    backupSha256: row.backup_sha256 || "",
    error: row.error || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    summary: parseRunSummary(row.summary_json)
  }));
}

function recoveryNow(value = "") {
  const candidate = String(value || "").trim();
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : new Date().toISOString();
}

const RECOVERY_SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const RECOVERY_PHASES = new Set(["starting", "collecting", "merging", "persisting", "completed", "failed"]);

const RECOVERY_STATUSES = new Set(["running", "success", "failed", "cancelled"]);

function recoverySafeToken(value, label) {
  const token = String(value || "").trim();
  if (!token || !RECOVERY_SAFE_TOKEN.test(token)) throw new TypeError(`${label} 格式不安全。`);
  return token;
}

function recoveryOptionalSafeToken(value, label) {
  const token = String(value || "").trim();
  if (!token) return "";
  return recoverySafeToken(token, label);
}

function recoveryWorkerId(value) {
  return recoverySafeToken(value, "同步 workerId");
}

function recoveryCheckpoint(value = null) {
  const checkpoint = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = String(checkpoint.status || "not_started").trim();
  if (!["not_started", "running", "paused", "complete", "failed"].includes(status)) {
    throw new TypeError("同步 checkpoint 状态无效。");
  }
  const cursor = checkpoint.cursor === null || checkpoint.cursor === undefined || String(checkpoint.cursor).trim() === ""
    ? null
    : String(checkpoint.cursor).trim();
  if (cursor !== null && !RECOVERY_SAFE_TOKEN.test(cursor)) throw new TypeError("同步 checkpoint cursor 格式不安全。");
  const updatedAt = checkpoint.updatedAt ? recoveryNow(checkpoint.updatedAt) : null;
  return { status, cursor, updatedAt };
}

function recoveryLease(value, label = "leaseUntil") {
  const leaseUntil = String(value || "").trim();
  if (!leaseUntil) return "";
  if (Number.isNaN(Date.parse(leaseUntil))) throw new TypeError(`${label} 必须是有效时间。`);
  return leaseUntil;
}

function mapMergedOnuSyncRuntime(row) {
  if (!row) return null;
  let checkpoint = null;
  try { checkpoint = JSON.parse(row.checkpoint_json || "{}"); } catch { checkpoint = null; }
  return {
    runId: row.run_id,
    operation: row.operation,
    status: row.status,
    phase: row.phase,
    checkpoint,
    leaseUntil: row.lease_until || "",
    workerId: row.worker_id || "",
    idempotencyKey: row.idempotency_key || "",
    startedAt: row.started_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || "",
    error: row.error || ""
  };
}

async function readMergedOnuSyncRuntime(runId) {
  const [row] = await query(`SELECT * FROM merged_onu_sync_runtime WHERE run_id = ${sqlQuote(runId)};`);
  return mapMergedOnuSyncRuntime(row);
}

export async function beginMergedOnuSyncRun({
  runId,
  operation = "full",
  idempotencyKey = "",
  workerId,
  phase = "starting",
  startedAt = "",
  leaseMs = 30 * 60 * 1000
} = {}) {
  const id = recoverySafeToken(runId, "同步运行 ID");
  const key = recoveryOptionalSafeToken(idempotencyKey, "同步幂等 key");
  const worker = recoveryWorkerId(workerId);
  const now = recoveryNow(startedAt);
  const normalizedOperation = recoverySafeToken(operation, "同步 operation");
  const normalizedPhase = recoverySafeToken(phase, "同步 phase");
  const leaseUntil = new Date(Date.parse(now) + Math.max(1, Number(leaseMs) || 1)).toISOString();
  const sql = `.bail on
BEGIN IMMEDIATE;
INSERT OR IGNORE INTO merged_onu_sync_runtime
(run_id, operation, status, phase, checkpoint_json, lease_until, worker_id, idempotency_key, started_at, updated_at)
SELECT ${[id, normalizedOperation, "running", normalizedPhase, JSON.stringify(recoveryCheckpoint()), leaseUntil, worker, key, now, now].map(sqlQuote).join(", ")}
WHERE NOT EXISTS (
  SELECT 1 FROM merged_onu_sync_runtime
  WHERE status = 'running' AND lease_until <> '' AND lease_until > ${sqlQuote(now)}
);
SELECT changes() AS inserted,
       (SELECT run_id FROM merged_onu_sync_runtime
        WHERE run_id = ${sqlQuote(id)}
           OR (idempotency_key <> '' AND idempotency_key = ${sqlQuote(key)})
        ORDER BY CASE WHEN run_id = ${sqlQuote(id)} THEN 0 ELSE 1 END LIMIT 1) AS duplicate_run_id,
       (SELECT run_id FROM merged_onu_sync_runtime
        WHERE status = 'running' AND lease_until <> '' AND lease_until > ${sqlQuote(now)}
        ORDER BY updated_at DESC, run_id LIMIT 1) AS active_run_id;
COMMIT;`;
  const output = await runSql(sql, { json: true });
  const result = JSON.parse(output || "[]")[0] || {};
  const inserted = Number(result.inserted || 0) === 1;
  const duplicateRunId = String(result.duplicate_run_id || "");
  const activeRunId = String(result.active_run_id || "");
  const selectedRunId = inserted ? id : duplicateRunId || activeRunId || id;
  const runtime = await readMergedOnuSyncRuntime(selectedRunId);
  const reason = inserted
    ? null
    : duplicateRunId
      ? (duplicateRunId === id ? "duplicate_run_id" : "duplicate_idempotency_key")
      : activeRunId
        ? "active_lease"
        : "duplicate_run_id";
  return {
    accepted: inserted,
    duplicate: !inserted && Boolean(duplicateRunId),
    reason,
    run: runtime
  };
}

export async function claimMergedOnuSyncLease({ runId, workerId, leaseMs = 30 * 60 * 1000, now = "" } = {}) {
  const id = recoverySafeToken(runId, "同步运行 ID");
  const worker = recoveryWorkerId(workerId);
  const current = recoveryNow(now);
  const leaseUntil = new Date(Date.parse(current) + Math.max(1, Number(leaseMs) || 1)).toISOString();
  const output = await runSql(`.bail on
BEGIN IMMEDIATE;
UPDATE merged_onu_sync_runtime
SET worker_id = ${sqlQuote(worker)}, lease_until = ${sqlQuote(leaseUntil)}, updated_at = ${sqlQuote(current)}
WHERE run_id = ${sqlQuote(id)}
  AND status NOT IN ('success', 'failed', 'cancelled')
  AND (lease_until = '' OR lease_until <= ${sqlQuote(current)});
SELECT changes() AS claimed;
COMMIT;`, { json: true });
  const claimed = Number(JSON.parse(output || "[]")[0]?.claimed || 0) === 1;
  return { claimed, run: await readMergedOnuSyncRuntime(id) };
}

export async function renewMergedOnuSyncLease({ runId, workerId, leaseMs = 30 * 60 * 1000, now = "" } = {}) {
  const id = recoverySafeToken(runId, "同步运行 ID");
  const worker = recoveryWorkerId(workerId);
  const current = recoveryNow(now);
  const leaseUntil = new Date(Date.parse(current) + Math.max(1, Number(leaseMs) || 1)).toISOString();
  const output = await runSql(`.bail on
BEGIN IMMEDIATE;
UPDATE merged_onu_sync_runtime
SET lease_until = CASE WHEN lease_until < ${sqlQuote(leaseUntil)} THEN ${sqlQuote(leaseUntil)} ELSE lease_until END,
    updated_at = CASE WHEN updated_at < ${sqlQuote(current)} THEN ${sqlQuote(current)} ELSE updated_at END
WHERE run_id = ${sqlQuote(id)}
  AND worker_id = ${sqlQuote(worker)}
  AND status = 'running'
  AND lease_until <> ''
  AND lease_until > ${sqlQuote(current)};
SELECT changes() AS renewed;
COMMIT;`, { json: true });
  const renewed = Number(JSON.parse(output || "[]")[0]?.renewed || 0) === 1;
  return { renewed, run: await readMergedOnuSyncRuntime(id) };
}

export async function updateMergedOnuSyncRuntime({
  runId,
  workerId,
  status,
  phase,
  checkpoint = null,
  leaseUntil,
  error = "",
  now = ""
} = {}) {
  const id = recoverySafeToken(runId, "同步运行 ID");
  const worker = recoveryWorkerId(workerId);
  const current = recoveryNow(now);
  const normalizedCheckpoint = recoveryCheckpoint(checkpoint);
  const normalizedStatus = String(status || "").trim();
  if (!RECOVERY_STATUSES.has(normalizedStatus)) throw new TypeError("同步运行 status 无效。");
  const normalizedPhase = recoverySafeToken(phase, "同步 phase");
  const nextLease = leaseUntil === undefined ? null : recoveryLease(leaseUntil);
  const completedAt = ["success", "failed", "cancelled"].includes(normalizedStatus) ? current : "";
  const output = await runSql(`.bail on
BEGIN IMMEDIATE;
UPDATE merged_onu_sync_runtime
SET status = ${sqlQuote(normalizedStatus)}, phase = ${sqlQuote(normalizedPhase)}, checkpoint_json = ${sqlQuote(JSON.stringify(normalizedCheckpoint))},
    lease_until = COALESCE(${nextLease === null ? "NULL" : sqlQuote(nextLease)}, lease_until),
    updated_at = ${sqlQuote(current)}, completed_at = ${sqlQuote(completedAt)}, error = ${sqlQuote(String(error || "").slice(0, 240))}
WHERE run_id = ${sqlQuote(id)} AND worker_id = ${sqlQuote(worker)}
  AND (lease_until = '' OR lease_until > ${sqlQuote(current)});
SELECT changes() AS updated;
COMMIT;`, { json: true });
  const updated = Number(JSON.parse(output || "[]")[0]?.updated || 0) === 1;
  return { updated, run: await readMergedOnuSyncRuntime(id) };
}

export async function persistMergedOnuManifest({ runId, manifest } = {}) {
  const id = String(runId || manifest?.runId || "").trim();
  if (!id) throw new TypeError("manifest 运行 ID 不能为空。");
  const serialized = serializeManifest(manifest);
  const normalized = parseManifest(serialized);
  const source = String(normalized.source || "");
  const revision = normalized.sourceRevision;
  const targetOltIds = normalized.targetOltIds;
  await exec(`INSERT INTO merged_onu_sync_manifests
(run_id, manifest_type, source, idempotency_key, manifest_json, source_revision_json, target_olt_ids_json, window_start, window_end, row_count, status)
VALUES (${[
    id, normalized.manifestType, source, normalized.idempotencyKey || "", serialized,
    JSON.stringify(revision), JSON.stringify(targetOltIds), normalized.windowStart, normalized.windowEnd,
    Number(normalized.rowCount) || 0, normalized.status
  ].map(sqlQuote).join(", ")})
ON CONFLICT(run_id, manifest_type, source) DO UPDATE SET
  idempotency_key = excluded.idempotency_key, manifest_json = excluded.manifest_json,
  source_revision_json = excluded.source_revision_json, target_olt_ids_json = excluded.target_olt_ids_json,
  window_start = excluded.window_start, window_end = excluded.window_end, row_count = excluded.row_count,
  status = excluded.status, updated_at = CURRENT_TIMESTAMP;`);
  return normalized;
}

function mapMergedOnuManifestRow(row) {
  if (!row) return null;
  return { ...parseManifest(row.manifest_json), persistedAt: row.updated_at || row.created_at || "" };
}

export async function getMergedOnuSyncManifest({ runId = "", manifestType = "", source = "" } = {}) {
  const filters = [];
  if (runId) filters.push(`run_id = ${sqlQuote(runId)}`);
  if (manifestType) filters.push(`manifest_type = ${sqlQuote(manifestType)}`);
  if (source) filters.push(`source = ${sqlQuote(source)}`);
  const [row] = await query(`SELECT * FROM merged_onu_sync_manifests${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT 1;`);
  return mapMergedOnuManifestRow(row);
}

export async function getLatestMergedOnuSourceManifest(source) {
  return getMergedOnuSyncManifest({ manifestType: "source", source });
}

export async function listRecoverableMergedOnuSyncRuns() {
  const rows = await query(`SELECT * FROM merged_onu_sync_runtime
WHERE status NOT IN ('success', 'failed', 'cancelled') ORDER BY updated_at ASC;`);
  return rows.map(mapMergedOnuSyncRuntime);
}

export async function getMergedOnuDatasetRevision() {
  const [state] = await query("SELECT revision, updated_at FROM merged_onu_dataset_state WHERE id = 1;");
  const revision = String(state?.revision || "").trim();
  if (!/^[a-f0-9]{32}$/.test(revision)) throw new Error("合并 ONU 数据集版本不可用。");
  return { revision: `dataset:${revision}`, updatedAt: state.updated_at || "" };
}

export async function getMergedOnuDatasetRevisionValue() {
  return (await getMergedOnuDatasetRevision()).revision;
}

export async function getMergedOnuDatasetStatus() {
  const [state] = await query("SELECT revision, updated_at FROM merged_onu_dataset_state WHERE id = 1;");
  const [snapshotCount] = await query("SELECT count(*) AS count FROM merged_onu_snapshots;");
  const [successfulRun] = await query("SELECT id, completed_at, conflict_count FROM merged_onu_sync_runs WHERE status = 'success' AND operation IN ('full', 'merge') ORDER BY completed_at DESC LIMIT 1;");
  const synced = Boolean(successfulRun);
  let lastConflictCount = Number(successfulRun?.conflict_count || 0);
  let lastArbitratedCount = 0;
  if (successfulRun?.id) {
    const [statsRow] = await query(`SELECT 
      count(*) AS total,
      sum(CASE WHEN detail LIKE '%自主裁决%' OR detail LIKE '%择优%' OR detail LIKE '%自动保留%' OR detail LIKE '%自动忽略%' THEN 1 ELSE 0 END) AS arbitrated,
      sum(CASE WHEN detail NOT LIKE '%自主裁决%' AND detail NOT LIKE '%择优%' AND detail NOT LIKE '%自动保留%' AND detail NOT LIKE '%自动忽略%' THEN 1 ELSE 0 END) AS unresolved
    FROM merged_onu_conflicts WHERE run_id = ${sqlQuote(successfulRun.id)};`);
    const total = Number(statsRow?.total || 0);
    const arbitrated = Number(statsRow?.arbitrated || 0);
    const unresolved = Number(statsRow?.unresolved || 0);
    if (total > 0) {
      lastArbitratedCount = arbitrated || total;
      lastConflictCount = unresolved;
    }
  }
  const [summaryRun] = await query("SELECT summary_json FROM merged_onu_sync_runs WHERE status = 'success' AND operation IN ('full', 'merge') ORDER BY completed_at DESC LIMIT 1;");
  const [networkRun] = await query("SELECT summary_json, completed_at FROM merged_onu_sync_runs WHERE status = 'success' AND operation IN ('full', 'network') ORDER BY completed_at DESC LIMIT 1;");
  const [latestRun] = await query("SELECT operation, status, error, completed_at FROM merged_onu_sync_runs ORDER BY completed_at DESC LIMIT 1;");
  return {
    synced,
    lastChangeSummary: parseRunSummary(summaryRun?.summary_json).changes || null,
    lastNetworkWarnings: parseRunSummary(networkRun?.summary_json).networkWarnings || [],
    latestRun: latestRun ? { operation: latestRun.operation, status: latestRun.status, error: latestRun.error || "", completedAt: latestRun.completed_at || "" } : null,
    revision: synced && state?.revision ? `dataset:${state.revision}` : "",
    updatedAt: synced ? state?.updated_at || "" : "",
    mergedAt: synced ? state?.updated_at || "" : "",
    snapshotCount: Number(snapshotCount?.count || 0),
    lastConflictCount,
    lastArbitratedCount,
    allConflictsResolved: lastConflictCount === 0,
    lastRunId: successfulRun?.id || "",
    lastCompletedAt: successfulRun?.completed_at || "",
    sources: await getMergedOnuSourceStatus()
  };
}

function mergedOnuKey(row) {
  return [row.oltIp, row.chassis, row.board, row.pon, row.onuId].map((value) => sqlQuote(value)).join(",");
}

export async function replaceMergedOnuDataset({
  runId,
  operation = "merge",
  rows = [],
  conflicts = [],
  networkCount = 0,
  nmseCount = 0,
  backup = null,
  startedAt = "",
  completedAt = "",
  summary = null
} = {}) {
  const id = String(runId || "").trim();
  if (!id) throw new Error("合并 ONU 同步运行 ID 不能为空。");
  const validRows = rows.filter((row) => row && row.persistable !== false);
  const invalidRows = validRows.filter((row) => [row.oltIp, row.chassis, row.board, row.pon, row.onuId].some((value) => !String(value ?? "").trim()));
  if (invalidRows.length) throw new Error("合并 ONU 数据包含缺少主键坐标的记录。");
  const values = (row) => [
    row.oltIp, row.chassis, row.board, row.pon, row.onuId, row.onuIndexDisplay,
    row.deviceName || "", row.deviceNumber || "", row.loid || "", row.loidDisplay || "", row.mac || "", row.serial || "", row.username || "",
    row.usernameSource, row.userPhone, row.installationAddress, row.deviceType,
    row.ponType, row.phase, row.rxPower, row.distance, row.nmseOltIp, row.nmseOnuIndex
  ].map(sqlQuote);
  const inserts = validRows.map((row) => `INSERT INTO merged_onu_snapshots
(olt_ip, chassis, board, pon, onu_id, onu_index_display, device_name, device_number, loid, loid_display, mac, serial, username, username_source, user_phone, installation_address, device_type, pon_type, phase, rx_power, distance, nmse_olt_ip, nmse_onu_index)
SELECT ${values(row).join(", ")} WHERE (SELECT inserted FROM temp_merged_onu_dataset_commit) = 1;`);
  const conflictInserts = conflicts.map((conflict) => `INSERT INTO merged_onu_conflicts
(run_id, reason, olt_ip, onu_index_display, loid, detail)
SELECT ${[
    id, conflict.reason, conflict.oltIp, conflict.onuIndexDisplay, conflict.loid, conflict.detail
  ].map(sqlQuote).join(", ")} WHERE (SELECT inserted FROM temp_merged_onu_dataset_commit) = 1;`);
  const backupPath = backup?.path || "";
  const backupBytes = Number(backup?.bytes || 0);
  const backupSha256 = backup?.sha256 || "";
  const normalizedNetworkCount = Number(networkCount) || 0;
  const normalizedNmseCount = Number(nmseCount) || 0;
  const normalizedStartedAt = startedAt || new Date().toISOString();
  const normalizedCompletedAt = completedAt || new Date().toISOString();
  const unresolvedConflictsCount = (conflicts || []).filter((c) => !c.resolved).length;
  const output = await runSql(`.bail on
BEGIN IMMEDIATE;
CREATE TEMP TABLE IF NOT EXISTS temp_merged_onu_dataset_commit (inserted INTEGER NOT NULL);
DELETE FROM temp_merged_onu_dataset_commit;
INSERT OR IGNORE INTO merged_onu_sync_runs
(id, operation, status, network_count, nmse_count, merged_count, conflict_count, backup_path, backup_bytes, backup_sha256, error, started_at, completed_at, summary_json)
VALUES (${[
    id, operation, "success", normalizedNetworkCount, normalizedNmseCount, validRows.length, unresolvedConflictsCount,
    backupPath, backupBytes, backupSha256, "", normalizedStartedAt, normalizedCompletedAt, serializeRunSummary(summary)
  ].map(sqlQuote).join(", ")});
INSERT INTO temp_merged_onu_dataset_commit (inserted) VALUES (changes());
DELETE FROM merged_onu_snapshots WHERE (SELECT inserted FROM temp_merged_onu_dataset_commit) = 1;
${inserts.join("\n")}
${conflictInserts.join("\n")}
UPDATE merged_onu_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP
WHERE id = 1 AND (SELECT inserted FROM temp_merged_onu_dataset_commit) = 1;
SELECT (SELECT inserted FROM temp_merged_onu_dataset_commit) AS committed,
       runs.operation AS existing_operation, runs.status AS existing_status,
       runs.network_count AS existing_network_count, runs.nmse_count AS existing_nmse_count,
       runs.merged_count AS existing_merged_count, runs.conflict_count AS existing_conflict_count,
       state.revision AS dataset_revision, state.updated_at AS dataset_updated_at
FROM merged_onu_sync_runs AS runs CROSS JOIN merged_onu_dataset_state AS state
WHERE runs.id = ${sqlQuote(id)} AND state.id = 1;
COMMIT;`, { json: true });
  const [persisted] = JSON.parse(output || "[]");
  const compatibleReplay = persisted?.existing_operation === operation && persisted?.existing_status === "success" &&
    Number(persisted?.existing_network_count || 0) === normalizedNetworkCount &&
    Number(persisted?.existing_nmse_count || 0) === normalizedNmseCount &&
    Number(persisted?.existing_merged_count || 0) === validRows.length &&
    Number(persisted?.existing_conflict_count || 0) === conflicts.length;
  if (!persisted || (Number(persisted.committed || 0) !== 1 && !compatibleReplay)) {
    throw new Error(`合并 ONU 同步运行 ${id} 已存在不兼容的数据集审计记录。`);
  }
  return {
    runId: id,
    mergedCount: validRows.length,
    conflictCount: conflicts.length,
    revision: `dataset:${persisted.dataset_revision}`,
    updatedAt: persisted.dataset_updated_at || ""
  };
}

export async function recordMergedOnuSyncFailure({
  runId,
  operation = "full",
  networkCount = 0,
  nmseCount = 0,
  backup = null,
  error = "合并 ONU 同步失败。",
  startedAt = "",
  completedAt = ""
} = {}) {
  const id = String(runId || "").trim();
  if (!id) throw new Error("合并 ONU 同步运行 ID 不能为空。");
  await exec(`INSERT INTO merged_onu_sync_runs
(id, operation, status, network_count, nmse_count, merged_count, conflict_count, backup_path, backup_bytes, backup_sha256, error, started_at, completed_at)
VALUES (${[
    id, operation, "failed", Number(networkCount) || 0, Number(nmseCount) || 0, 0, 0,
    backup?.path || "", Number(backup?.bytes || 0), backup?.sha256 || "", String(error || "").slice(0, 240),
    startedAt || new Date().toISOString(), completedAt || new Date().toISOString()
  ].map(sqlQuote).join(", ")});`);
  return { runId: id, status: "failed" };
}

/**
 * 在全量合并或同步前自动清理快照表中重复 LOID 的废弃历史旧坐标
 * 解决 BOSS 增量工单迁移时报“BOSS 现有 LOID 对应多个旧快照，无法安全判断迁移目标”的问题
 */
export async function cleanupDuplicateSnapshotCoordinates() {
  const duplicateRows = await query(`
    WITH all_snapshots AS (
      SELECT upper(trim(loid)) AS loid, trim(olt_ip) AS olt_ip, trim(onu_index) AS onu_index
      FROM resource_user_snapshots WHERE loid IS NOT NULL AND trim(loid) != ''
      UNION ALL
      SELECT upper(trim(loid)) AS loid, trim(olt_ip) AS olt_ip, trim(onu_index_display) AS onu_index
      FROM merged_onu_nmse_snapshots WHERE loid IS NOT NULL AND trim(loid) != ''
    ),
    coords AS (
      SELECT DISTINCT loid, olt_ip, onu_index FROM all_snapshots
    )
    SELECT loid
    FROM coords
    GROUP BY loid
    HAVING count(*) > 1;
  `);

  if (!duplicateRows.length) {
    return { cleanedCount: 0, cleanedLoids: [] };
  }

  const duplicateLoids = duplicateRows.map((r) => r.loid);
  let totalCleaned = 0;
  const cleanedLoids = [];

  const chunkSize = 50;
  for (let i = 0; i < duplicateLoids.length; i += chunkSize) {
    const chunk = duplicateLoids.slice(i, i + chunkSize);
    const quotedList = chunk.map(sqlQuote).join(", ");

    const activeRows = await query(`
      SELECT upper(trim(loid)) AS loid, trim(olt_ip) AS olt_ip, trim(onu_index_display) AS onu_index
      FROM merged_onu_snapshots
      WHERE upper(trim(loid)) IN (${quotedList}) AND loid != '';
    `);
    const activeMap = new Map();
    activeRows.forEach((r) => activeMap.set(r.loid, `${r.olt_ip}|${r.onu_index}`));

    const offlineLoids = chunk.filter((loid) => !activeMap.has(loid));
    const fallbackMap = new Map();
    if (offlineLoids.length) {
      const offlineQuoted = offlineLoids.map(sqlQuote).join(", ");
      const fallbackRows = await query(`
        SELECT upper(trim(loid)) AS loid, trim(olt_ip) AS olt_ip, trim(onu_index) AS onu_index, synced_at
        FROM (
          SELECT loid, olt_ip, onu_index, synced_at FROM resource_user_snapshots WHERE upper(trim(loid)) IN (${offlineQuoted})
          UNION ALL
          SELECT loid, olt_ip, onu_index_display AS onu_index, synced_at FROM merged_onu_nmse_snapshots WHERE upper(trim(loid)) IN (${offlineQuoted})
        )
        ORDER BY synced_at DESC;
      `);
      for (const r of fallbackRows) {
        if (!fallbackMap.has(r.loid)) {
          fallbackMap.set(r.loid, `${r.olt_ip}|${r.onu_index}`);
        }
      }
    }

    const statements = [];

    for (const loid of chunk) {
      const targetCoordinate = activeMap.get(loid) || fallbackMap.get(loid);

      if (targetCoordinate) {
        const [targetIp, targetIndex] = targetCoordinate.split("|");
        statements.push(`DELETE FROM resource_user_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)} AND (olt_ip != ${sqlQuote(targetIp)} OR onu_index != ${sqlQuote(targetIndex)});`);
        statements.push(`DELETE FROM merged_onu_nmse_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)} AND (olt_ip != ${sqlQuote(targetIp)} OR onu_index_display != ${sqlQuote(targetIndex)});`);
        statements.push(`DELETE FROM resource_user_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)} AND rowid NOT IN (SELECT max(rowid) FROM resource_user_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)});`);
        statements.push(`DELETE FROM merged_onu_nmse_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)} AND rowid NOT IN (SELECT max(rowid) FROM merged_onu_nmse_snapshots WHERE upper(trim(loid)) = ${sqlQuote(loid)});`);
        cleanedLoids.push(loid);
      }
    }

    if (statements.length) {
      await exec(`.bail on
BEGIN IMMEDIATE;
${statements.join("\n")}
COMMIT;`);
      totalCleaned += chunk.length;
    }
  }

  if (totalCleaned > 0) {
    await exec(`INSERT INTO admin_events (action, source, detail) VALUES ('cleanup_duplicate_snapshots', 'system', ${sqlQuote(`清理了 ${totalCleaned} 个重复 LOID 的废弃旧快照坐标`)});`);
  }

  return { cleanedCount: totalCleaned, cleanedLoids };
}
