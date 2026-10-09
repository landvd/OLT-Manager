// 断纤事件识别、事件归并与同缆组推断（纯函数，无 IO）。
// 依据只读采集结果：整口离线（所有型号），或同口多数 ONU 在同一时段因 LOS/LOF 离线（中兴 C300 可读最后离线时间与原因）。

const OUTAGE_OFFLINE_SHARE = 0.8;
const CLUSTER_SHARE = 0.6;
const CLUSTER_MIN_ONUS = 3;
const CLUSTER_WINDOW_MS = 10 * 60 * 1000;
const CLUSTER_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const EVENT_GAP_MS = 30 * 60 * 1000;
const FIBER_CAUSES = /^(?:LOS|LOSi|LOF|LOFi)$/i;
const ONLINE = new Set(["online", "working", "active", "up", "ready", "在线", "工作中", "就绪"]);
const OFFLINE = new Set(["offline", "los", "losi", "dyinggasp", "authfailed", "down", "离线", "光路中断", "掉电"]);

export function outagePonKey({ oltIp, chassis, board, pon }) {
  return `${String(oltIp ?? "").trim()}|${String(chassis ?? "").trim()}/${String(board ?? "").trim()}/${String(pon ?? "").trim()}`;
}

function parseLocalTime(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) return NaN;
  return new Date(text.replace(" ", "T")).getTime();
}

/**
 * 判断一个 PON 口的实时 / 夜间读取结果是否显示断纤。
 * 返回 { kind: "ongoing" | "recovered", startedAt, affected, total, source } 或 null。
 */
export function detectPonOutage(rows = [], { now = new Date() } = {}) {
  const total = rows.length;
  if (total < 2) return null;
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const offline = rows.filter((row) => OFFLINE.has(String(row?.phase ?? "").trim().toLowerCase())).length;
  const online = rows.filter((row) => ONLINE.has(String(row?.phase ?? "").trim().toLowerCase())).length;
  const fiberDrops = rows
    .filter((row) => FIBER_CAUSES.test(String(row?.lastOfflineCause ?? "").trim()))
    .map((row) => parseLocalTime(row.lastOfflineTime))
    .filter((time) => Number.isFinite(time) && time <= current && current - time <= CLUSTER_LOOKBACK_MS)
    .sort((left, right) => left - right);
  // 找出 10 分钟窗口内因光路原因离线最多的一批。
  let best = { count: 0, start: NaN };
  for (let index = 0, end = 0; index < fiberDrops.length; index += 1) {
    while (end < fiberDrops.length && fiberDrops[end] - fiberDrops[index] <= CLUSTER_WINDOW_MS) end += 1;
    if (end - index > best.count) best = { count: end - index, start: fiberDrops[index] };
  }
  const clustered = best.count >= CLUSTER_MIN_ONUS && best.count / total >= CLUSTER_SHARE;
  if (offline / total >= OUTAGE_OFFLINE_SHARE) {
    return {
      kind: "ongoing",
      startedAt: new Date(clustered ? best.start : current).toISOString(),
      affected: offline,
      total,
      source: "nightly-offline"
    };
  }
  if (clustered && online > 0) {
    return { kind: "recovered", startedAt: new Date(best.start).toISOString(), affected: best.count, total, source: "offline-cluster" };
  }
  return null;
}

/** 把各口的断纤记录按时间归并成事件：开始时间相差 30 分钟以内的算同一次断纤。 */
export function groupOutageEvents(occurrences = [], { gapMs = EVENT_GAP_MS } = {}) {
  const sorted = [...occurrences]
    .filter((item) => Number.isFinite(Date.parse(item.startedAt)))
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const events = [];
  for (const item of sorted) {
    const time = Date.parse(item.startedAt);
    const last = events.at(-1);
    if (last && time - last.lastAt <= gapMs) {
      if (!last.ponKeys.includes(item.ponKey)) last.ponKeys.push(item.ponKey);
      last.occurrences.push(item);
      last.lastAt = time;
      continue;
    }
    events.push({ startedAt: item.startedAt, lastAt: time, ponKeys: [item.ponKey], occurrences: [item] });
  }
  return events.map(({ lastAt, ...event }) => ({
    ...event,
    recoveredAt: event.occurrences.every((item) => item.recoveredAt)
      ? event.occurrences.map((item) => item.recoveredAt).sort().at(-1)
      : "",
    sources: [...new Set(event.occurrences.map((item) => item.source))],
    affected: event.occurrences.reduce((sum, item) => sum + Number(item.affected || 0), 0)
  }));
}

/**
 * 同缆组推断：在不同事件里一起断过至少 minTogether 次、且同断比例（共同次数 / 任一口断纤总次数）
 * 不低于 minShare 的口连成一组。只看两个及以上口同时断的事件。
 */
export function inferCableGroups(events = [], { minTogether = 2, minShare = 0.6 } = {}) {
  const multi = events.filter((event) => event.ponKeys.length >= 2);
  const appearances = new Map();
  const together = new Map();
  for (const event of multi) {
    const keys = [...new Set(event.ponKeys)].sort();
    for (const key of keys) appearances.set(key, (appearances.get(key) || 0) + 1);
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const pair = `${keys[i]}\n${keys[j]}`;
        together.set(pair, (together.get(pair) || 0) + 1);
      }
    }
  }
  const parent = new Map();
  const find = (key) => {
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)));
      key = parent.get(key);
    }
    return key;
  };
  const strength = new Map();
  for (const [pair, count] of together) {
    const [left, right] = pair.split("\n");
    const union = appearances.get(left) + appearances.get(right) - count;
    if (count < minTogether || count / union < minShare) continue;
    for (const key of [left, right]) if (!parent.has(key)) parent.set(key, key);
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parent.set(rootLeft, rootRight);
    strength.set(pair, count);
  }
  const groups = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(key);
  }
  return [...groups.values()].map((ponKeys) => {
    const sorted = ponKeys.sort();
    const counts = [...strength].filter(([pair]) => {
      const [left, right] = pair.split("\n");
      return sorted.includes(left) && sorted.includes(right);
    }).map(([, count]) => count);
    return { ponKeys: sorted, together: Math.min(...counts), maxTogether: Math.max(...counts) };
  }).sort((left, right) => right.maxTogether - left.maxTogether || right.ponKeys.length - left.ponKeys.length);
}

const NEGATIVE_FEEDBACK = /^(?:不对|错了|不是这个|不是这样|没用|答非所问|不准|不正确|乱说)/u;

/** 外勤对上一轮回答的否定反馈，例如“不对”“没用”。 */
export function isNegativeFeedback(text) {
  return NEGATIVE_FEEDBACK.test(String(text || "").trim());
}

/** 未解决问题去重用的规范化文本：去掉空白、标点和常见口头前缀。 */
export function normalizeQuestion(text) {
  return String(text || "")
    .replace(/[\s，。！？、,.!?;；：:“”"'（）()【】]/gu, "")
    .replace(/^(?:请问|请|麻烦|帮我|帮忙|查查|查询|查一下|查)/u, "")
    .slice(0, 120);
}
