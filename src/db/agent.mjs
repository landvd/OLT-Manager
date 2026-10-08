// Pi Agent 数字孪生、端口经验与长期记忆。
import { query, runSql, sqlQuote } from "./core.mjs";

/**
 * 读取特定 ONU 的全息数字孪生画像
 * 跨域聚合：一期 BOSS 业务属性 + 二期网管 OSS 物理设备属性 + PON 台账网络属性 + 采样历史健康属性
 */
export async function getOnuDigitalTwin({
  oltIp = "",
  chassis = "",
  board = "",
  pon = "",
  onuId = "",
  loid = "",
  serial = "",
  deviceNumber = "",
  username = "",
  phone = ""
} = {}) {
  const conditions = [];
  if (oltIp) conditions.push(`m.olt_ip = ${sqlQuote(oltIp)}`);
  if (chassis) conditions.push(`m.chassis = ${sqlQuote(chassis)}`);
  if (board) conditions.push(`m.board = ${sqlQuote(board)}`);
  if (pon) conditions.push(`m.pon = ${sqlQuote(pon)}`);
  if (onuId) conditions.push(`m.onu_id = ${sqlQuote(onuId)}`);
  if (loid) conditions.push(`(m.loid = ${sqlQuote(loid)} OR m.loid_display = ${sqlQuote(loid)})`);
  if (serial) conditions.push(`m.serial = ${sqlQuote(serial)}`);
  if (deviceNumber) conditions.push(`m.device_number = ${sqlQuote(deviceNumber)}`);
  if (username) conditions.push(`m.username = ${sqlQuote(username)}`);
  if (phone) conditions.push(`(m.user_phone = ${sqlQuote(phone)} OR r.user_phone = ${sqlQuote(phone)})`);

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const querySql = `
SELECT 
  m.*,
  o.id AS matched_olt_id,
  o.name AS olt_name,
  o.vendor AS olt_vendor,
  o.model AS olt_model,
  o.device_profile AS olt_device_profile,
  p.outer_vlan AS pon_outer_vlan,
  p.address AS pon_primary_address,
  r.username AS boss_customer_name,
  r.user_phone AS boss_phone,
  r.installation_address AS boss_installation_address,
  r.device_type AS boss_device_type,
  r.grid_rank AS boss_grid_rank
FROM merged_onu_snapshots m
LEFT JOIN olts o ON o.host = m.olt_ip
LEFT JOIN pon_ports p ON p.olt_ip = m.olt_ip AND (p.chassis = m.chassis OR p.chassis = '' OR p.chassis IS NULL) AND p.board = m.board AND p.pon = m.pon
LEFT JOIN resource_user_snapshots r ON r.olt_ip = m.olt_ip AND (r.loid = m.loid AND m.loid != '')
${whereClause}
LIMIT 1;`;

  const rows = await query(querySql);
  if (!rows || !rows.length) return null;
  const row = rows[0];

  const historyRows = await query(`
SELECT phase, rx_power, distance, last_online_time, last_offline_time, last_offline_cause, sampled_at
FROM onu_status_history
WHERE (olt_ip = ${sqlQuote(row.olt_ip)} OR olt_id = ${sqlQuote(row.matched_olt_id || "")})
  AND board = ${sqlQuote(row.board)} AND pon = ${sqlQuote(row.pon)} AND onu_id = ${sqlQuote(row.onu_id)}
ORDER BY sampled_at DESC
LIMIT 10;`);

  return {
    coordinate: {
      chassis: row.chassis,
      board: row.board,
      pon: row.pon,
      onuId: row.onu_id,
      indexDisplay: row.onu_index_display || `${row.chassis}/${row.board}/${row.pon}:${row.onu_id}`
    },
    bossBusiness: {
      customerName: row.username || row.boss_customer_name || "",
      phone: row.user_phone || row.boss_phone || "",
      installationAddress: row.installation_address || row.boss_installation_address || "",
      usernameSource: row.username_source || "network",
      gridRank: row.boss_grid_rank || "",
      nmseOltIp: row.nmse_olt_ip || "",
      nmseOnuIndex: row.nmse_onu_index || ""
    },
    ossDevice: {
      deviceNumber: row.device_number || "",
      deviceName: row.device_name || "",
      deviceType: row.device_type || row.boss_device_type || "",
      ponType: row.pon_type || "",
      serial: row.serial || "",
      loid: row.loid || "",
      mac: row.mac || ""
    },
    networkTopology: {
      oltId: row.matched_olt_id || "",
      oltName: row.olt_name || row.olt_ip || "",
      oltIp: row.olt_ip,
      vendor: row.olt_vendor || "zte",
      model: row.olt_model || "",
      deviceProfile: row.olt_device_profile || "",
      outerVlan: row.pon_outer_vlan || "",
      primaryAddress: row.pon_primary_address || ""
    },
    healthAndTelemetry: {
      phase: row.phase || "",
      currentRxPower: row.rx_power || "",
      distance: row.distance || "",
      syncedAt: row.synced_at || "",
      recentSamples: historyRows.map((h) => ({
        phase: h.phase || "",
        rxPower: h.rx_power || "",
        distance: h.distance || "",
        lastOfflineCause: h.last_offline_cause || "",
        sampledAt: h.sampled_at || ""
      }))
    }
  };
}

/**
 * 端口经验与同口规律自学习引擎
 * 统计指定 PON 口下已分配配额、VLAN 映射规律与在线光衰动态健康基线
 */
export async function getPortExperience({
  oltIp = "",
  oltId = "",
  chassis = "1",
  board = "1",
  pon = "1",
  targetOnuId = "",
  targetRxPower = null
} = {}) {
  let targetHost = oltIp;
  let targetOlt = null;
  if (oltId || targetHost) {
    const oltWhere = oltId ? `id = ${sqlQuote(oltId)}` : `host = ${sqlQuote(targetHost)}`;
    const [found] = await query(`SELECT * FROM olts WHERE ${oltWhere} LIMIT 1;`);
    if (found) {
      targetOlt = found;
      targetHost = found.host;
    }
  }

  const [portRecord] = await query(`
SELECT outer_vlan, address
FROM pon_ports
WHERE olt_ip = ${sqlQuote(targetHost)}
  AND board = ${sqlQuote(board)}
  AND pon = ${sqlQuote(pon)}
LIMIT 1;`);

  const onuRows = await query(`
SELECT chassis, board, pon, onu_id, loid, serial, username, phase, rx_power, device_type
FROM merged_onu_snapshots
WHERE olt_ip = ${sqlQuote(targetHost)}
  AND board = ${sqlQuote(board)}
  AND pon = ${sqlQuote(pon)}
ORDER BY CAST(onu_id AS INTEGER);`);

  const totalRegistered = onuRows.length;
  const allocatedIds = new Set();
  const onlineRows = [];
  const rxValues = [];

  for (const row of onuRows) {
    const idNum = Number.parseInt(row.onu_id, 10);
    if (Number.isInteger(idNum) && idNum > 0) allocatedIds.add(idNum);

    const rx = Number.parseFloat(row.rx_power);
    const hasValidRx = Number.isFinite(rx);
    const isOnline = row.phase === "online" || row.phase === "working" || hasValidRx;
    if (isOnline) {
      onlineRows.push(row);
      if (hasValidRx) rxValues.push(rx);
    }
  }

  let nextAvailableOnuId = "1";
  for (let id = 1; id <= 128; id += 1) {
    if (!allocatedIds.has(id)) {
      nextAvailableOnuId = String(id);
      break;
    }
  }

  let opticalBaseline = null;
  if (rxValues.length > 0) {
    const sum = rxValues.reduce((acc, v) => acc + v, 0);
    const avg = sum / rxValues.length;
    const sorted = [...rxValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const variance = rxValues.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / rxValues.length;
    const stdDev = Math.sqrt(variance);

    opticalBaseline = {
      sampleCount: rxValues.length,
      averageRx: Number(avg.toFixed(2)),
      medianRx: Number(median.toFixed(2)),
      strongestRx: Number(max.toFixed(2)),
      weakestRx: Number(min.toFixed(2)),
      standardDeviation: Number(stdDev.toFixed(2)),
      healthyRange: {
        lowerBound: Number((avg - Math.max(2.5, stdDev * 2)).toFixed(2)),
        upperBound: Number((avg + Math.max(2.5, stdDev * 2)).toFixed(2))
      }
    };
  }

  let targetAssessment = null;
  let evalRx = targetRxPower !== null ? Number.parseFloat(targetRxPower) : null;
  if (evalRx === null && targetOnuId) {
    const targetRow = onuRows.find((r) => String(r.onu_id) === String(targetOnuId));
    if (targetRow && Number.isFinite(Number.parseFloat(targetRow.rx_power))) {
      evalRx = Number.parseFloat(targetRow.rx_power);
    }
  }

  if (evalRx !== null && opticalBaseline) {
    const offset = evalRx - opticalBaseline.averageRx;
    const isOutlier = offset <= -3.0;
    targetAssessment = {
      evaluatedRx: evalRx,
      offsetFromAverage: Number(offset.toFixed(2)),
      isOutlier,
      verdict: isOutlier
        ? `⚠️ 显著离群劣变：该终端光衰比同口邻居均值低 ${Math.abs(offset).toFixed(1)} dB，疑似二级箱跳纤虚接或皮线急折，建议优先检修该户！`
        : `🟢 光路健康：该终端收光处于同口均值波动范围（偏离 ${offset >= 0 ? "+" : ""}${offset.toFixed(1)} dB），主干与分支正常。`
    };
  }

  const outerVlan = portRecord?.outer_vlan || "1000";
  const defaultInnerVlan = "3301";
  const vendor = targetOlt?.vendor || "zte";
  const deviceProfile = targetOlt?.device_profile || (vendor === "huawei" ? "huawei-ma5800" : "zte-c300");
  const isC600 = deviceProfile.includes("c600");
  const isHuawei = vendor.includes("huawei");

  let recommendedTemplateId = "zte-c300-self-operated-internet";
  if (isC600) recommendedTemplateId = "zte-c600-self-operated-internet";
  else if (isHuawei) recommendedTemplateId = "huawei-ma5800-self-operated-internet";

  return {
    olt: {
      id: targetOlt?.id || "",
      name: targetOlt?.name || targetHost,
      host: targetHost,
      vendor,
      deviceProfile
    },
    portCoordinate: {
      chassis,
      board,
      pon,
      display: `${chassis}/${board}/${pon}`,
      primaryAddress: portRecord?.address || ""
    },
    quotaStats: {
      maxQuota: 128,
      registeredCount: totalRegistered,
      onlineCount: onlineRows.length,
      offlineCount: totalRegistered - onlineRows.length,
      remainingQuota: Math.max(0, 128 - totalRegistered),
      nextAvailableOnuId
    },
    learnedConfigPattern: {
      recommendedTemplateId,
      recommendedParameters: {
        outerVlan,
        innerVlan: defaultInnerVlan,
        recommendedOnuId: nextAvailableOnuId,
        portMode: isC600 ? "veip_1 / hybrid" : "hybrid / tag"
      },
      summary: `基于同口历史开通规律自学习：外层 SVLAN 为 ${outerVlan}，主流自营上网内层为 ${defaultInnerVlan}，推荐配置 ID 为 ${nextAvailableOnuId}。`
    },
    opticalBaseline,
    targetAssessment
  };
}

export async function saveLearnedMemory({
  domain,
  entityKey,
  topic,
  factContent,
  antiPattern = "",
  reason = "",
  sourceContext = "",
  confidence = 1.0
} = {}) {
  const normDomain = String(domain || "general").trim().toLowerCase();
  const normEntityKey = String(entityKey || "").trim();
  const normTopic = String(topic || "").trim();
  const normFact = String(factContent || "").trim();
  if (!normDomain || !normEntityKey || !normFact) return null;

  const existingSql = `SELECT id FROM agent_learned_memories WHERE domain = ${sqlQuote(normDomain)} AND entity_key = ${sqlQuote(normEntityKey)} AND topic = ${sqlQuote(normTopic)} LIMIT 1;`;
  const existingOutput = await runSql(existingSql, { json: true });
  const [existing] = JSON.parse(existingOutput || "[]");

  if (existing?.id) {
    const updateSql = `UPDATE agent_learned_memories SET
fact_content = ${sqlQuote(normFact)},
anti_pattern = ${sqlQuote(String(antiPattern || ""))},
reason = ${sqlQuote(String(reason || ""))},
source_context = ${sqlQuote(String(sourceContext || ""))},
confidence = ${Number(confidence) || 1.0},
updated_at = CURRENT_TIMESTAMP
WHERE id = ${Number(existing.id)};
SELECT * FROM agent_learned_memories WHERE id = ${Number(existing.id)};`;
    const updatedOutput = await runSql(updateSql, { json: true });
    const [row] = JSON.parse(updatedOutput || "[]");
    return row;
  }

  const insertSql = `INSERT INTO agent_learned_memories
(domain, entity_key, topic, fact_content, anti_pattern, reason, source_context, confidence)
VALUES (${[normDomain, normEntityKey, normTopic, normFact, antiPattern, reason, sourceContext].map(sqlQuote).join(", ")}, ${Number(confidence) || 1.0});
SELECT * FROM agent_learned_memories WHERE id = last_insert_rowid();`;
  const insertOutput = await runSql(insertSql, { json: true });
  const [row] = JSON.parse(insertOutput || "[]");
  return row;
}

export async function queryLearnedMemories({
  domain = "",
  entityKeys = [],
  keywords = [],
  limit = 10
} = {}) {
  const conditions = [];
  if (domain) {
    conditions.push(`domain = ${sqlQuote(domain.toLowerCase())}`);
  }
  const keyConditions = [];
  if (Array.isArray(entityKeys) && entityKeys.length > 0) {
    const validKeys = entityKeys.map((k) => String(k || "").trim()).filter(Boolean);
    if (validKeys.length > 0) {
      keyConditions.push(`entity_key IN (${validKeys.map(sqlQuote).join(", ")})`);
    }
  }
  if (Array.isArray(keywords) && keywords.length > 0) {
    for (const kw of keywords) {
      const qkw = sqlQuote(`%${String(kw || "").trim()}%`);
      keyConditions.push(`(topic LIKE ${qkw} OR fact_content LIKE ${qkw} OR entity_key LIKE ${qkw})`);
    }
  }
  if (keyConditions.length > 0) {
    conditions.push(`(${keyConditions.join(" OR ")})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM agent_learned_memories ${whereClause} ORDER BY hit_count DESC, updated_at DESC LIMIT ${Math.max(1, Number(limit) || 10)};`;
  const output = await runSql(sql, { json: true });
  return JSON.parse(output || "[]");
}

export async function incrementMemoryHitCount(id) {
  if (!id) return;
  const sql = `UPDATE agent_learned_memories SET hit_count = hit_count + 1, last_hit_at = CURRENT_TIMESTAMP WHERE id = ${Number(id)};`;
  await runSql(sql);
}

export async function getLearnedMemories({ domain = "", limit = 50 } = {}) {
  const where = domain ? `WHERE domain = ${sqlQuote(domain.toLowerCase())}` : "";
  const sql = `SELECT * FROM agent_learned_memories ${where} ORDER BY updated_at DESC LIMIT ${Math.max(1, Number(limit) || 50)};`;
  const output = await runSql(sql, { json: true });
  return JSON.parse(output || "[]");
}

export async function deleteLearnedMemory(id) {
  if (!id) return;
  const sql = `DELETE FROM agent_learned_memories WHERE id = ${Number(id)};`;
  await runSql(sql);
}
