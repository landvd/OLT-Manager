import { defaultChassisForVendor, normalizePonCoordinate } from "./pon-coordinate.mjs";
import {
  decodeRawHexString,
  encodeZtePonIfIndex,
  oidSuffix,
  parseZteUnconfiguredIndex
} from "./snmp-parsers.mjs";

export const ZTE_VLAN_IF_CONF_VLAN_OID = "1.3.6.1.4.1.3902.1082.40.50.2.1.4.1.7";
export const HUAWEI_IF_NAME_OID = "1.3.6.1.2.1.31.1.1.1.1";
export const HUAWEI_SRV_FLOW_FRAME_OID = "1.3.6.1.4.1.2011.5.14.5.2.1.2";
export const HUAWEI_SRV_FLOW_SLOT_OID = "1.3.6.1.4.1.2011.5.14.5.2.1.3";
export const HUAWEI_SRV_FLOW_PON_OID = "1.3.6.1.4.1.2011.5.14.5.2.1.4";
export const HUAWEI_SRV_FLOW_PARAM_TYPE_OID = "1.3.6.1.4.1.2011.5.14.5.2.1.7";
export const HUAWEI_SRV_FLOW_VLAN_ID_OID = "1.3.6.1.4.1.2011.5.14.5.2.1.8";

export function decodeZtePort(encoded) {
  const board = (encoded >> 16) & 0xff;
  return {
    chassis: 1,
    board,
    slot: board,
    pon: (encoded >> 8) & 0xff
  };
}

export function encodeZtePonIndex(slot, pon) {
  return (0x10 << 24) + (Number(slot) << 16) + (Number(pon) << 8);
}

export function encodeZteVportIndex(onuId, vport) {
  return (0x18 << 24) + (Number(onuId) << 16) + (Number(vport) << 8);
}

export function ztePonGroupKey(board, pon) {
  const ponNumber = Number(pon);
  const groupStart = ponNumber <= 8 ? 1 : 9;
  return `${board}/${groupStart}-${groupStart + 7}`;
}

export function parseZteIndex(oid, baseOid) {
  const suffix = oidSuffix(oid, baseOid);
  const encoded = suffix[0] || 0;
  const onuId = suffix[1] || 0;
  return { ...decodeZtePort(encoded), onuId, encoded, key: `${encoded}.${onuId}` };
}

export function parseHuaweiOntIndex(oid, baseOid) {
  const suffix = oidSuffix(oid, baseOid);
  const ifIndex = suffix[0] || 0;
  const onuId = suffix[1] ?? 0;
  return { ifIndex, onuId, key: `${ifIndex}.${onuId}` };
}

export function collectHuaweiOntIndexes(rowSets = []) {
  const indexes = new Map();
  for (const { rows = [], baseOid } of rowSets) {
    for (const row of rows || []) {
      if (/No Such Object|No Such Instance/i.test(row.value)) continue;
      const idx = parseHuaweiOntIndex(row.oid, baseOid);
      if (!idx.ifIndex || !Number.isFinite(Number(idx.onuId))) continue;
      indexes.set(idx.key, idx);
    }
  }
  return [...indexes.values()].sort((left, right) => Number(left.onuId) - Number(right.onuId));
}

export function parseVlanCandidates(value) {
  return String(value || "")
    .replace(/^"|"$/g, "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((vlan) => Number.isFinite(vlan) && vlan >= 1 && vlan <= 4094);
}

function selectMostLikelyOuterVlan(values) {
  const candidates = values
    .map((value) => Number.parseInt(value, 10))
    .filter((vlan) => Number.isFinite(vlan) && vlan >= 1 && vlan <= 4094);
  const preferred = candidates.filter((vlan) => vlan >= 1000 && vlan < 2000);
  const pool = preferred.length ? preferred : candidates.filter((vlan) => vlan >= 1000);
  const fallback = pool.length ? pool : candidates;
  const counts = fallback.reduce((map, vlan) => map.set(vlan, (map.get(vlan) || 0) + 1), new Map());
  const [best] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  return best ? best[0] : "";
}

export function parseZteOuterVlanRows(rows) {
  const byIfIndex = new Map();
  for (const row of rows) {
    const suffix = oidSuffix(row.oid, ZTE_VLAN_IF_CONF_VLAN_OID);
    const ifIndex = suffix[0];
    if (!ifIndex) continue;
    const vlans = parseVlanCandidates(cleanSnmpValue(row.value));
    if (!vlans.length) continue;
    if (!byIfIndex.has(ifIndex)) byIfIndex.set(ifIndex, []);
    byIfIndex.get(ifIndex).push(...vlans);
  }
  const result = new Map();
  for (const [ifIndex, values] of byIfIndex) {
    const outer = selectMostLikelyOuterVlan([...values]);
    if (outer) result.set(String(ifIndex), String(outer));
  }
  return result;
}

function rowsToIndexValueMap(rows, baseOid) {
  const map = new Map();
  for (const row of rows) {
    const index = oidSuffix(row.oid, baseOid)[0];
    if (!Number.isFinite(index)) continue;
    map.set(String(index), cleanSnmpValue(row.value).replace(/^"|"$/g, ""));
  }
  return map;
}

function selectOuterVlan(values) {
  const sorted = [...values]
    .map((value) => Number.parseInt(value, 10))
    .filter((vlan) => Number.isFinite(vlan) && vlan >= 1 && vlan <= 4094)
    .sort((a, b) => a - b);
  return sorted.find((vlan) => vlan >= 1000 && vlan < 2000) || sorted.find((vlan) => vlan >= 1000) || sorted[0] || "";
}

export function parseHuaweiOuterVlanRows({ frameRows, slotRows, ponRows, typeRows, vlanRows }) {
  const frames = rowsToIndexValueMap(frameRows, HUAWEI_SRV_FLOW_FRAME_OID);
  const slots = rowsToIndexValueMap(slotRows, HUAWEI_SRV_FLOW_SLOT_OID);
  const pons = rowsToIndexValueMap(ponRows, HUAWEI_SRV_FLOW_PON_OID);
  const types = rowsToIndexValueMap(typeRows, HUAWEI_SRV_FLOW_PARAM_TYPE_OID);
  const vlans = rowsToIndexValueMap(vlanRows, HUAWEI_SRV_FLOW_VLAN_ID_OID);
  const byPonPort = new Map();

  for (const [index, vlan] of vlans) {
    if (frames.get(index) !== "0" || types.get(index) !== "4") continue;
    const slot = slots.get(index);
    const pon = pons.get(index);
    if (!slot || !pon) continue;
    const key = `${frames.get(index)}/${slot}/${pon}`;
    if (!byPonPort.has(key)) byPonPort.set(key, new Set());
    byPonPort.get(key).add(vlan);
  }

  const result = new Map();
  for (const [ponPort, values] of byPonPort) {
    const outer = selectOuterVlan(values);
    if (outer) result.set(ponPort, String(outer));
  }
  return result;
}

export function parseHuaweiIfNameRows(rows, baseOid = HUAWEI_IF_NAME_OID) {
  const map = new Map();
  for (const row of rows) {
    const ifIndex = Number(oidSuffix(row.oid, baseOid)[0]);
    const name = cleanSnmpValue(row.value);
    const match = name.match(/^GPON\s+(\d+)\/(\d+)\/(\d+)$/i);
    if (!Number.isFinite(ifIndex) || !match) continue;
    const [, chassis, board, pon] = match;
    map.set(`${chassis}/${board}/${pon}`, {
      ifIndex,
      chassis: Number(chassis),
      board: Number(board),
      slot: Number(board),
      pon: Number(pon),
      name
    });
  }
  return map;
}

export function requestCoordinate(query = {}, olt = {}) {
  return normalizePonCoordinate({
    chassis: query.chassis,
    board: query.board || query.slot,
    pon: query.pon,
    ponPort: query.ponPort
  }, { vendor: olt.vendor });
}

export function cleanSnmpValue(value) {
  return String(value)
    .replace(/^[A-Z-]+:\s*/, "")
    .replace(/^"|"$/g, "")
    .trim();
}

export function decodeHexSerial(value) {
  const hex = String(value).match(/Hex-STRING:\s*([0-9A-Fa-f ]+)/)?.[1];
  if (!hex) return cleanSnmpValue(value);
  const bytes = hex.trim().split(/\s+/).map((part) => Number.parseInt(part, 16));
  if (bytes.every((byte) => byte === 0)) return "N/A";
  const vendor = String.fromCharCode(...bytes.slice(0, 4)).replace(/[^\x20-\x7e]/g, "");
  const serial = bytes.slice(4).map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
  return `${vendor}${serial}`;
}

export function decodeZteRxPower(value) {
  const raw = Number.parseInt(cleanSnmpValue(value), 10);
  if (!Number.isFinite(raw) || raw === 65535 || raw === 65534) return "N/A";
  const dbm = raw > 30000 ? (raw - 65536) * 0.002 - 30 : raw * 0.002 - 30;
  return `${dbm.toFixed(2)} dBm`;
}

export function decodeDistance(value) {
  const meters = Number.parseInt(cleanSnmpValue(value), 10);
  if (!Number.isFinite(meters) || meters <= 0) return "N/A";
  return `${(meters / 1000).toFixed(2)} km`;
}

export function decodeHuaweiRxPower(value) {
  const raw = Number.parseInt(cleanSnmpValue(value), 10);
  if (!Number.isFinite(raw) || raw === 2147483647 || raw === 65535 || raw === 65534) return "N/A";
  const signedRaw = raw >= 32768 && raw <= 65533 ? raw - 65536 : raw;
  return `${(signedRaw / 100).toFixed(2)} dBm`;
}

export function huaweiRunStatus(value) {
  const code = Number.parseInt(cleanSnmpValue(value), 10);
  const labels = {
    1: "online",
    2: "offline"
  };
  return labels[code] || cleanSnmpValue(value) || "unknown";
}

export function huaweiUnconfiguredStatus(value) {
  const code = Number.parseInt(cleanSnmpValue(value), 10);
  const labels = {
    9: "未注册"
  };
  return labels[code] || cleanSnmpValue(value) || "未知";
}

export function filterHuaweiUnregisteredSerialRows({
  serialRows = [],
  statusRows = [],
  registeredSerialRows = [],
  serialBaseOid,
  statusBaseOid
} = {}) {
  const statusByKey = indexRows(statusRows, statusBaseOid, parseHuaweiOntIndex, cleanSnmpValue);
  const registeredSerials = new Set(registeredSerialRows.map((row) => decodeRawHexString(row.value)));
  return serialRows.filter((row) => {
    if (/No Such Object|No Such Instance/i.test(row.value)) return false;
    const idx = parseHuaweiOntIndex(row.oid, serialBaseOid);
    const registerResult = Number.parseInt(statusByKey.get(idx.key)?.value, 10);
    if (registerResult !== 9) return false;
    const serial = decodeRawHexString(row.value);
    return serial !== "N/A" && !registeredSerials.has(serial);
  });
}

export function parseDateTimeText(value) {
  const text = cleanSnmpValue(value);
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match || text.startsWith("0000-00-00")) return null;
  const [, year, month, day, hour, minute, second] = match;
  const label = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  const ts = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).getTime();
  return Number.isFinite(ts) ? { label, ts } : null;
}

export function decodeSnmpDateAndTime(value) {
  const hex = String(value).match(/Hex-STRING:\s*([0-9A-Fa-f ]+)/)?.[1];
  if (!hex) return parseDateTimeText(value);
  const bytes = hex.trim().split(/\s+/).map((part) => Number.parseInt(part, 16));
  if (bytes.length < 8 || bytes.every((byte) => byte === 0)) return null;
  const year = bytes[0] * 256 + bytes[1];
  const month = bytes[2];
  const day = bytes[3];
  const hour = bytes[4];
  const minute = bytes[5];
  const second = bytes[6];
  if (!year || !month || !day) return null;
  const label = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-") + ` ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  let ts = new Date(`${label.replace(" ", "T")}`).getTime();
  if (bytes.length >= 11 && (bytes[8] === 0x2b || bytes[8] === 0x2d)) {
    const sign = bytes[8] === 0x2b ? 1 : -1;
    const offsetMinutes = sign * ((bytes[9] || 0) * 60 + (bytes[10] || 0));
    ts = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60 * 1000;
  }
  return Number.isFinite(ts) ? { label, ts } : null;
}

export function indexRows(rows, baseOid, parser, valueMapper = cleanSnmpValue) {
  const map = new Map();
  for (const row of rows) {
    const idx = parser(row.oid, baseOid);
    if (idx.key) map.set(idx.key, { ...idx, value: valueMapper(row.value) });
  }
  return map;
}

export function phaseLabel(profile, value) {
  const code = Number.parseInt(cleanSnmpValue(value), 10);
  return profile.phaseMap?.[code] || cleanSnmpValue(value) || "unknown";
}

export function decodeZteOfflineCause(value, profile) {
  const raw = cleanSnmpValue(value);
  const code = Number.parseInt(raw, 10);
  if (!Number.isFinite(code)) return { code: null, label: raw || "unknown" };
  return {
    code,
    label: profile.offlineCauseMap?.[code] || `unknown(${code})`
  };
}

export {
  decodeRawHexString,
  encodeZtePonIfIndex,
  oidSuffix,
  parseZteUnconfiguredIndex
};
