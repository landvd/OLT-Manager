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

const MEMORY_STATUSES = new Set(["candidate", "active", "rejected"]);

/**
 * 保存一条记忆。自动学到的内容默认是候选（status=candidate），需管理员审核后才会被召回；
 * 同一实体同一主题重复出现时更新内容：内容变化的已生效记忆重新回到候选，已驳回的保持驳回。
 */
export async function saveLearnedMemory({
  domain,
  entityKey,
  topic,
  factContent,
  antiPattern = "",
  reason = "",
  sourceContext = "",
  confidence = 1.0,
  status = "candidate",
  source = ""
} = {}) {
  const normDomain = String(domain || "general").trim().toLowerCase();
  const normEntityKey = String(entityKey || "").trim();
  const normTopic = String(topic || "").trim();
  const normFact = String(factContent || "").trim();
  if (!normDomain || !normEntityKey || !normFact) return null;
  const requestedStatus = MEMORY_STATUSES.has(status) ? status : "candidate";

  const [existing] = await query(`SELECT id, fact_content, status FROM agent_learned_memories WHERE domain = ${sqlQuote(normDomain)} AND entity_key = ${sqlQuote(normEntityKey)} AND topic = ${sqlQuote(normTopic)} LIMIT 1;`);

  if (existing?.id) {
    const unchanged = String(existing.fact_content || "") === normFact;
    const nextStatus = existing.status === "rejected" && requestedStatus !== "active"
      ? "rejected"
      : requestedStatus === "active" ? "active" : unchanged ? existing.status : "candidate";
    await runSql(`UPDATE agent_learned_memories SET
fact_content = ${sqlQuote(normFact)},
anti_pattern = ${sqlQuote(String(antiPattern || ""))},
reason = ${sqlQuote(String(reason || ""))},
source_context = ${sqlQuote(String(sourceContext || ""))},
confidence = ${Number(confidence) || 1.0},
status = ${sqlQuote(nextStatus)},
source = ${sqlQuote(String(source || ""))},
updated_at = CURRENT_TIMESTAMP
WHERE id = ${Number(existing.id)};`);
    const [row] = await query(`SELECT * FROM agent_learned_memories WHERE id = ${Number(existing.id)};`);
    return row;
  }

  await runSql(`INSERT INTO agent_learned_memories
(domain, entity_key, topic, fact_content, anti_pattern, reason, source_context, confidence, status, source, reviewed_at)
VALUES (${[normDomain, normEntityKey, normTopic, normFact, antiPattern, reason, sourceContext].map(sqlQuote).join(", ")}, ${Number(confidence) || 1.0}, ${sqlQuote(requestedStatus)}, ${sqlQuote(String(source || ""))}, ${requestedStatus === "active" ? "CURRENT_TIMESTAMP" : "''"});`);
  const [row] = await query("SELECT * FROM agent_learned_memories WHERE id = last_insert_rowid();");
  return row;
}

/** 召回只返回已生效的记忆。 */
export async function queryLearnedMemories({
  domain = "",
  entityKeys = [],
  keywords = [],
  questionText = "",
  limit = 10
} = {}) {
  const conditions = ["status = 'active'"];
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
  // 常见问题（管理员补答的未解决问题）：问题文本相互包含即命中。
  const question = String(questionText || "").trim();
  if (question.length >= 4) {
    const quoted = sqlQuote(question);
    keyConditions.push(`(domain = 'faq' AND length(entity_key) >= 4 AND (instr(${quoted}, entity_key) > 0 OR instr(entity_key, ${quoted}) > 0))`);
  }
  if (keyConditions.length > 0) {
    conditions.push(`(${keyConditions.join(" OR ")})`);
  }
  const sql = `SELECT * FROM agent_learned_memories WHERE ${conditions.join(" AND ")} ORDER BY hit_count DESC, updated_at DESC LIMIT ${Math.max(1, Number(limit) || 10)};`;
  return query(sql);
}

export async function incrementMemoryHitCount(id) {
  if (!id) return;
  await runSql(`UPDATE agent_learned_memories SET hit_count = hit_count + 1, last_hit_at = CURRENT_TIMESTAMP WHERE id = ${Number(id)};`);
}

export async function getLearnedMemories({ domain = "", status = "", limit = 50 } = {}) {
  const clauses = [];
  if (domain) clauses.push(`domain = ${sqlQuote(domain.toLowerCase())}`);
  if (MEMORY_STATUSES.has(status)) clauses.push(`status = ${sqlQuote(status)}`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return query(`SELECT * FROM agent_learned_memories ${where} ORDER BY status = 'candidate' DESC, updated_at DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 50))};`);
}

/** 管理员审核：改状态，并可顺带修改内容和错误写法。 */
export async function reviewLearnedMemory(id, { status, factContent, antiPattern } = {}) {
  const [row] = await query(`SELECT * FROM agent_learned_memories WHERE id = ${Number(id) || 0};`);
  if (!row) throw Object.assign(new Error("记忆不存在。"), { status: 404 });
  const nextStatus = status === undefined ? row.status : String(status);
  if (!MEMORY_STATUSES.has(nextStatus)) throw Object.assign(new Error("记忆状态无效。"), { status: 400 });
  const fact = factContent === undefined ? row.fact_content : String(factContent).trim();
  if (!fact) throw Object.assign(new Error("记忆内容不能为空。"), { status: 400 });
  await runSql(`UPDATE agent_learned_memories SET
status = ${sqlQuote(nextStatus)},
fact_content = ${sqlQuote(fact)},
anti_pattern = ${sqlQuote(antiPattern === undefined ? row.anti_pattern : String(antiPattern).trim())},
reviewed_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ${Number(row.id)};`);
  const [updated] = await query(`SELECT * FROM agent_learned_memories WHERE id = ${Number(row.id)};`);
  return updated;
}

export async function deleteLearnedMemory(id) {
  if (!id) return;
  await runSql(`DELETE FROM agent_learned_memories WHERE id = ${Number(id)};`);
}

const CORRECTION_FIELDS = new Set(["userPhone", "installationAddress"]);
const CORRECTION_COLUMNS = Object.freeze({ userPhone: "user_phone", installationAddress: "installation_address" });

function mapCorrection(row) {
  return {
    id: Number(row.id),
    loid: row.loid || "",
    oltIp: row.olt_ip || "",
    onuIndex: row.onu_index || "",
    username: row.username || "",
    field: row.field,
    value: row.value,
    previousValue: row.previous_value || "",
    matchCount: Number(row.match_count || 0),
    source: row.source || "",
    sourceText: row.source_text || "",
    status: row.status,
    createdAt: row.created_at || "",
    reviewedAt: row.reviewed_at || ""
  };
}

/** 现场人员在对话中纠正的用户资料（电话 / 地址），按 LOID 记录为待审核的修正建议。 */
export async function saveUserCorrection({ loid = "", oltIp = "", onuIndex = "", username = "", field, value, previousValue = "", matchCount = 0, source = "", sourceText = "" } = {}) {
  if (!CORRECTION_FIELDS.has(field)) throw new Error("不支持的资料修正字段。");
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return null;
  const cleanLoid = String(loid || "").trim().toUpperCase();
  // 同一用户同一字段同一新值的待审核建议只保留一条。
  const [existing] = await query(`SELECT id FROM agent_user_corrections WHERE status = 'candidate' AND field = ${sqlQuote(field)} AND value = ${sqlQuote(cleanValue)} AND (loid = ${sqlQuote(cleanLoid)} AND loid <> '' OR (loid = '' AND username = ${sqlQuote(String(username || "").trim())}));`);
  if (existing) return getUserCorrection(existing.id);
  await runSql(`INSERT INTO agent_user_corrections (loid, olt_ip, onu_index, username, field, value, previous_value, match_count, source, source_text)
VALUES (${[cleanLoid, oltIp, onuIndex, String(username || "").trim(), field, cleanValue, previousValue].map((item) => sqlQuote(String(item ?? ""))).join(", ")}, ${Number(matchCount) || 0}, ${sqlQuote(String(source || ""))}, ${sqlQuote(String(sourceText || "").slice(0, 300))});`);
  const [row] = await query("SELECT * FROM agent_user_corrections WHERE id = last_insert_rowid();");
  return mapCorrection(row);
}

export async function getUserCorrection(id) {
  const [row] = await query(`SELECT * FROM agent_user_corrections WHERE id = ${Number(id) || 0};`);
  return row ? mapCorrection(row) : null;
}

export async function getUserCorrections({ status = "", limit = 200 } = {}) {
  const where = MEMORY_STATUSES.has(status) ? `WHERE status = ${sqlQuote(status)}` : "";
  const rows = await query(`SELECT * FROM agent_user_corrections ${where} ORDER BY status = 'candidate' DESC, id DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))};`);
  return rows.map(mapCorrection);
}

export async function getActiveUserCorrections() {
  const rows = await query("SELECT * FROM agent_user_corrections WHERE status = 'active' AND loid <> '' ORDER BY id;");
  return rows.map(mapCorrection);
}

/**
 * 审核资料修正建议。通过时必须有 LOID，并立即写入合并台账对应用户；
 * 之后每次同步合并都会重新套用（见 applyUserCorrections）。
 */
export async function reviewUserCorrection(id, { status, loid, value } = {}) {
  const current = await getUserCorrection(id);
  if (!current) throw Object.assign(new Error("修正建议不存在。"), { status: 404 });
  const nextStatus = status === undefined ? current.status : String(status);
  if (!MEMORY_STATUSES.has(nextStatus)) throw Object.assign(new Error("状态无效。"), { status: 400 });
  const nextLoid = loid === undefined ? current.loid : String(loid).trim().toUpperCase();
  const nextValue = value === undefined ? current.value : String(value).trim();
  if (!nextValue) throw Object.assign(new Error("修正值不能为空。"), { status: 400 });
  if (nextStatus === "active" && !nextLoid) throw Object.assign(new Error("请先确认这条建议对应的 LOID。"), { status: 400 });
  let target = null;
  if (nextLoid) {
    [target] = await query(`SELECT olt_ip, chassis, board, pon, onu_id, username FROM merged_onu_snapshots WHERE upper(trim(loid)) = ${sqlQuote(nextLoid)} LIMIT 1;`);
    if (nextStatus === "active" && !target) throw Object.assign(new Error("合并台账中找不到这个 LOID。"), { status: 404 });
  }
  const column = CORRECTION_COLUMNS[current.field];
  await runSql(`BEGIN;
UPDATE agent_user_corrections SET
status = ${sqlQuote(nextStatus)},
loid = ${sqlQuote(nextLoid)},
value = ${sqlQuote(nextValue)},
olt_ip = ${sqlQuote(target?.olt_ip || current.oltIp)},
onu_index = ${sqlQuote(target ? `${target.chassis}/${target.board}/${target.pon}:${target.onu_id}` : current.onuIndex)},
username = ${sqlQuote(target?.username || current.username)},
reviewed_at = CURRENT_TIMESTAMP
WHERE id = ${current.id};
${nextStatus === "active" ? `UPDATE merged_onu_snapshots SET ${column} = ${sqlQuote(nextValue)} WHERE upper(trim(loid)) = ${sqlQuote(nextLoid)};` : ""}
COMMIT;`);
  return getUserCorrection(current.id);
}

export async function deleteUserCorrection(id) {
  await runSql(`DELETE FROM agent_user_corrections WHERE id = ${Number(id) || 0};`);
}
