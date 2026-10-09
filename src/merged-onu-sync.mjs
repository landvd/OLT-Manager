import {
  backupDatabaseBeforeSync,
  beginMergedOnuSyncRun,
  getActiveUserCorrections,
  getMergedOnuSnapshots,
  persistMergedOnuManifest,
  replaceMergedOnuDataset,
  updateMergedOnuSyncRuntime
} from "./db.mjs";
import { validateMergedInputManifest } from "./merged-onu-manifest.mjs";
import { summarizeMergedChanges } from "./merged-onu-change-summary.mjs";

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

  // 1. 优先使用已解析的明确物理维度字段（若各字段均为纯数字）
  const explicitChassis = firstText(fields, ["chassis", "CHASSIS", "frame", "FRAME"]);
  const explicitBoard = firstText(fields, ["board", "BOARD", "slot", "SLOT"]);
  const explicitPon = firstText(fields, ["pon", "PON", "port", "PORT"]);
  const explicitOnuId = firstText(fields, ["onuId", "onu_id", "ONUID", "ONU_ID"]);
  if (/^\d+$/.test(explicitChassis) && /^\d+$/.test(explicitBoard) && /^\d+$/.test(explicitPon) && /^\d+$/.test(explicitOnuId)) {
    return {
      chassis: explicitChassis,
      board: explicitBoard,
      pon: explicitPon,
      onuId: explicitOnuId,
      key: `${explicitChassis}/${explicitBoard}/${explicitPon}:${explicitOnuId}`,
      display: original || `${explicitChassis}/${explicitBoard}/${explicitPon}:${explicitOnuId}`
    };
  }

  // 2. 标准 3 级斜杠坐标：例如 1/3/12:8 或 1/3/12/8
  const match = /(?:^|\s)(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*(?::|\/)(\d+)(?:\s|$)/.exec(original);
  if (match) {
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

  // 3. 中兴复合机架/框/槽/PON坐标：例如 1/1-1-9/3:3、1/1-1-3/6:28、1-1-5/4:11
  const zteDashMatch = /(?:^|\s)(?:(\d+)\/)?(?:(\d+)[-_])?(\d+)[-_](\d+)\/(\d+)(?::|\/)(\d+)(?:\s|$)/.exec(original);
  if (zteDashMatch) {
    const chassis = zteDashMatch[2] || zteDashMatch[1] || "1";
    const board = zteDashMatch[4] || zteDashMatch[3] || "1";
    const pon = zteDashMatch[5];
    const onuId = zteDashMatch[6];
    return {
      chassis,
      board,
      pon,
      onuId,
      key: `${chassis}/${board}/${pon}:${onuId}`,
      display: original
    };
  }

  // 4. 中文机框/槽位/PON口表示法：例如 框0/槽7/端口15/OnuID67
  const chineseMatch = /(?:^|[^\d])框\s*(\d+)\s*[/_\s-]*\s*槽(?:位)?\s*(\d+)\s*[/_\s-]*\s*(?:PON\s*口?|端口?|口)\s*(\d+)\s*[/_\s-:]*\s*(?:OnuID|ONU|ONT)?\s*(\d+)(?:\D|$)/i.exec(original);
  if (chineseMatch) {
    const [, chassis, board, pon, onuId] = chineseMatch;
    return {
      chassis,
      board,
      pon,
      onuId,
      key: `${chassis}/${board}/${pon}:${onuId}`,
      display: original
    };
  }

  // 5. 冒号后为 LOID 且前面带 PON 端口的容错（如 1/1-1-5/4:DG214222L44 或 1/5/4:DG214222L44）
  const loidSuffixMatch = /(?:^|\s)(?:(\d+)\/)?(?:(\d+)[-_])?(\d+)[-_](\d+)\/(\d+):[A-Za-z0-9]+/i.exec(original);
  if (loidSuffixMatch) {
    const chassis = loidSuffixMatch[2] || loidSuffixMatch[1] || "1";
    const board = loidSuffixMatch[4] || loidSuffixMatch[3] || "1";
    const pon = loidSuffixMatch[5];
    const inferredOnuId = /^\d+$/.test(explicitOnuId) ? explicitOnuId : "0";
    return {
      chassis,
      board,
      pon,
      onuId: inferredOnuId,
      key: `${chassis}/${board}/${pon}:${inferredOnuId}`,
      display: original
    };
  }

  return null;
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
    duplicateCount: Number(row.duplicateCount || 1),
    duplicateConflicts: Array.isArray(row.duplicateConflicts) ? row.duplicateConflicts : [],
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

function conflict(reason, row, detail, { resolved = false, arbitrated = false, winner = null } = {}) {
  return {
    reason,
    oltIp: text(row?.oltIp),
    onuIndexDisplay: text(row?.onuIndexDisplay || row?.onuIndex || row?.onu_index),
    loid: normalizeMergedLoid(row?.loid),
    detail: text(detail),
    resolved,
    arbitrated,
    winner
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
  if (nmse.username.trim().length <= 1 && network.username.trim().length >= 2) {
    return { username: network.username, usernameSource: "network" };
  }
  return { username: nmse.username, usernameSource: "nmse" };
}

export function scoreNmseCandidate(candidate = {}, networkRow = {}) {
  let score = 0;
  const reasons = [];

  // 1. OLT IP 与物理坐标完全吻合（强共振）
  const candidateCoordKey = coordinateKey(candidate.oltIp, candidate.coordinate);
  const networkCoordKey = coordinateKey(networkRow.oltIp, networkRow);
  if (candidateCoordKey && networkCoordKey && candidateCoordKey === networkCoordKey) {
    score += 100;
    reasons.push("坐标完全一致(+100)");
  } else if (candidate.oltIp && networkRow.oltIp && candidate.oltIp === networkRow.oltIp) {
    score += 30;
    reasons.push("所属OLT一致(+30)");
  }

  // 2. 负面生命周期与废弃标记过滤
  const combined = `${candidate.username || ""} ${candidate.installationAddress || ""} ${candidate.onuIndexDisplay || ""}`;
  if (/(?:销户|拆机|停机|作废|测试|历史|已拆|移走)/i.test(combined)) {
    score -= 50;
    reasons.push("包含销户/测试标记(-50)");
  }

  // 3. 手机号有效性加分
  const phone = String(candidate.userPhone || "").trim();
  if (/^1[3-9]\d{9}$/.test(phone)) {
    score += 20;
    reasons.push("11位手机号(+20)");
  } else if (phone.length >= 7) {
    score += 5;
    reasons.push("有效电话(+5)");
  }

  // 4. 姓名实名完整度
  const name = String(candidate.username || "").trim();
  if (name.length >= 2 && !/(?:用户|宽带|GPON|EPON|ONU|ONT|NULL|undefined)/i.test(name)) {
    score += 15;
    reasons.push("有效实名(+15)");
  } else if (name.length > 0) {
    score += 2;
  }

  // 5. 详细装机地址加分
  const addr = String(candidate.installationAddress || "").trim();
  if (addr.length >= 6) {
    score += 10;
    reasons.push("详细地址(+10)");
  }

  // 6. 二期姓名交叉匹配加分
  const netName = String(networkRow.username || "").trim();
  if (netName && name && (name.includes(netName) || netName.includes(name))) {
    score += 25;
    reasons.push("二期姓名交叉印证(+25)");
  }

  // 7. LOID 完全匹配
  if (candidate.loid && networkRow.loid && candidate.loid === networkRow.loid) {
    score += 10;
    reasons.push("LOID一致(+10)");
  }

  return { score, reasons };
}

export function arbitrateNmseCandidates(networkRow, candidates = [], { matchType = "loid" } = {}) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return { winner: candidates[0], strategy: "唯一候选", score: 0, count: 1 };

  const scored = candidates.map((cand) => {
    const { score, reasons } = scoreNmseCandidate(cand, networkRow);
    return { candidate: cand, score, reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aLen = (a.candidate.username || "").length + (a.candidate.userPhone || "").length + (a.candidate.installationAddress || "").length;
    const bLen = (b.candidate.username || "").length + (b.candidate.userPhone || "").length + (b.candidate.installationAddress || "").length;
    return bLen - aLen;
  });

  const winnerItem = scored[0];
  const strategy = winnerItem.reasons.length > 0 ? winnerItem.reasons.join(";") : "资料完整度择优";
  return {
    winner: winnerItem.candidate,
    score: winnerItem.score,
    strategy,
    count: candidates.length
  };
}

export function mergeOnuDatasets(networkRows = [], nmseRows = []) {
  if (!Array.isArray(networkRows) || !Array.isArray(nmseRows)) throw new TypeError("合并 ONU 数据必须是数组。");

  const network = networkRows.map(normalizeNetworkRow);
  const nmse = nmseRows.map(normalizeNmseRow);
  const conflicts = [];
  const networkKeys = new Set();
  for (const row of network) {
    if (!row.persistable) {
      conflicts.push(conflict("network_coordinate_unparseable", row, "网管二期 ONU 行缺少可解析的槽/板卡/PON/ID 或 OLT 地址。", { resolved: false }));
      continue;
    }
    const key = `${row.oltIp}|${row.chassis}/${row.board}/${row.pon}:${row.onuId}`;
    if (networkKeys.has(key)) {
      const error = new Error(`网管二期 ONU 主键重复：${key}`);
      error.status = 409;
      throw error;
    }
    networkKeys.add(key);
    if (row.duplicateCount > 1) {
      const detail = row.duplicateConflicts?.length
        ? `网管二期坐标包含 ${row.duplicateCount} 条重复记录（${row.duplicateConflicts.join("；")}），已自动择优合并保留在网活跃设备。`
        : `网管二期坐标包含 ${row.duplicateCount} 条重复记录，已自动择优合并保留在网活跃设备。`;
      conflicts.push(conflict("network_coordinate_duplicate", row, detail, { resolved: true, arbitrated: true }));
    }
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
      conflicts.push(conflict("nmse_unassignable", row, "NMSE 用户行同时缺少 LOID 和严格坐标，无法唯一归属。", { resolved: false }));
    }
  }

  const matchedLoids = new Set();
  const mergedRows = network.map((row) => {
    if (!row.persistable) return { ...row, usernameSource: row.username ? "network" : "none" };
    let match = null;
    if (row.loid) {
      matchedLoids.add(row.loid);
      const candidates = nmseByLoid.get(row.loid) || [];
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        const arbitrated = arbitrateNmseCandidates(row, candidates, { matchType: "loid" });
        match = arbitrated?.winner || null;
        conflicts.push(conflict(
          "nmse_loid_duplicate",
          row,
          `LOID ${row.loid} 在 NMSE 中存在 ${candidates.length} 条记录，已按[${arbitrated.strategy}]自主裁决采纳：${arbitrated.winner?.username || "未知"} (${arbitrated.winner?.userPhone || "无电话"})，无须人工介入。`,
          { resolved: true, arbitrated: true, winner: arbitrated.winner }
        ));
      }
    } else {
      const candidates = nmseByCoordinate.get(coordinateKey(row.oltIp, row));
      if (candidates?.length === 1) {
        const candidate = candidates[0];
        const loidCandidates = candidate.loid ? nmseByLoid.get(candidate.loid) || [] : [];
        if (loidCandidates.length > 1) {
          matchedLoids.add(candidate.loid);
          const arbitrated = arbitrateNmseCandidates(row, loidCandidates, { matchType: "loid" });
          match = arbitrated?.winner || candidate;
          conflicts.push(conflict(
            "nmse_loid_duplicate",
            row,
            `坐标回退 LOID ${candidate.loid} 在 NMSE 中存在 ${loidCandidates.length} 条记录，已按[${arbitrated.strategy}]自主裁决采纳：${match?.username || "未知"}，无须人工介入。`,
            { resolved: true, arbitrated: true, winner: match }
          ));
        } else {
          match = candidate;
        }
      } else if (candidates?.length > 1) {
        const arbitrated = arbitrateNmseCandidates(row, candidates, { matchType: "coordinate" });
        match = arbitrated?.winner || null;
        conflicts.push(conflict(
          "nmse_coordinate_ambiguous",
          row,
          `网络行缺少 LOID，严格坐标在 NMSE 中匹配 ${candidates.length} 条记录，已按[${arbitrated.strategy}]自主裁决采纳：${arbitrated.winner?.username || "未知"}，无须人工介入。`,
          { resolved: true, arbitrated: true, winner: arbitrated.winner }
        ));
      }
    }
    if (match && !match.username) {
      conflicts.push(conflict("nmse_username_missing", row, "NMSE 唯一匹配行缺少用户姓名，已自动保留网管二期姓名。", { resolved: true, arbitrated: false }));
    }
    const username = mergeUsername(row, match);
    const { duplicateCount, duplicateConflicts, ...baseRow } = row;
    return {
      ...baseRow,
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

  // 对于未被任何网络设备引用的孤立 NMSE 重复记录，记录为自动忽略项（非阻断）
  for (const [loid, rows] of nmseByLoid) {
    if (rows.length > 1 && !matchedLoids.has(loid)) {
      conflicts.push(conflict(
        "nmse_loid_duplicate",
        rows[0],
        `NMSE 业务库存在 ${rows.length} 条孤立未在网的重复 LOID：${loid}，已自动忽略历史沉淀，未影响在网台账。`,
        { resolved: true, arbitrated: false }
      ));
    }
  }

  const validMergedRows = mergedRows.filter((row) => row.persistable);
  const unresolvedConflicts = conflicts.filter((c) => !c.resolved);
  const arbitratedConflicts = conflicts.filter((c) => c.arbitrated || c.resolved);

  return {
    rows: mergedRows,
    conflicts,
    stats: {
      networkCount: networkRows.length,
      nmseCount: nmseRows.length,
      mergedCount: validMergedRows.length,
      conflictCount: unresolvedConflicts.length,
      arbitratedCount: arbitratedConflicts.length,
      unresolvedCount: unresolvedConflicts.length,
      totalEvents: conflicts.length
    }
  };
}

function runId() {
  return `merged-onu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 把管理员审核通过的资料修正（按 LOID）套用到合并结果上，后通过的覆盖先通过的。 */
export function applyUserCorrections(rows = [], corrections = []) {
  const byLoid = new Map();
  for (const correction of corrections) {
    const loid = normalizeMergedLoid(correction.loid);
    if (!loid || !["userPhone", "installationAddress"].includes(correction.field)) continue;
    const entry = byLoid.get(loid) || {};
    entry[correction.field] = String(correction.value || "");
    byLoid.set(loid, entry);
  }
  let applied = 0;
  const next = rows.map((row) => {
    const patch = byLoid.get(normalizeMergedLoid(row?.loid));
    if (!patch) return row;
    applied += 1;
    return { ...row, ...patch };
  });
  return { rows: next, applied };
}

export async function syncMergedOnuDataset({
  networkRows = [],
  nmseRows = [],
  operation = "merge",
  backupReason = "merged-onu-sync",
  backup = null,
  manifest = null,
  workerId = `sync-${process.pid}`,
  runAlreadyClaimed = false,
  manageRuntime = true,
  summary = null
} = {}) {
  let validatedManifest = null;
  if (manifest !== null && manifest !== undefined) {
    const validation = validateMergedInputManifest(manifest);
    if (!validation.valid) {
      const error = new TypeError("merged ONU 同步 manifest 校验失败。");
      error.code = "INVALID_MERGED_ONU_MANIFEST";
      error.errors = validation.errors;
      throw error;
    }
    validatedManifest = validation.value;
    if (validatedManifest.sourceRowCount.network !== networkRows.length || validatedManifest.sourceRowCount.nmse !== nmseRows.length) {
      const error = new Error("merged ONU 同步行数与 manifest 不一致，已拒绝写入。");
      error.code = "MERGED_INPUT_ROW_COUNT_MISMATCH";
      throw error;
    }
  }
  const id = validatedManifest?.runId || runId();
  if (validatedManifest && !runAlreadyClaimed) {
    const claimed = await beginMergedOnuSyncRun({
      runId: id,
      operation,
      idempotencyKey: validatedManifest.idempotencyKey || "",
      workerId,
      phase: "merging"
    });
    if (claimed.duplicate) {
      return {
        duplicate: true,
        runId: claimed.run?.runId || id,
        status: claimed.run?.status || "already-exists",
        existingRun: claimed.run || null,
        manifest: validatedManifest
      };
    }
  }
  if (validatedManifest) await persistMergedOnuManifest({ runId: id, manifest: validatedManifest });
  const preparedBackup = backup || await backupDatabaseBeforeSync({ reason: backupReason });
  const merged = mergeOnuDatasets(networkRows, nmseRows);
  try {
    merged.rows = applyUserCorrections(merged.rows, await getActiveUserCorrections()).rows;
  } catch {
    // 修正建议读取失败不阻断同步，本次结果不含修正。
  }
  let changes = null;
  try {
    changes = summarizeMergedChanges(await getMergedOnuSnapshots(), merged.rows);
  } catch {
    // 变更摘要只用于展示，读取旧快照失败不影响合并提交。
  }
  const persisted = await replaceMergedOnuDataset({
    summary: { ...(summary || {}), ...(changes ? { changes } : {}) },
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
  if (validatedManifest && manageRuntime) {
    const completed = await updateMergedOnuSyncRuntime({
      runId: id,
      workerId,
      status: "success",
      phase: "complete",
      checkpoint: { status: "complete", cursor: null, updatedAt: new Date().toISOString() },
      leaseUntil: ""
    });
    if (!completed.updated) {
      const error = new Error("合并 ONU 同步租约已失效，结果未登记为可恢复完成状态。");
      error.code = "MERGED_ONU_SYNC_LEASE_LOST";
      error.status = 409;
      throw error;
    }
  }
  return { ...persisted, backup: preparedBackup, manifest: validatedManifest, ...merged.stats, conflicts: merged.conflicts, changes };
}

export const mergeNetworkAndNmseOnus = mergeOnuDatasets;
