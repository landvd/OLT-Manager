function formatOpticalPower(val) {
  if (val === null || val === undefined || val === "") return { text: "未获取", level: "unknown" };
  const num = Number(String(val).replace(/\s*dBm$/i, ""));
  if (!Number.isFinite(num) || Math.abs(num) === 65535) return { text: "未获取", level: "unknown" };
  const text = `${num.toFixed(2)} dBm`;
  if (num >= -24.0 && num <= -8.0) return { text: `🟢 ${text} (正常)`, level: "good" };
  if (num < -24.0 && num >= -27.0) return { text: `🟠 ${text} (弱光预警)`, level: "warning" };
  if (num < -27.0) return { text: `🔴 ${text} (严重弱光)`, level: "danger" };
  return { text, level: "normal" };
}

function formatTelLink(phone) {
  const clean = String(phone ?? "").trim();
  if (!clean || clean === "未提供") return "未提供";
  const numMatch = clean.match(/\d{7,12}/);
  if (numMatch) {
    return `[${clean}](tel:${numMatch[0]})`;
  }
  return clean;
}

function renderWelcomeText() {
  return [
    "👋 您好！我是 OLT Manager 智能运维助手（长连接模式）。",
    "",
    "您可以直接向我发送以下指令进行单聊查询：",
    "",
    "📌 1. 日常查单：",
    "• 输入姓名：张三",
    "• 输入手机：13800138000",
    "• 输入 LOID：LOID123456",
    "• 输入地址：厚街三屯中路12号",
    "",
    "🚨 2. 抢修与告警定位：",
    "• 查 PON 口与一级地址：172.19.104.101 3/4 或 104.101 3/4",
    "• 村级主干抢修定界：双岗村所有pon口 或 光功率 塘尾村",
    "",
    "💡 3. Pi 专家排障：",
    "• 华为LOS排查 / 流氓ONU隔离命令 / 光衰门限标准",
    "",
    "📊 4. 装维门限速查：",
    "• 正常通畅：-8.0 dBm ~ -24.0 dBm",
    "• 弱光预警：-24.0 dBm ~ -27.0 dBm",
    "• 严重故障：< -27.0 dBm"
  ].join("\n");
}

function renderHelpMarkdown() {
  return [
    "### 📖 OLT Manager 智能运维实战指南",
    "",
    "企业微信机器人已对齐飞书全部排障与台账只读能力，支持以下指令：",
    "",
    "**1. 多维极速查单（单聊直接发送）**",
    "- 查姓名：`田金水` 或 `张三`",
    "- 查手机：`13543733008` (11位完整手机号)",
    "- 查 LOID：`DG214222AOE` 或 `LOID DG214222AOE`",
    "- 查设备号：`2400030000000000` (17-24位纯数字)",
    "- 查坐标：`172.19.104.101 1/8/5:1` 或 `104.101 8/5:1`",
    "- 查地址：`广东省东莞市厚街镇汀山村坑口村` 或 `坑口`",
    "- 多匹配快捷选单：直接回复数字序号（如 `1`、`2`）即可秒开详情，回复 `下页` 翻页",
    "",
    "**2. 深度排障与时序追溯（单聊直接回复）**",
    "- 查近7天历史光衰：在查看用户后回复 `历史`，或直接发 `历史 田金水`",
    "- 查所属 PON 整口态势：在查看用户后回复 `整口`",
    "- 复制 LOID 文本：在查看用户后回复 `LOID`",
    "",
    "**3. PON 端口状态与一级地址反查**",
    "- 查 PON 口整口光衰：`172.19.104.101 8/5` 或 `104.101 8/5` (默认光衰隐患最差优先)",
    "- 切换排序：`104.101 8/5 序号排序`",
    "- 查一级地址归属：`汀山村8巷` (自动反查对应的 PON 端口及带机数)",
    "",
    "**4. 村级主干抢修熔接定界验收**",
    "- `双岗村所有pon口` 或 `光功率 汀山村`",
    "- 全村各 PON 口智能抽样，自动剔除老弱光干扰，突变恶化 $\\ge 2.0\\text{ dB}$ 精准预警",
    "",
    "**5. Pi 专家排障大模型问答**",
    "- 发送 `华为LOS故障排查`、`中兴流氓ONU隔离指南`、`光衰合格门限` 等",
    "",
    "> ℹ️ 本系统为 100% 只读安全运维，绝不向 OLT 下发任何写指令。"
  ].join("\n");
}

function renderOnuDetailMarkdown(record) {
  const user = record.user || {};
  const live = record.liveStatus || {};
  const statusObj = (typeof live.status === "object" && live.status !== null) ? live.status : {};
  const detailObj = (typeof live.detail === "object" && live.detail !== null) ? live.detail : {};

  const name = user.name || "未提供";
  const phone = formatTelLink(user.phone || user.mobile);
  const address = user.address || user.installAddress || "未提供";
  const oltIp = record.oltIp || user.oltIp || "未提供";
  const coordinate = record.coordinate || (user.board ? `${user.chassis || 1}/${user.board}/${user.pon}:${user.onuId}` : "未提供");
  
  const statusPhase = String(live.phase || statusObj.phase || detailObj.phaseState || (typeof live.status === "string" ? live.status : "") || (live.online ? "online" : "unknown")).toLowerCase();
  const offlineCause = String(live.offlineReason || live.lastDeregisterReason || detailObj.lastOfflineCause || "").toLowerCase();

  let statusBadge = "⚪ 未知";
  if (statusPhase === "working" || statusPhase === "online" || live.online === true) {
    statusBadge = "🟢 在线工作";
  } else if (offlineCause.includes("dying") || offlineCause.includes("power") || offlineCause.includes("掉电")) {
    statusBadge = "⚡ 掉电 (DyingGasp，非光路故障，切勿翻动光纤)";
  } else if (offlineCause.includes("los") || offlineCause.includes("fiber") || offlineCause.includes("断纤")) {
    statusBadge = "✂️ 断纤 (LOS，物理光路中断，需带红光笔/熔接机排查)";
  } else if (statusPhase === "offline" || live.online === false) {
    statusBadge = "🔴 离线";
  }

  const rxRaw = live.rxPower ?? live.rxOptical ?? statusObj.rxPower ?? detailObj.opticalRxPower;
  const rx = formatOpticalPower(rxRaw);
  const txRaw = live.txPower ?? statusObj.txPower ?? detailObj.opticalTxPower;
  const tx = txRaw && txRaw !== "unknown" ? `${Number(txRaw).toFixed(2)} dBm` : "未提供";
  const distanceRaw = live.distance ?? statusObj.distance ?? detailObj.distance;
  const distance = distanceRaw !== undefined && distanceRaw !== null && distanceRaw !== "unknown" ? `${distanceRaw} 米` : "未提供";

  const elements = [
    `### 👤 用户 ONU 详情：${name}`,
    "",
    `- **联系电话**：${phone}`,
    `- **装机地址**：${address}`,
    `- **所属设备**：\`${oltIp}\` (PON口坐标: \`${coordinate}\`)`,
    `- **运行状态**：${statusBadge}`,
    `- **接收光功率**：${rx.text}`,
    `- **发送光功率**：${tx}`,
    `- **测距距离**：${distance}`,
    user.loid ? `- **LOID**：\`${user.loid}\`` : "",
    user.deviceNumber ? `- **设备号**：\`${user.deviceNumber}\`` : "",
    (detailObj.lastOfflineCause || live.offlineReason) ? `- **最后离线原因**：${detailObj.lastOfflineCause || live.offlineReason}` : "",
    "",
    "---",
    "💡 **快捷排障指令**（直接回复本群/单聊即可）：",
    "- 回复 `历史`：追溯近 7 天光功率时序波动与衰耗定界报告",
    "- 回复 `整口`：查看所属 PON 端口全量用户在线与隐患排序",
    "- 回复 `LOID`：提取纯文本 LOID，手机长按即可复制"
  ];

  return elements.filter(Boolean).join("\n");
}

function renderPonStatusMarkdown({ oltIp, board, pon, areaName, onCount, offCount, total, onuerList = [], sort = "power" }) {
  const totalCount = total ?? onuerList.length;
  const on = onCount ?? 0;
  const off = offCount ?? 0;

  const sorted = [...onuerList].sort((a, b) => {
    if (sort === "onu") {
      return (Number(a.onuId) || 0) - (Number(b.onuId) || 0);
    }
    const rxA = Number(String(a.rxPower || "").replace(/\s*dBm$/i, ""));
    const rxB = Number(String(b.rxPower || "").replace(/\s*dBm$/i, ""));
    const validA = Number.isFinite(rxA);
    const validB = Number.isFinite(rxB);
    if (!a.online && b.online) return -1;
    if (a.online && !b.online) return 1;
    if (validA && validB) return rxA - rxB;
    return 0;
  });

  const weakCount = onuerList.filter((u) => {
    const num = Number(String(u.rxPower || "").replace(/\s*dBm$/i, ""));
    return Number.isFinite(num) && num < -24.0;
  }).length;

  const header = [
    `### 📍 PON 端口运行态势：${oltIp} ${board}/${pon}`,
    areaName ? `> 🏷️ **一级地址**：${areaName}` : "",
    "",
    `- **端口统计**：总计 **${totalCount}** 户 | 🟢 在线 **${on}** 户 | 🔴 离线 **${off}** 户 | 🟠 弱光 **${weakCount}** 户`,
    `- **排序模式**：${sort === "onu" ? "按 ONU 序号" : "按光衰隐患最差优先 (推荐)"}`,
    ""
  ].filter(Boolean).join("\n");

  const rows = sorted.slice(0, 30).map((onu, idx) => {
    const rx = formatOpticalPower(onu.rxPower);
    const state = onu.online ? "🟢" : "🔴";
    const name = onu.name || `ONU-${onu.onuId ?? idx + 1}`;
    const id = onu.onuId ? `:${onu.onuId}` : `#${idx + 1}`;
    return `${state} \`${id}\` **${name}** ${rx.text}`;
  });

  const footer = sorted.length > 30 ? `\n\n*(仅展示前 30 户，共 ${sorted.length} 户)*` : "";
  const tip = "\n\n💡 提示：可回复 `104.101 8/5 序号排序` 切换为按 ONU 序号排序。";
  return `${header}\n${rows.join("\n")}${footer}${tip}`;
}

function renderOnuHistoryMarkdown(user = {}, history = {}) {
  const name = user.name || "未知用户";
  const oltDisplay = user.oltIp || user.oltId || "已启用 OLT";
  const coord = user.coordinate || "未提供";
  const rows = history?.rows || history?.history || (Array.isArray(history) ? history : []);
  const source = history?.source === "oss-ngb" ? "OSS-NGB 网管历史数据" : "本地定时快照历史";

  if (rows.length === 0) {
    return [
      `### 📈 7天历史光功率追溯：${name}`,
      `- **所属设备**：\`${oltDisplay}\` (PON口坐标: \`${coord}\`)`,
      `- **数据来源**：${source}`,
      "",
      "> ℹ️ 暂无该用户近 7 天历史光功率采样记录（可能为新装用户或历史采集未覆盖）。"
    ].join("\n");
  }

  const rxValues = rows.map((r) => {
    const v = Number(String(r.rxOptical ?? r.rxPower ?? "").replace(/\s*dBm$/i, ""));
    return Number.isFinite(v) ? v : null;
  }).filter((v) => v !== null && Math.abs(v) !== 65535);

  let statsSection = "";
  if (rxValues.length > 0) {
    const maxRx = Math.max(...rxValues);
    const minRx = Math.min(...rxValues);
    const avgRx = (rxValues.reduce((a, b) => a + b, 0) / rxValues.length);
    const diff = maxRx - minRx;
    let verdict = "🟢 **光路极其平稳**（波动在正常光纤物理容限内）";
    if (diff >= 3.0) {
      verdict = "⚠️ **检测到历史光衰剧烈波动**（波动超过 3 dB，建议重点排查跳纤弯折或受损点）";
    } else if (diff >= 1.5) {
      verdict = "🟡 **存在轻度微扰**（可能受昼夜温差或室内跳纤轻微压迫）";
    }
    statsSection = [
      "- **光路稳定性分析**：",
      `  • 最高接收：\`${maxRx.toFixed(2)} dBm\``,
      `  • 最低接收：\`${minRx.toFixed(2)} dBm\``,
      `  • 平均接收：\`${avgRx.toFixed(2)} dBm\``,
      `  • 波动极差：\`${diff.toFixed(2)} dB\``,
      `  • 综合研判：${verdict}`,
      ""
    ].join("\n");
  }

  const rowLines = rows.slice(0, 15).map((r) => {
    const time = r.reportTime || r.sampledAt || "未知时间";
    const rx = r.rxOptical ?? r.rxPower ?? "未提供";
    const tx = r.txOptical ? `${r.txOptical} dBm` : "";
    const decay = r.lightDecay ? `衰减: ${r.lightDecay} dB` : "";
    const rxFmt = formatOpticalPower(rx);
    const extra = [tx ? `TX: ${tx}` : "", decay].filter(Boolean).join(" | ");
    return `- \`${time}\`：${rxFmt.text}${extra ? ` (${extra})` : ""}`;
  });

  return [
    `### 📈 7天历史光功率追溯：${name}`,
    `- **所属设备**：\`${oltDisplay}\` (坐标: \`${coord}\`)`,
    `- **数据来源**：${source}`,
    "",
    statsSection,
    "**📅 历史采样时序列表：**",
    ...rowLines,
    rows.length > 15 ? `\n*(仅展示最近 15 次采样，共 ${rows.length} 条记录)*` : "",
    "",
    "> ℹ️ 数据来自网络管理系统只读历史留存，用于定界是历史老故障还是突发抢修光衰。"
  ].filter(Boolean).join("\n");
}

function renderVillageReportMarkdown(village, summary) {
  const totalPons = summary.totalPons || 0;
  const completeCount = summary.completeCount || 0;
  const warnings = summary.degradedPons || [];

  let verdict = "";
  if (warnings.length === 0) {
    verdict = [
      "> 🟢 **主干熔接质量优秀！**",
      "> 全村各 PON 口抽测光衰均保持平稳（未检测到抢修后光衰突变恶化），主干接头盒可放心封盒收工！"
    ].join("\n");
  } else {
    verdict = [
      `> ⚠️ **检测到 ${warnings.length} 个 PON 口存在抢修光衰突变恶化！**`,
      "> 衰耗突增 $\\ge 2.0\\text{ dB}$，建议现场开盒复检熔接点损耗。"
    ].join("\n");
  }

  const warningSection = warnings.length > 0 ? [
    "",
    "**⚠️ 抢修光衰恶化突出端口：**",
    ...warnings.map((p) => {
      const delta = p.delta ? `${p.delta.toFixed(2)} dB` : "恶化";
      return `- \`${p.oltIp} ${p.slot}/${p.pon}\` (${p.area || village})：当前 \`${p.currentRx} dBm\` (较历史突增恶化 ${delta})`;
    })
  ].join("\n") : "";

  return [
    `### 🛠️ 【${village}】村级主干抢修熔接验收定界报告`,
    "",
    `- **监测范围**：覆盖该村全部 **${totalPons}** 个 PON 口`,
    `- **有效在线抽样**：**${completeCount}** 个端口光路通畅`,
    "",
    verdict,
    warningSection,
    "",
    "> 📌 算法自动消除常年室内老弱光干扰，精准聚焦抢修前后突变恶化量。"
  ].join("\n");
}

function renderPiAgentAnswerMarkdown(query, answer) {
  return [
    `### 💡 Pi 专家排障问答`,
    "",
    `**问**：${query}`,
    "",
    answer,
    "",
    "> ⚠️ 请严格遵照安全规范，并在操作前人工确认设备状态。"
  ].join("\n");
}

function renderCandidatesMarkdown(candidates = [], totalCount = 0, page = 1, pageSize = 5) {
  const total = totalCount || candidates.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const currentSlice = candidates.slice(startIdx, startIdx + pageSize);

  const lines = [
    `### 🔍 找到 ${total} 条匹配结果 (第 ${page}/${totalPages} 页)`,
    "请直接回复**数字序号**查看详情，或发送更详细关键词细化定位：",
    ""
  ];

  currentSlice.forEach((item, index) => {
    const seq = startIdx + index + 1;
    const name = item.name || "未知姓名";
    const phone = item.phone || item.mobile || "无电话";
    const addr = item.address || item.installAddress || "无地址";
    const olt = item.oltIp || "";
    const pon = item.onu ? `(${item.onu.board}/${item.onu.pon}:${item.onu.onuId})` : "";
    lines.push(`**${seq}**. **${name}** (\`${phone}\`) - \`${olt}\` ${pon}\n   📍 ${addr}`);
  });

  lines.push("", "---", "💡 **快捷选单**：");
  lines.push(`- 直接回复数字（如 \`${startIdx + 1}\`）查看对应用户实时光功率与技术资料`);
  if (page < totalPages) {
    lines.push(`- 回复 \`下页\` 或 \`第${page + 1}页\` 查看更多匹配结果`);
  }
  if (page > 1) {
    lines.push(`- 回复 \`上页\` 查看前一页`);
  }
  return lines.join("\n");
}

function renderPonCandidateListMarkdown(candidates = [], address = "", hasUserMatches = false) {
  const lines = [
    `### 📍 匹配到 ${candidates.length} 个 PON 端口 (${address})`,
    "请直接回复**数字序号**查看对应 PON 口全部用户与光功率态势：",
    ""
  ];
  candidates.slice(0, 10).forEach((item, idx) => {
    const olt = item.oltIp || item.oltName || item.oltId || "";
    const pon = `${item.pon?.board || ""}/${item.pon?.pon || ""}`;
    const addr = item.addresses?.join(" / ") || item.address || address;
    lines.push(`**${idx + 1}**. \`${olt} ${pon}\`\n   🏷️ 一级地址：${addr}`);
  });
  lines.push("", "---", "💡 **快捷操作**：");
  lines.push("- 直接回复数字（如 `1`）立即查看对应 PON 口整口在线与光衰态势");
  if (hasUserMatches) {
    lines.push(`- 若需查看该地址下的装机用户列表，请回复 \`用户 ${address}\``);
  }
  return lines.join("\n");
}

function renderLoidCopyText(user = {}) {
  const loid = user.loid || "";
  if (!loid) return `【${user.name || "该用户"}】台账中暂未登记 LOID。`;
  return `${loid}\n\n(已单独提取 LOID 文本，手机长按即可复制)`;
}

module.exports = {
  formatOpticalPower,
  formatTelLink,
  renderWelcomeText,
  renderHelpMarkdown,
  renderOnuDetailMarkdown,
  renderPonStatusMarkdown,
  renderOnuHistoryMarkdown,
  renderVillageReportMarkdown,
  renderCandidatesMarkdown,
  renderPonCandidateListMarkdown,
  renderLoidCopyText,
  renderPiAgentAnswerMarkdown
};
