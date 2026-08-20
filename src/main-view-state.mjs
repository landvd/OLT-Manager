import { defaultChassisForVendor, normalizePonCoordinate, ponCoordinateKey } from "./pon-coordinate.mjs";

const phaseMap = {
  working: { text: "在线", group: "online", type: "success" },
  online: { text: "在线", group: "online", type: "success" },
  offline: { text: "离线", group: "offline", type: "info" },
  los: { text: "LOS", group: "los", type: "danger" },
  dyinggasp: { text: "断电", group: "power", type: "warning" },
  authfailed: { text: "认证失败", group: "auth", type: "danger" },
  logging: { text: "登录中", group: "logging", type: "warning" },
  syncmib: { text: "同步中", group: "sync", type: "warning" }
};

export function phaseInfo(phase) {
  return phaseMap[String(phase || "").trim().toLowerCase()] || { text: phase || "未知", group: "unknown", type: "info" };
}

export function rxPowerInfo(rxPower) {
  const raw = String(rxPower || "").trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return { text: raw || "N/A", className: "unknown" };
  if (value <= -12 && value >= -25) return { text: raw, className: "good" };
  if (value < -25 && value >= -27) return { text: raw, className: "warn" };
  return { text: raw, className: "bad" };
}

export function filterStorageKey(oltId) {
  return `olt-manager-filters:${oltId || "default"}`;
}

export function uniqueSorted(values, numeric = false) {
  const items = [...new Set(values.filter((value) => value !== "" && value != null).map(String))];
  return items.sort((a, b) => numeric ? Number(a) - Number(b) : a.localeCompare(b, "zh-Hans-CN"));
}

export function countDuplicateAddresses(rows) {
  const duplicateAddresses = new Map();
  for (const port of rows) {
    if (!port.address) continue;
    duplicateAddresses.set(port.address, (duplicateAddresses.get(port.address) || 0) + 1);
  }
  return [...duplicateAddresses.values()].filter((count) => count > 1).length;
}

export function countOnuGroups(rows) {
  const counts = { total: rows.length, online: 0, offline: 0, los: 0, power: 0, auth: 0, logging: 0, sync: 0 };
  for (const row of rows) {
    const group = phaseInfo(row.phase).group;
    if (Object.hasOwn(counts, group)) counts[group] += 1;
  }
  return counts;
}

export function normalizePonPortRow(row) {
  const coordinate = normalizePonCoordinate(row);
  return {
    oltIp: String(row.oltIp ?? row["OLT IP"] ?? row["OLT"] ?? row["OLT地址"] ?? row["OLT IP地址"] ?? row.olt_ip ?? "").trim(),
    chassis: coordinate.chassis,
    board: coordinate.board,
    slot: coordinate.board,
    pon: coordinate.pon,
    ponPort: coordinate.ponPort,
    outerVlan: String(row.outerVlan ?? row["外层 VLAN"] ?? row["外层VLAN"] ?? row["Outer VLAN"] ?? row.outer_vlan ?? "").trim(),
    address: String(row.address ?? row["地址"] ?? row["安装地址"] ?? row["ONU地址"] ?? "").trim()
  };
}

export function normalizePonRows(rows) {
  return rows.map(normalizePonPortRow).filter((row) => row.oltIp && row.ponPort);
}

export function excelRowsToPonRows(rows) {
  return normalizePonRows(rows);
}

export function ponRowsForExport(rows) {
  return rows.map((row) => ({
    "OLT IP": row.oltIp || "",
    "槽": row.chassis || "",
    "板卡": row.board || row.slot || "",
    "PON": row.pon || "",
    "板槽端口": row.ponPort || ponCoordinateKey(row),
    "外层 VLAN": row.outerVlan || "",
    "地址": row.address || ""
  }));
}
