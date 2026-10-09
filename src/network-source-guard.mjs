// 网管二期源快照的单台 OLT 保护：某台 OLT 在网管里匹配不到、返回 0 条或条数骤减时，
// 保留这台 OLT 上次的快照并给出告警，其它 OLT 照常更新，避免整台 OLT 的用户“悄悄消失”。

export const NETWORK_DROP_RATIO = 0.3;
export const NETWORK_DROP_MIN_PREVIOUS = 20;

function text(value) {
  return String(value ?? "").trim();
}

/**
 * targets: [{ oltIp, name }]
 * fresh: Map<oltIp, { rows: [] | null, reason?: "unmatched" }>，rows 为 null 表示网管中没有匹配到该 OLT
 * previousRows: 上次网管二期源快照（含 oltIp）
 * acceptDrops: 现场确认是真实变化（如割接迁移、OLT 下线）时为 true，直接采用新数据
 */
export function guardNetworkSourceRows({ targets = [], fresh = new Map(), previousRows = [], acceptDrops = false, dropRatio = NETWORK_DROP_RATIO, minPrevious = NETWORK_DROP_MIN_PREVIOUS } = {}) {
  const previousByOlt = new Map();
  for (const row of previousRows) {
    const ip = text(row?.oltIp);
    if (!ip) continue;
    if (!previousByOlt.has(ip)) previousByOlt.set(ip, []);
    previousByOlt.get(ip).push(row);
  }
  const rows = [];
  const warnings = [];
  for (const target of targets) {
    const ip = text(target?.oltIp);
    const name = text(target?.name) || ip;
    const entry = fresh.get(ip) || { rows: null, reason: "unmatched" };
    const freshRows = Array.isArray(entry.rows) ? entry.rows : [];
    const previous = previousByOlt.get(ip) || [];
    let reason = "";
    if (entry.rows === null) reason = "unmatched";
    else if (freshRows.length === 0) reason = "empty";
    else if (previous.length >= minPrevious && freshRows.length < previous.length * (1 - dropRatio)) reason = "dropped";
    if (!reason || previous.length === 0) {
      rows.push(...freshRows);
      continue;
    }
    if (acceptDrops) {
      rows.push(...freshRows);
      warnings.push({ oltIp: ip, name, reason, previousCount: previous.length, freshCount: freshRows.length, kept: false });
      continue;
    }
    rows.push(...previous);
    warnings.push({ oltIp: ip, name, reason, previousCount: previous.length, freshCount: freshRows.length, kept: true });
  }
  return { rows, warnings };
}

export function networkGuardWarningText(warning) {
  const what = warning.reason === "unmatched"
    ? "在网管二期中没有匹配到该 OLT（可能是 IP 映射或网管设备名变化）"
    : warning.reason === "empty"
      ? "网管二期返回 0 条 ONU"
      : `网管二期返回 ${warning.freshCount} 条，比上次 ${warning.previousCount} 条减少超过 30%`;
  return warning.kept
    ? `${warning.name}：${what}，已保留上次的 ${warning.previousCount} 条数据`
    : `${warning.name}：${what}，已按确认采用新数据`;
}
