const LOOKUP_INTENTS = new Set([
  "auto",
  "find_by_name",
  "find_by_phone",
  "find_by_address",
  "find_by_sn",
  "find_by_loid",
  "find_by_mac",
  "find_by_device_number",
  "find_by_onu_coordinate",
  "find_by_primary_address"
]);

function text(value) {
  return String(value ?? "").trim();
}

function folded(value) {
  return text(value).toLocaleLowerCase("zh-Hans-CN").replace(/\s+/g, "");
}

function digits(value) {
  return text(value).replace(/\D/g, "");
}

function parseCoordinate(value) {
  const raw = text(value).replace(/:/g, "/");
  const parts = raw.split("/");
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    return { chassis: parts[0], board: parts[1], pon: parts[2], onuId: parts[3] };
  }
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return { chassis: "", board: parts[0], pon: parts[1], onuId: parts[2] };
  }
  return { chassis: "", board: "", pon: "", onuId: "" };
}

function coordinateOf(row = {}) {
  const parsed = parseCoordinate(row.onuIndex || row.onuIndexDisplay);
  return {
    chassis: text(row.chassis || parsed.chassis),
    board: text(row.board || row.slot || parsed.board),
    pon: text(row.pon || parsed.pon),
    onuId: text(row.onuId || parsed.onuId)
  };
}

function coordinateKey(row = {}) {
  const coordinate = coordinateOf(row);
  return [text(row.oltIp), coordinate.chassis, coordinate.board, coordinate.pon, coordinate.onuId].join("|");
}

function cleanQuery(value) {
  let result = text(value);
  for (let index = 0; index < 3; index += 1) {
    const next = result
      .replace(/^(?:请|麻烦|帮忙|帮我|帮查|查询一下|查询|查一下|查查|查找|查|找一下|找|搜索|定位|看一下|看看|看)\s*[:：,，。-]*/iu, "")
      .replace(/\s*(?:的)?(?:光功率|光衰|状态|详情|信息|位置|端口|PON口|pon口|ONU|ONT|用户|客户|在线情况|在哪里|在哪儿|在哪)[?？。！!,，、\s]*$/iu, "")
      .trim();
    if (next === result) break;
    result = next;
  }
  return result;
}

function inferIntent(query) {
  const value = cleanQuery(query);
  if (/设备号|设备编号|设备号码|设备ID/iu.test(value)) return "find_by_device_number";
  if (/^1[3-9]\d{9}$/.test(digits(value))) return "find_by_phone";
  if (/LOID/iu.test(value)) return "find_by_loid";
  if (/MAC|MAC地址/iu.test(value)) return "find_by_mac";
  if (/SN|序列号|光猫号|ONT号/iu.test(value)) return "find_by_sn";
  if (/\d+\/\d+(?::\d+)?$/.test(value) || /槽|板卡|PON|端口/iu.test(value)) return "find_by_onu_coordinate";
  if (/村|镇|街|路|巷|号|光交|机房|片区|小区/iu.test(value)) return "find_by_address";
  return "auto";
}

function ponAddressMap(ponPorts = []) {
  const map = new Map();
  for (const port of Array.isArray(ponPorts) ? ponPorts : []) {
    const host = text(port.oltIp);
    const board = text(port.board || port.slot);
    const pon = text(port.pon);
    const chassis = text(port.chassis);
    if (!host || !board || !pon) continue;
    const address = text(port.address);
    if (!address) continue;
    map.set(`${host}|${chassis}|${board}|${pon}`, address);
    if (!map.has(`${host}||${board}|${pon}`)) map.set(`${host}||${board}|${pon}`, address);
  }
  return map;
}

function primaryAddressFor(row, addresses) {
  const coordinate = coordinateOf(row);
  return addresses.get(`${text(row.oltIp)}|${coordinate.chassis}|${coordinate.board}|${coordinate.pon}`) ||
    addresses.get(`${text(row.oltIp)}||${coordinate.board}|${coordinate.pon}`) || "";
}

function mergeRows(mergedRows = [], resourceRows = []) {
  const byKey = new Map();
  for (const sourceRow of [...(Array.isArray(resourceRows) ? resourceRows : []), ...(Array.isArray(mergedRows) ? mergedRows : [])]) {
    const key = coordinateKey(sourceRow);
    if (!key || key.endsWith("||||")) continue;
    const current = byKey.get(key) || {};
    const next = { ...current, ...sourceRow };
    for (const [field, value] of Object.entries(current)) {
      if (!text(next[field]) && text(value)) next[field] = value;
    }
    byKey.set(key, next);
  }
  return [...byKey.values()];
}

function matches(row, query, intent, primaryAddress) {
  const value = cleanQuery(query);
  const normalized = folded(value);
  if (!normalized) return false;
  const fields = {
    find_by_name: [row.username],
    find_by_phone: [row.userPhone, row.phone],
    find_by_address: [row.installationAddress, primaryAddress],
    find_by_primary_address: [primaryAddress],
    find_by_sn: [row.serial, row.serialNumber, row.oltSerial],
    find_by_loid: [row.loid, row.loidDisplay],
    find_by_mac: [row.mac],
    find_by_device_number: [row.deviceNumber],
    find_by_onu_coordinate: [row.onuIndex, row.onuIndexDisplay, `${row.chassis}/${row.board}/${row.pon}:${row.onuId}`]
  };
  if (intent !== "auto") {
    if (intent === "find_by_phone") return fields[intent].some((item) => digits(item).includes(digits(value)));
    return (fields[intent] || []).some((item) => folded(item).includes(normalized));
  }
  return Object.values(fields).flat().some((item) => folded(item).includes(normalized));
}

export function searchOnuCatalog({
  query,
  intent = "auto",
  mergedRows = [],
  resourceRows = [],
  ponPorts = [],
  limit = 10,
  allowedOltIps = []
} = {}) {
  const cleanIntent = LOOKUP_INTENTS.has(intent) ? intent : "auto";
  const effectiveIntent = cleanIntent === "auto" ? inferIntent(query) : cleanIntent;
  const allowed = new Set((Array.isArray(allowedOltIps) ? allowedOltIps : []).map(text).filter(Boolean));
  const addresses = ponAddressMap(ponPorts);
  const rows = mergeRows(mergedRows, resourceRows).filter((row) => !allowed.size || allowed.has(text(row.oltIp)));
  const candidates = rows.filter((row) => matches(row, query, effectiveIntent, primaryAddressFor(row, addresses))).map((row) => {
    const coordinate = coordinateOf(row);
    const primaryAddress = primaryAddressFor(row, addresses);
    return {
      candidateId: `catalog:${coordinateKey(row)}`,
      oltIp: text(row.oltIp),
      coordinate,
      username: text(row.username),
      phone: text(row.userPhone || row.phone),
      installationAddress: text(row.installationAddress),
      primaryAddress,
      serial: text(row.serial || row.serialNumber),
      loid: text(row.loid || row.loidDisplay),
      mac: text(row.mac),
      deviceNumber: text(row.deviceNumber),
      deviceType: text(row.deviceType),
      phase: text(row.phase),
      rxPower: text(row.rxPower),
      distance: text(row.distance),
      source: text(row.usernameSource) ? "merged_onu_snapshots" : "resource_user_snapshots",
      syncedAt: text(row.syncedAt)
    };
  });
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  return {
    query: cleanQuery(query),
    intent: effectiveIntent,
    source: "local-onu-catalog",
    total: candidates.length,
    candidates: candidates.slice(0, safeLimit)
  };
}

export function parseOnuCatalogCandidate(candidate = {}) {
  return {
    oltIp: text(candidate.oltIp),
    coordinate: coordinateOf(candidate),
    candidateId: text(candidate.candidateId)
  };
}
