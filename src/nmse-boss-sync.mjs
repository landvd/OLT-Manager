const SUCCESS_VALUES = new Set(["成功", "已完成", "完成", "success", "succeeded", "completed", "1", "2"]);
const OPERATION_ALIASES = new Map([
  ["报装", "install"], ["装机", "install"], ["installation", "install"], ["install", "install"],
  ["移机", "move"], ["迁移", "move"], ["move", "move"],
  ["更换onu", "replace"], ["更换ont", "replace"], ["更换", "replace"], ["replace", "replace"],
  ["销户", "cancel"], ["注销", "cancel"], ["cancel", "cancel"]
]);

function text(value) { return String(value ?? "").trim(); }
function parseBossParts(value) {
  const source = text(value);
  const local = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(source);
  if (!local) return null;
  const parts = { year: Number(local[1]), month: Number(local[2]), day: Number(local[3]), hour: Number(local[4] || 0), minute: Number(local[5] || 0), second: Number(local[6] || 0) };
  if (parts.month < 1 || parts.month > 12 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) throw new TypeError("BOSS 接收时间无效。");
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) throw new TypeError("BOSS 接收时间无效。");
  return parts;
}

export function canonicalizeBossWallDate(value) {
  const source = text(value);
  if (!source) return "";
  const local = parseBossParts(source);
  if (local) return `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:${String(local.second).padStart(2, "0")}`;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) throw new TypeError("BOSS 接收时间无效。");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return `${String(values.year).padStart(4, "0")}-${String(values.month).padStart(2, "0")}-${String(values.day).padStart(2, "0")} ${String(values.hour).padStart(2, "0")}:${String(values.minute).padStart(2, "0")}:${String(values.second).padStart(2, "0")}`;
}

function parseBossWallDate(value) {
  const canonical = canonicalizeBossWallDate(value);
  return canonical ? Date.parse(`${canonical.replace(" ", "T")}+08:00`) : NaN;
}

function first(row, fields) {
  for (const field of fields) {
    const value = text(row?.[field]);
    if (value) return value;
  }
  return "";
}

const BOSS_TIME_ZONE = "Asia/Shanghai";
function calendarDate(value) {
  if (typeof value === "string") {
    const canonical = canonicalizeBossWallDate(value);
    if (canonical) return { y: Number(canonical.slice(0, 4)), m: Number(canonical.slice(5, 7)), d: Number(canonical.slice(8, 10)) };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("BOSS 时间无效。");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BOSS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type === "year" ? "y" : part.type === "month" ? "m" : "d", Number(part.value)]));
}
function dateAtUtc({ y, m, d }) { return new Date(Date.UTC(y, m - 1, d)); }
function localSqlDate(date) { return `${date.toISOString().slice(0, 10)} 00:00:00`; }

/** D 日只接收至 D-1 00:00（覆盖 D-2 日），查询起点与上次水位重叠一天。 */
export function computeBossIncrementalWindow({ watermark = "", now = new Date(), overlapDays = 1 } = {}) {
  if (!text(watermark)) throw new TypeError("BOSS 增量同步缺少已确认水位，拒绝扩大查询范围。");
  const end = dateAtUtc(calendarDate(now));
  end.setUTCDate(end.getUTCDate() - 1);
  const overlap = Math.max(0, Number(overlapDays) || 0);
  if (parseBossWallDate(watermark) > end.getTime()) throw new TypeError("BOSS 水位晚于可同步范围，拒绝扩大查询范围。");
  const start = dateAtUtc(calendarDate(watermark));
  start.setUTCDate(start.getUTCDate() - overlap);
  if (start > end) start.setTime(end.getTime());
  return { start: localSqlDate(start), end: localSqlDate(end), eligibleEnd: localSqlDate(end), overlapDays: overlap };
}

/** Return the preceding Shanghai calendar date for a local/instant timestamp. */
export function previousShanghaiCalendarDate(value) {
  const date = dateAtUtc(calendarDate(value));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isBossSuccessStatus(value) {
  return SUCCESS_VALUES.has(text(value).toLowerCase());
}

export function normalizeBossOperation(value) {
  const normalized = text(value).toLowerCase().replace(/[\s_-]+/g, "");
  return OPERATION_ALIASES.get(normalized) || OPERATION_ALIASES.get(text(value)) || "unknown";
}

export function normalizeBossChange(row = {}) {
  const operation = normalizeBossOperation(first(row, ["operation", "operationType", "operateType", "serviceName", "bossServiceName", "操作类型", "业务类型"]));
  const receivedAt = canonicalizeBossWallDate(first(row, ["receivedAt", "receiveTime", "acceptTime", "recTime", "createTime", "接收时间", "受理时间"]));
  const workOrder = first(row, ["workOrder", "workOrderNo", "orderNo", "serialNo", "工单号", "工单编号"]);
  const loid = first(row, ["loid", "LOID", "loginName", "账号", "逻辑ID"]).replace(/\s+/g, "").toUpperCase();
  return {
    operation,
    workOrder,
    loid,
    receivedAt,
    idempotencyKey: `${workOrder}|${loid}|${receivedAt}`,
    success: isBossSuccessStatus(first(row, ["processStatus", "handleStatus", "dealStatus", "opResult", "status", "处理状态"])),
    oltIp: first(row, ["oltIp", "oltIP", "ipAddress", "OLT_IP"]),
    gridRank: first(row, ["gridRank", "grid_rank", "GRID_RANK"]),
    onuIndex: first(row, ["onuIndex", "onu_index", "ONU_INDEX", "ONU索引"]) || ([row.shelfNo, row.slotNo, row.ponNo, row.onuNo].every((value) => text(value)) ? `${row.shelfNo}/${row.slotNo}/${row.ponNo}:${row.onuNo}` : ""),
    username: first(row, ["username", "userName", "customerName", "CUSTNAME", "姓名"]),
    userPhone: first(row, ["userPhone", "phone", "mobile", "usertel", "MOBILE", "电话"]),
    installationAddress: first(row, ["installationAddress", "address", "useraddr", "WHLADDR", "装机地址"]),
    mac: first(row, ["mac", "macId", "MAC", "MAC地址"]),
    pon: first(row, ["pon", "ponNo", "PON", "PON口"]),
    ponType: first(row, ["ponType", "pon_type", "PON类型"]),
    deviceType: first(row, ["deviceType", "device_type", "设备类型"]),
    rawOperation: first(row, ["operation", "operationType", "operateType", "serviceName", "bossServiceName", "操作类型", "业务类型"])
  };
}

export function filterBossChanges(rows = [], { content = "厚街镇", window } = {}) {
  const start = window?.start ? parseBossWallDate(window.start) : -Infinity;
  const end = window?.end ? parseBossWallDate(window.end) : Infinity;
  return rows.map((input, index) => {
    const row = normalizeBossChange(input);
    const address = text(row.installationAddress);
    const time = parseBossWallDate(row.receivedAt);
    if (!row.success || row.operation === "unknown" || !row.workOrder || !row.loid || !row.receivedAt || Number.isNaN(time)) {
      throw new TypeError(`BOSS第 ${index + 1} 条记录缺少成功状态、支持的操作或幂等字段，已拒绝推进水位。`);
    }
    // NMSE 服务端已通过 queryStr（如"厚街镇"）完成业务范围筛选。
    // 真实业务中，厚街分局受理的网格业务可能覆盖临近楼盘或地址中未显式包含镇名，
    // 因此不以地址文本强行阻断整批同步推进。
    if (time < start || time >= end) throw new TypeError(`BOSS第 ${index + 1} 条记录超出已请求时间窗，已拒绝推进水位。`);
    if (row.operation !== "cancel" && (!row.oltIp || !row.onuIndex)) throw new TypeError(`BOSS第 ${index + 1} 条记录缺少 ONU 坐标，已拒绝推进水位。`);
    return row;
  });
}

export function deduplicateBossChanges(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.idempotencyKey || `${row.workOrder}|${row.loid}|${row.receivedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pure projection used by tests and by callers that need a preview before DB commit. */
export function applyBossChangesToRows(snapshotRows = [], changes = []) {
  const rows = new Map(snapshotRows.map((row) => [`${text(row.oltIp)}|${text(row.onuIndex)}`, { ...row }]));
  const normalizedChanges = changes.map((change) => change?.success === undefined ? normalizeBossChange(change) : change);
  for (const change of deduplicateBossChanges(normalizedChanges)) {
    if (!change.success || !["install", "move", "replace", "cancel"].includes(change.operation)) continue;
    const loid = text(change.loid).toUpperCase();
    const existing = [...rows.entries()].find(([, row]) => text(row.loid).toUpperCase() === loid);
    if (existing?.[1]?.bossReceivedAt && parseBossWallDate(change.receivedAt) <= parseBossWallDate(existing[1].bossReceivedAt)) continue;
    if (change.operation === "cancel") {
      if (existing) rows.delete(existing[0]);
      continue;
    }
    if (!text(change.oltIp) || !text(change.onuIndex) || !loid) continue;
    if (existing && existing[0] !== `${change.oltIp}|${change.onuIndex}`) rows.delete(existing[0]);
    const key = `${change.oltIp}|${change.onuIndex}`;
    rows.set(key, { ...(existing?.[1] || {}), ...change, loid, bossReceivedAt: change.receivedAt });
  }
  return [...rows.values()];
}

export const BOSS_READ_ONLY_QUERY = Object.freeze({ processStatus: "成功", operationStatus: "全部", content: "厚街镇" });

export function buildBossQuery({ window, content = BOSS_READ_ONLY_QUERY.content } = {}) {
  if (!window?.start || !window?.end) throw new TypeError("BOSS 增量查询需要完整时间窗口。");
  return { processStatus: BOSS_READ_ONLY_QUERY.processStatus, operationStatus: BOSS_READ_ONLY_QUERY.operationStatus, content, startTime: window.start, endTime: window.end };
}
