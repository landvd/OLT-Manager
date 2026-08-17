import { backupDatabaseBeforeSync, replaceMergedOnuDataset } from "./db.mjs";

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeMergedLoid(value) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function firstText(row, fields) {
  for (const field of fields) {
    const value = text(row?.[field]);
    if (value) return value;
  }
  return "";
}

export function normalizeMergedCoordinate(value, fields = {}) {
  const original = text(value) || firstText(fields, [
    "onuIndex", "onu_index", "onuIndexName", "ONUDEVICEINDEX", "deviceName", "DEVNAME", "PON_NAME"
  ]);
  const match = /(?:^|\s)(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*(?::|\/)(\d+)(?:\s|$)/.exec(original);
  if (!match) return null;
  const [, chassis, board, pon, onuId] = match;
  return {
    chassis,
    board,
    pon,
    onuId,
    key: `${chassis}/${board}/${pon}:${onuId}`,
    display: original
  };
}

function normalizeNetworkRow(row = {}) {
  const coordinate = normalizeMergedCoordinate(undefined, row);
  const oltIp = firstText(row, ["oltIp", "olt_ip", "OLT_IP"]);
  const loidDisplay = firstText(row, ["loid", "LOID"]);
  const projected = {
    oltIp,
    chassis: coordinate?.chassis || text(row.chassis),
    board: coordinate?.board || text(row.board || row.slot),
    pon: coordinate?.pon || text(row.pon),
    onuId: coordinate?.onuId || text(row.onuId || row.onu_id),
    onuIndexDisplay: coordinate?.display || firstText(row, ["onuIndex", "onu_index", "onuIndexName", "ONUDEVICEINDEX"]),
    deviceName: firstText(row, ["deviceName", "DEVNAME", "NAME", "PON_NAME"]),
    deviceNumber: firstText(row, [
      "deviceNumber", "device_number", "DEVICE_NO", "DEV_NO", "DEVNO", "DEVICE_NUMBER", "DEVICENUMBER",
      "DEVICEID", "DEVICE_ID", "DEVICE_CODE", "DEVICECODE", "DEV_CODE", "DEV_ID", "ONU_DEVICE_NO",
      "ONUDEVICE_NO", "ONUDEVICENO", "ONU_DEVICE_NUMBER", "ONU_NUMBER", "ONU_NO", "ONUNO", "STB_SN"
    ]),
    loid: normalizeMergedLoid(loidDisplay),
    loidDisplay,
    mac: firstText(row, ["mac", "MAC", "ONUMACADDRESS", "MACADDRESS"]),
    serial: firstText(row, ["serial", "SN", "SERIAL", "SERIALNUMBER", "ONT_SN"]),
    username: firstText(row, ["username", "USER_NAME", "USERNAME", "CUSTOMER_NAME", "CUSTOMERNAME", "CUSTNAME", "FULL_NAME", "ONUNAME", "USER"]),
    userPhone: firstText(row, ["userPhone", "USER_PHONE", "PHONE", "TEL", "MOBILE"]),
    installationAddress: firstText(row, ["installationAddress", "INSTALLATION_ADDRESS", "USER_ADDRESS", "ADDRESS", "WHLADDR"]),
    deviceType: firstText(row, ["deviceType", "DEVICE_TYPE", "TYPE"]),
    ponType: firstText(row, ["ponType", "PON_TYPE"]),
    phase: firstText(row, ["phase", "PHASE", "STATUS", "STATE", "ONU_STATUS"]),
    rxPower: firstText(row, ["rxPower", "RX_POWER", "RX_OPTICAL", "RXOPTICAL"]),
    distance: firstText(row, ["distance", "DISTANCE", "ONU_DISTANCE"]),
    persistable: Boolean(oltIp && coordinate)
  };
  return projected;
}

function normalizeNmseRow(row = {}) {
  const loidDisplay = firstText(row, ["loid", "LOID"]);
  const coordinate = normalizeMergedCoordinate(undefined, row);
  return {
    oltIp: firstText(row, ["oltIp", "olt_ip", "OLT_IP"]),
    onuIndexDisplay: coordinate?.display || firstText(row, ["onuIndex", "onu_index", "onuIndexName", "ONUDEVICEINDEX"]),
    coordinate,
    loid: normalizeMergedLoid(loidDisplay),
    loidDisplay,
    username: firstText(row, ["username", "USER_NAME", "USERNAME", "CUSTOMER_NAME", "USER"]),
    userPhone: firstText(row, ["userPhone", "user_phone", "usertel", "USER_PHONE", "PHONE", "TEL"]),
    installationAddress: firstText(row, ["installationAddress", "installation_address", "useraddr", "USER_ADDRESS", "ADDRESS"])
  };
}

function conflict(reason, row, detail) {
  return {
    reason,
    oltIp: text(row?.oltIp),
    onuIndexDisplay: text(row?.onuIndexDisplay || row?.onuIndex || row?.onu_index),
    loid: normalizeMergedLoid(row?.loid),
    detail: text(detail)
  };
}

function coordinateKey(oltIp, coordinate) {
  if (!coordinate) return "";
  const key = coordinate.key || ([coordinate.chassis, coordinate.board, coordinate.pon, coordinate.onuId].every(Boolean)
    ? `${coordinate.chassis}/${coordinate.board}/${coordinate.pon}:${coordinate.onuId}`
    : "");
  return key ? `${oltIp}|${key}` : "";
}

function mergeUsername(network, nmse) {
  if (!nmse?.username) return { username: network.username, usernameSource: network.username ? "network" : "none" };
  return { username: nmse.username, usernameSource: "nmse" };
}

export function mergeOnuDatasets(networkRows = [], nmseRows = []) {
  if (!Array.isArray(networkRows) || !Array.isArray(nmseRows)) throw new TypeError("合并 ONU 数据必须是数组。");

  const network = networkRows.map(normalizeNetworkRow);
  const nmse = nmseRows.map(normalizeNmseRow);
  const conflicts = [];
  const networkKeys = new Set();
  for (const row of network) {
    if (!row.persistable) {
      conflicts.push(conflict("network_coordinate_unparseable", row, "网管二期 ONU 行缺少可解析的槽/板卡/PON/ID 或 OLT 地址。"));
      continue;
    }
    const key = `${row.oltIp}|${row.chassis}/${row.board}/${row.pon}:${row.onuId}`;
    if (networkKeys.has(key)) {
      const error = new Error(`网管二期 ONU 主键重复：${key}`);
      error.status = 409;
      throw error;
    }
    networkKeys.add(key);
  }

  const nmseByLoid = new Map();
  const nmseByCoordinate = new Map();
  for (const row of nmse) {
    if (row.loid) {
      const list = nmseByLoid.get(row.loid) || [];
      list.push(row);
      nmseByLoid.set(row.loid, list);
    }
    if (row.oltIp && row.coordinate) {
      const key = coordinateKey(row.oltIp, row.coordinate);
      const list = nmseByCoordinate.get(key) || [];
      list.push(row);
      nmseByCoordinate.set(key, list);
    }
    if (!row.loid && !row.coordinate) {
      conflicts.push(conflict("nmse_unassignable", row, "NMSE 用户行同时缺少 LOID 和严格坐标，无法唯一归属。"));
    }
  }

  for (const [loid, rows] of nmseByLoid) {
    if (rows.length > 1) {
      conflicts.push({
        reason: "nmse_loid_duplicate",
        oltIp: "",
        onuIndexDisplay: "",
        loid,
        detail: `NMSE LOID 重复：${loid}`
      });
    }
  }
  for (const [key, rows] of nmseByCoordinate) {
    if (rows.length > 1) {
      const [oltIp, onuIndexDisplay] = key.split("|", 2);
      conflicts.push({
        reason: "nmse_coordinate_ambiguous",
        oltIp,
        onuIndexDisplay,
        loid: "",
        detail: `NMSE 坐标对应 ${rows.length} 条记录，不能用坐标回退。`
      });
    }
  }

  const mergedRows = network.map((row) => {
    if (!row.persistable) return { ...row, usernameSource: row.username ? "network" : "none" };
    let match = null;
    if (row.loid) {
      const candidates = nmseByLoid.get(row.loid) || [];
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        conflicts.push(conflict("nmse_loid_duplicate", row, `LOID ${row.loid} 在 NMSE 中重复，姓名不猜测。`));
      }
    } else {
      const candidates = nmseByCoordinate.get(coordinateKey(row.oltIp, row));
      if (candidates?.length === 1) {
        const candidate = candidates[0];
        const loidCandidates = candidate.loid ? nmseByLoid.get(candidate.loid) || [] : [];
        if (loidCandidates.length > 1) {
          conflicts.push(conflict("nmse_loid_duplicate", row, `LOID ${candidate.loid} 在 NMSE 中重复，姓名不猜测。`));
        } else {
          match = candidate;
        }
      } else if (candidates?.length > 1) {
        conflicts.push(conflict("nmse_coordinate_ambiguous", row, "网络行缺少 LOID，严格坐标在 NMSE 中不唯一，姓名不猜测。"));
      }
    }
    if (match && !match.username) {
      conflicts.push(conflict("nmse_username_missing", row, "NMSE 唯一匹配行缺少用户姓名，保留网管二期姓名。"));
    }
    const username = mergeUsername(row, match);
    return {
      ...row,
      ...username,
      loid: row.loid || match?.loid || "",
      loidDisplay: row.loidDisplay || match?.loidDisplay || "",
      userPhone: match?.userPhone || row.userPhone || "",
      installationAddress: match?.installationAddress || row.installationAddress || "",
      nmseOltIp: match?.oltIp || "",
      nmseOnuIndex: match?.onuIndexDisplay || "",
      persistable: true
    };
  });

  const validMergedRows = mergedRows.filter((row) => row.persistable);
  return {
    rows: mergedRows,
    conflicts,
    stats: {
      networkCount: networkRows.length,
      nmseCount: nmseRows.length,
      mergedCount: validMergedRows.length,
      conflictCount: conflicts.length
    }
  };
}

function runId() {
  return `merged-onu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function syncMergedOnuDataset({
  networkRows = [],
  nmseRows = [],
  operation = "merge",
  backupReason = "merged-onu-sync",
  backup = null
} = {}) {
  const preparedBackup = backup || await backupDatabaseBeforeSync({ reason: backupReason });
  const merged = mergeOnuDatasets(networkRows, nmseRows);
  const id = runId();
  const persisted = await replaceMergedOnuDataset({
    runId: id,
    operation,
    rows: merged.rows,
    conflicts: merged.conflicts,
    networkCount: merged.stats.networkCount,
    nmseCount: merged.stats.nmseCount,
    backup: preparedBackup,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  });
  return { ...persisted, backup: preparedBackup, ...merged.stats, conflicts: merged.conflicts };
}

export const mergeNetworkAndNmseOnus = mergeOnuDatasets;
