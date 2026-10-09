// 夜间光功率基线与断纤前后逐户对比（纯函数，无 IO）。
// 基线取“断纤前”最近 7 个夜间采样的中位数：若某晚整口离线，视为断纤当晚，只取那晚之前的采样。

export const REPAIR_DEGRADED_DB = 2;
export const REPAIR_SLIGHT_DB = 1;
export const BASELINE_NIGHTS = 7;
export const BASELINE_RETENTION_DAYS = 30;
const OUTAGE_NIGHT_RATIO = 0.8;
const TRUNK_PATTERN_RATIO = 0.6;

const ONLINE_PHASES = new Set(["online", "working", "active", "up", "ready", "在线", "工作中", "就绪"]);
const OFFLINE_PHASES = new Set(["offline", "los", "losi", "dyinggasp", "authfailed", "down", "离线", "光路中断", "掉电"]);

export function isOnlinePhase(value) {
  return ONLINE_PHASES.has(String(value ?? "").trim().toLowerCase());
}

export function isOfflinePhase(value) {
  return OFFLINE_PHASES.has(String(value ?? "").trim().toLowerCase());
}

/** 解析 ONU 收光功率（dBm）；无效值、65535 哨兵和不合理范围返回 null。 */
export function parseRxDbm(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > -60 && value < 10 ? value : null;
  const raw = String(value).trim();
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*dBm)?$/iu.test(raw)) return null;
  const number = Number(raw.replace(/\s*dBm$/iu, ""));
  return Number.isFinite(number) && number > -60 && number < 10 ? number : null;
}

/** 本机时区的日历日期 YYYY-MM-DD，作为夜间采样的归属日期。 */
export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shiftDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** 把一次整台 OLT 的只读结果整理成夜间采样行（只保留坐标、状态和收光）。 */
export function nightlySampleRows(rows = []) {
  const seen = new Set();
  const samples = [];
  for (const row of rows) {
    const chassis = String(row?.chassis ?? "").trim();
    const board = String(row?.board ?? row?.slot ?? "").trim();
    const pon = String(row?.pon ?? "").trim();
    const onuId = String(row?.onuId ?? "").trim();
    if (!chassis || !board || !pon || !onuId) continue;
    const key = `${chassis}/${board}/${pon}:${onuId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const online = isOnlinePhase(row.phase);
    samples.push({
      chassis,
      board,
      pon,
      onuId,
      phase: online ? "online" : isOfflinePhase(row.phase) ? "offline" : "unknown",
      rxDbm: online ? parseRxDbm(row.rxPower) : null
    });
  }
  return samples;
}

/**
 * 选出一个 PON 口用于计算基线的夜间日期。
 * samples: [{ onuId, sampleDate, phase, rxDbm }]（同一 PON 口）
 */
export function selectBaselineNights(samples = [], { today, nights = BASELINE_NIGHTS } = {}) {
  const todayKey = today || localDateKey();
  const byNight = new Map();
  for (const sample of samples) {
    const night = String(sample.sampleDate || "");
    if (!night || night >= todayKey) continue;
    const entry = byNight.get(night) || { total: 0, offline: 0 };
    entry.total += 1;
    if (sample.phase === "offline") entry.offline += 1;
    byNight.set(night, entry);
  }
  const ordered = [...byNight.keys()].sort();
  const outageNights = ordered.filter((night) => {
    const entry = byNight.get(night);
    return entry.total >= 2 && entry.offline / entry.total >= OUTAGE_NIGHT_RATIO;
  });
  const outageNight = outageNights.at(-1) || "";
  const eligible = ordered.filter((night) => !outageNight || night < outageNight);
  // 断纤当晚之前若连续多晚都是断纤状态，也一并排除。
  const healthy = eligible.filter((night) => !outageNights.includes(night));
  const selected = healthy.slice(-nights);
  return { nights: selected, outageNight, from: selected[0] || "", to: selected.at(-1) || "" };
}

/** 每户的断纤前基线：选定夜间里在线收光的中位数；只出现离线则标记为“断纤前已离线”。 */
export function buildOnuBaselines(samples = [], options = {}) {
  const window = selectBaselineNights(samples, options);
  const nightSet = new Set(window.nights);
  const perOnu = new Map();
  for (const sample of samples) {
    if (!nightSet.has(String(sample.sampleDate || ""))) continue;
    const onuId = String(sample.onuId);
    const entry = perOnu.get(onuId) || { rx: [], offlineNights: 0, nights: 0 };
    entry.nights += 1;
    if (sample.phase === "online" && Number.isFinite(sample.rxDbm)) entry.rx.push(sample.rxDbm);
    else if (sample.phase === "offline") entry.offlineNights += 1;
    perOnu.set(onuId, entry);
  }
  const baselines = new Map();
  for (const [onuId, entry] of perOnu) {
    baselines.set(onuId, {
      rxDbm: round2(median(entry.rx)),
      onlineNights: entry.rx.length,
      offlineBefore: entry.rx.length === 0 && entry.offlineNights > 0
    });
  }
  return { window, baselines };
}

function repairPattern({ comparable, degraded }) {
  if (comparable >= 3 && degraded >= Math.ceil(comparable * TRUNK_PATTERN_RATIO)) return "trunk";
  if (degraded >= 2) return "branch";
  if (degraded === 1) return "drop";
  return "none";
}

export const REPAIR_PATTERN_TEXT = Object.freeze({
  trunk: "整口用户普遍变差，多半是主干光缆熔接点问题，建议开盒重熔该口对应纤芯",
  branch: "部分用户变差，多半在分光器之后的分支段，建议检查对应分光器及其后的接头",
  drop: "仅个别用户变差，多半是入户皮线或用户侧接头问题",
  none: ""
});

/**
 * 逐户对比断纤前基线与当前实时数据。
 * liveRows: listOnus 返回的该 PON 实时行；samples: 该 PON 的夜间采样；users: 该 PON 的合并台账用户。
 */
export function comparePonRepair({ liveRows = [], samples = [], users = [], today, degradedDb = REPAIR_DEGRADED_DB, slightDb = REPAIR_SLIGHT_DB } = {}) {
  const { window, baselines } = buildOnuBaselines(samples, { today });
  const userByOnuId = new Map();
  for (const user of users) {
    const onuId = String(user?.onuId ?? "").trim();
    if (onuId && !userByOnuId.has(onuId)) userByOnuId.set(onuId, user);
  }
  const counts = { total: 0, recovered: 0, normal: 0, slight: 0, degraded: 0, offlineBefore: 0, notRecovered: 0, offlineUnknown: 0, noBaseline: 0 };
  const degraded = [];
  const slight = [];
  const notRecovered = [];
  const deltas = [];
  const seen = new Set();
  for (const row of liveRows) {
    const onuId = String(row?.onuId ?? "").trim();
    if (!onuId || seen.has(onuId)) continue;
    seen.add(onuId);
    counts.total += 1;
    const user = userByOnuId.get(onuId) || {};
    const person = {
      onuId,
      name: String(user.username || user.name || ""),
      address: String(user.installationAddress || user.address || ""),
      phone: String(user.userPhone || user.phone || "")
    };
    const baseline = baselines.get(onuId);
    if (isOnlinePhase(row.phase)) {
      counts.recovered += 1;
      const current = parseRxDbm(row.rxPower);
      if (!Number.isFinite(current) || !Number.isFinite(baseline?.rxDbm)) {
        counts.noBaseline += 1;
        continue;
      }
      const delta = round2(current - baseline.rxDbm);
      deltas.push(delta);
      const item = { ...person, before: baseline.rxDbm, after: round2(current), delta };
      if (delta <= -degradedDb) {
        counts.degraded += 1;
        degraded.push(item);
      } else if (delta <= -slightDb) {
        counts.slight += 1;
        slight.push(item);
      } else {
        counts.normal += 1;
      }
      continue;
    }
    if (baseline?.offlineBefore) counts.offlineBefore += 1;
    else if (Number.isFinite(baseline?.rxDbm)) {
      counts.notRecovered += 1;
      notRecovered.push({ ...person, before: baseline.rxDbm });
    } else counts.offlineUnknown += 1;
  }
  degraded.sort((left, right) => left.delta - right.delta);
  slight.sort((left, right) => left.delta - right.delta);
  const comparable = counts.normal + counts.slight + counts.degraded;
  const pattern = repairPattern({ comparable, degraded: counts.degraded });
  const hasBaseline = window.nights.length > 0 && [...baselines.values()].some((item) => Number.isFinite(item.rxDbm) || item.offlineBefore);
  return {
    status: !hasBaseline ? "no-baseline" : counts.total === 0 ? "no-configured-data" : counts.recovered === 0 ? "all-offline" : "compared",
    baselineFrom: window.from,
    baselineTo: window.to,
    baselineNights: window.nights.length,
    outageNight: window.outageNight,
    counts,
    medianDelta: round2(median(deltas)),
    pattern,
    patternText: REPAIR_PATTERN_TEXT[pattern],
    degraded,
    slight,
    notRecovered
  };
}

/** 汇总多个 PON 口的逐户对比结果，给出整体定界结论。 */
export function summarizeRepairResults(results = []) {
  const totals = { total: 0, recovered: 0, normal: 0, slight: 0, degraded: 0, offlineBefore: 0, notRecovered: 0, offlineUnknown: 0, noBaseline: 0 };
  const patterns = { trunk: 0, branch: 0, drop: 0 };
  for (const result of results) {
    for (const key of Object.keys(totals)) totals[key] += Number(result?.counts?.[key] || 0);
    if (patterns[result?.pattern] !== undefined) patterns[result.pattern] += 1;
  }
  return { totals, patterns, ponCount: results.length };
}
