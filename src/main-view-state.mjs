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

export function rxPowerHint(rxPower) {
  const raw = String(rxPower || "").trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return "光功率未采集或设备离线";
  if (value <= -12 && value >= -25) return `光功率正常（${raw} dBm）：处于标准接收范围（-12 ~ -25 dBm）`;
  if (value < -25 && value >= -27) return `光功率临界预警（${raw} dBm）：接近弱光门限，建议巡检法兰与尾纤`;
  if (value > -12) return `光功率过强（${raw} dBm）：可能存在近端光过载风险`;
  return `严重弱光（${raw} dBm）：超出正常接收下限（<-27 dBm），极易掉线，需排障抢修`;
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

export function inspectPonExcelImport(rawRows = [], existingPorts = []) {
  const existingSet = new Set(
    existingPorts.map((p) => `${p.oltIp || ""}|${p.chassis || ""}|${p.board || p.slot || ""}|${p.pon || ""}`.toLowerCase())
  );
  const validRows = [];
  const invalidRows = [];
  let emptyCount = 0;

  rawRows.forEach((raw, index) => {
    const lineNum = index + 2;
    const values = Object.values(raw || {}).map((v) => String(v ?? "").trim()).filter(Boolean);
    if (!values.length) {
      emptyCount += 1;
      return;
    }

    const normalized = normalizePonPortRow(raw);
    const errors = [];
    if (!normalized.oltIp) {
      errors.push("缺少 OLT IP");
    }
    if (!normalized.ponPort || !normalized.board || !normalized.pon) {
      errors.push("无法解析有效板卡或 PON 口");
    }

    if (errors.length) {
      invalidRows.push({
        line: lineNum,
        reason: errors.join("、"),
        raw
      });
    } else {
      validRows.push(normalized);
    }
  });

  let overrideCount = 0;
  let newCount = 0;
  for (const row of validRows) {
    const key = `${row.oltIp}|${row.chassis}|${row.board}|${row.pon}`.toLowerCase();
    if (existingSet.has(key)) {
      overrideCount += 1;
    } else {
      newCount += 1;
    }
  }

  return {
    totalRaw: rawRows.length,
    validRows,
    validCount: validRows.length,
    emptyCount,
    invalidRows,
    overrideCount,
    newCount
  };
}

export function diagnoseOfflineCause(causeText = "") {
  const cause = String(causeText || "").trim().toLowerCase();
  if (!cause || cause === "暂无" || cause === "n/a") {
    return { badge: "暂无离线记录", type: "info", advice: "" };
  }
  if (/dying|power|断电|停电/i.test(cause)) {
    return {
      badge: "⚡ 用户侧断电 (DyingGasp)",
      type: "success",
      advice: "物理光路正常，切勿盲目上门翻动光纤"
    };
  }
  if (/los|wire-down|link-loss|断纤|无光|折断/i.test(cause)) {
    return {
      badge: "🚨 光路物理中断 (LOS)",
      type: "danger",
      advice: "光信号丢失，通常为皮线碰折或法兰头松脱，需带红光笔上门"
    };
  }
  if (/lof|frame-loss|帧失步/i.test(cause)) {
    return {
      badge: "⚠️ 帧失步严重劣化 (LOF)",
      type: "warning",
      advice: "信号失真或反射过大，建议清洁接头端面或重做冷接"
    };
  }
  return {
    badge: `⚪ ${causeText}`,
    type: "info",
    advice: "设备已离线，可结合历史记录研判排查"
  };
}

export function analyzeHistoricalOpticalSeries(rows = []) {
  const values = rows
    .map((r) => Number.parseFloat(r.rxOptical ?? r.rx_optical))
    .filter(Number.isFinite);

  if (!values.length) {
    return { hasData: false, sampleCount: 0 };
  }

  const maxRx = Math.max(...values);
  const minRx = Math.min(...values);
  const delta = Math.abs(maxRx - minRx);
  const avgRx = values.reduce((sum, v) => sum + v, 0) / values.length;
  const degraded = delta >= 2.0;

  return {
    hasData: true,
    sampleCount: values.length,
    maxRx: `${maxRx.toFixed(2)} dBm`,
    minRx: `${minRx.toFixed(2)} dBm`,
    delta: `${delta.toFixed(2)} dB`,
    avgRx: `${avgRx.toFixed(2)} dBm`,
    degraded,
    verdict: degraded ? "⚠️ 检测到光衰突变恶化（波动 ≥ 2.0 dB），疑似近期抢修碰折或受损" : "🟢 光衰波动平稳（波动 < 2.0 dB），光路健康"
  };
}

export function buildOnuConfigTerminalCommands({ vendor = "zte", model = "", deviceProfile = "", chassis, board, slot, pon = "1", onuId = "1" } = {}) {
  const isHuawei = String(vendor || "").toLowerCase().includes("huawei");
  const isC600 = !isHuawei && (
    String(deviceProfile || "").toLowerCase().includes("c600") ||
    String(model || "").toUpperCase().includes("C600")
  );
  const safeChassis = String(chassis ?? (isHuawei ? "0" : "1")).trim();
  const safeBoard = String(board ?? slot ?? "1").trim();
  const safePon = String(pon ?? "1").trim();
  const safeOnuId = String(onuId ?? "1").trim();

  if (isHuawei) {
    return [`display current-configuration ont ${safeChassis}/${safeBoard}/${safePon} ${safeOnuId}`];
  }

  if (isC600) {
    const onuName = `gpon_onu-${safeChassis}/${safeBoard}/${safePon}:${safeOnuId}`;
    return [
      `interface ${onuName}`,
      "show this",
      "exit",
      `pon-onu-mng ${onuName}`,
      "show this",
      "exit"
    ];
  }

  const name = `gpon-onu_${safeChassis}/${safeBoard}/${safePon}:${safeOnuId}`;
  return [
    `show running-config interface ${name}`,
    `show onu running config ${name}`
  ];
}

