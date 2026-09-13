const APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/;

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function mentionsBot(event, botOpenId) {
  return Boolean(botOpenId) && (event?.message?.mentions ?? [])
    .some((mention) => mention?.id?.open_id === botOpenId);
}

function normalizeMessage(event, mentioned) {
  const openId = event?.sender?.sender_id?.open_id;
  const message = event?.message;
  if (!event?.event_id || !openId || !message?.chat_id || message.message_type !== "text") {
    throw new Error("invalid Feishu message");
  }
  let text;
  try {
    text = JSON.parse(message.content).text;
  } catch {
    throw new Error("invalid Feishu message");
  }
  if (typeof text !== "string" || !text.trim()) throw new Error("invalid Feishu message");
  for (const mention of message.mentions ?? []) text = text.replaceAll(mention.key, "");
  return {
    eventId: event.event_id,
    kind: message.chat_type === "group" ? "group" : "direct",
    openId,
    chatId: message.chat_id,
    text: text.trim(),
    mentioned
  };
}

function normalizeCallback(event) {
  const openId = event?.operator?.open_id ?? event?.operator?.operator_id?.open_id ??
    event?.user_id?.open_id;
  const chatId = event?.open_chat_id ?? event?.context?.open_chat_id ?? event?.chat_id;
  const actionValue = event?.action?.value;
  let binding;
  try {
    binding = typeof actionValue === "string" ? JSON.parse(actionValue) : actionValue;
  } catch {
    throw new Error("invalid Feishu callback");
  }
  if (!event?.event_id || !openId || !chatId || !binding ||
      typeof binding.token !== "string" || !binding.token ||
      !Number.isInteger(binding.index) || binding.index < 0) {
    throw new Error("invalid Feishu callback");
  }
  return {
    eventId: event.event_id,
    kind: "callback",
    openId,
    chatId,
    binding: {
      token: binding.token,
      index: binding.index,
      ...(typeof binding.action === "string" ? { action: binding.action } : {}),
      ...(Number.isInteger(binding.page) ? { page: binding.page } : {}),
      ...(typeof binding.expiresAt === "string" ? { expiresAt: binding.expiresAt } : {})
    },
    messageId: event.open_message_id ?? event.context?.open_message_id ?? null
  };
}

function coordinateText(onu) {
  if (!onu) return "";
  const base = [onu.chassis, onu.board ?? onu.slot, onu.pon]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join("/");
  const onuId = onu.onuId ?? onu.onu;
  return base && onuId !== undefined && onuId !== null && onuId !== ""
    ? `${base}:${onuId}`
    : base;
}

function escapeCardText(value) {
  return String(value ?? "")
    .replace(/[\\*_`[\]]/g, "\\$&")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function displayValue(value, fallback = "未提供") {
  return value === undefined || value === null || value === ""
    ? fallback
    : escapeCardText(value);
}

function formatReadTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  if (/[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    }
  }
  return raw.replace("T", " ").replace(/\.\d+(?=Z$)/, "").replace(/Z$/, "");
}

function phaseLabel(phase) {
  return {
    working: "工作中",
    ready: "就绪",
    online: "在线",
    offline: "离线",
    dyinggasp: "掉电",
    los: "光路中断",
    losi: "光路中断",
    down: "离线",
    unknown: "未知",
    在线: "在线",
    离线: "离线"
  }[String(phase ?? "").toLowerCase()] ?? String(phase || "未知");
}

function offlineCauseCodeLabel(code) {
  return {
    1: "未知原因",
    2: "掉电",
    3: "光路中断",
    4: "帧丢失",
    8: "逻辑去激活",
    9: "设备重启",
    10: "硬件故障"
  }[Number(code)] ?? "未知原因";
}

function onlineState(phase) {
  return ["online", "working", "ready", "up", "active", "在线", "工作中", "就绪"]
    .includes(String(phase ?? "").toLowerCase());
}

function powerOffState(phase) {
  return ["dyinggasp", "掉电"].includes(String(phase ?? "").toLowerCase());
}

function rxPowerNumber(value) {
  const number = Number.parseFloat(String(value ?? "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(number) ? number : null;
}

function opticalHealth(rxPower) {
  const rx = rxPowerNumber(rxPower);
  if (rx === null) return "unknown";
  if (rx < -27) return "severe";
  if (rx <= -25) return "weak";
  return "normal";
}

function statusColor({ phase, rxPower }) {
  if (powerOffState(phase)) return "purple";
  if (!onlineState(phase)) return "black";
  const health = opticalHealth(rxPower);
  if (health === "severe") return "red";
  if (health === "weak") return "yellow";
  return "green";
}

function statusText({ phase, rxPower }) {
  if (powerOffState(phase)) return "掉电";
  if (!onlineState(phase)) return phaseLabel(phase);
  const health = opticalHealth(rxPower);
  if (health === "severe") return "不及格弱光";
  if (health === "weak") return "弱光";
  return "在线";
}

function historyPowerColor(value) {
  const health = opticalHealth(value);
  return health === "normal" ? "green"
    : health === "weak" ? "yellow"
      : health === "severe" ? "red" : "grey";
}

function historyValue(value, unit = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "未提供";
  const suffix = unit && !/[a-zA-Z]/.test(raw) ? ` ${unit}` : "";
  return `${escapeCardText(raw)}${suffix}`;
}

function historyMetric(label, value, unit, color = "grey") {
  return `<font color='grey'>${label}</font> <font color='${color}'>**${historyValue(value, unit)}**</font>`;
}

function renderRemoteHistoryRow(row) {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: [
        `<font color='grey'>${escapeCardText(formatReadTime(row.reportTime))}</font>`,
        [
          historyMetric("ONU RX", row.rxOptical, "dBm", historyPowerColor(row.rxOptical)),
          historyMetric("ONU TX", row.txOptical, "dBm"),
          historyMetric("OLT RX", row.oltRxOptical, "dBm"),
          historyMetric("衰减", row.lightDecay, "dB")
        ].join("  ·  ")
      ].join("\n")
    }
  };
}

function renderLocalHistoryRow(row) {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: [
        `<font color='grey'>${escapeCardText(formatReadTime(row.sampledAt))}</font>`,
        [
          `<font color='grey'>状态</font> **${escapeCardText(phaseLabel(row.phase))}**`,
          historyMetric("RX", row.rxPower),
          historyMetric("距离", row.distance)
        ].join("  ·  ")
      ].join("\n")
    }
  };
}

function onuIdNumber(item) {
  const value = Number(item?.onu?.onuId);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function powerHealthRank(item) {
  if (powerOffState(item?.phase)) return 0;
  if (!onlineState(item?.phase)) return 1;
  const health = opticalHealth(item?.rxPower);
  if (health === "severe") return 2;
  if (health === "weak") return 3;
  return 4;
}

function sortPonOnus(onus, mode = "power") {
  const rows = [...(onus ?? [])];
  if (mode === "onu") {
    return rows.sort((left, right) => onuIdNumber(left) - onuIdNumber(right));
  }
  return rows.sort((left, right) => {
    const health = powerHealthRank(left) - powerHealthRank(right);
    if (health !== 0) return health;
    const leftRx = rxPowerNumber(left.rxPower);
    const rightRx = rxPowerNumber(right.rxPower);
    if (leftRx !== null && rightRx !== null && leftRx !== rightRx) return leftRx - rightRx;
    if (leftRx !== null && rightRx === null) return -1;
    if (leftRx === null && rightRx !== null) return 1;
    return onuIdNumber(left) - onuIdNumber(right);
  });
}

function fieldGroup(pairs) {
  return {
    tag: "div",
    fields: pairs.map(([label, value]) => ({
      is_short: true,
      text: { tag: "lark_md", content: `**${escapeCardText(label)}**\n${value}` }
    }))
  };
}

function longField(label, value, markup = false) {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${escapeCardText(label)}**\n${markup ? value : displayValue(value)}`
    }
  };
}

function renderCandidateCard(reply) {
  const allCandidates = reply.candidates ?? [];
  const pageSize = Math.max(1, Math.min(Number(reply.pageSize) || 5, 5));
  const pagedVillage = reply.kind === "village-pon-set";
  const total = pagedVillage ? Number(reply.total ?? reply.authorizedCount ?? allCandidates.length) : allCandidates.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(reply.page) || 1), pageCount);
  const start = pagedVillage ? 0 : (page - 1) * pageSize;
  const candidates = pagedVillage ? allCandidates.slice(0, pageSize) : allCandidates.slice(start, start + pageSize);
  const isPon = reply.kind === "pon-candidate-set" || pagedVillage;
  const elements = [];
  if (!pagedVillage && reply.authorizedCount > allCandidates.length) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `共匹配 ${reply.authorizedCount} 条，当前载入前 ${allCandidates.length} 条。`
      }
    });
  }
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: pagedVillage
        ? `共匹配 ${total} 条 · 当前载入第 ${Number(reply.offset ?? 0) + 1}–${Math.min(Number(reply.offset ?? 0) + candidates.length, total)} 条 · 第 ${page}/${pageCount} 页`
        : `共匹配 ${reply.authorizedCount ?? allCandidates.length} 条 · 第 ${page}/${pageCount} 页`
    }
  });
  if (pagedVillage) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "PON 描述：含该村用户的 PON。随机抽样仅代表本次抽到的该村用户，不代表该 PON 或全村整体质量。"
      }
    });
  }
  for (const [index, candidate] of candidates.entries()) {
    const candidateIndex = pagedVillage ? index : start + index;
    const coordinate = isPon ? coordinateText(candidate.pon) : coordinateText(candidate.onu);
    const title = isPon
      ? pagedVillage
        ? `PON ${coordinate || "未知"}`
        : candidate.address || "未备注地址"
      : candidate.name || "未登记姓名";
      const secondary = isPon
        ? [
          pagedVillage && candidate.address ? `一级地址：${candidate.address}` : null,
          candidate.oltName || "已启用 OLT",
          coordinate ? `PON ${coordinate}` : null
        ].filter(Boolean).join(" · ")
      : [
          candidate.phone ? `电话：${candidate.phone}` : null,
          candidate.address ? `地址：${candidate.address}` : null,
          `${candidate.oltName || "已启用 OLT"}${coordinate ? ` · ONU ${coordinate}` : ""}`,
          candidate.snapshotAt ? `快照：${candidate.snapshotAt}` : null
        ].filter(Boolean).join("\n");
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${escapeCardText(title)}**\n${escapeCardText(secondary)}`
      }
    });
    if (pagedVillage) {
      const sampling = candidate.sampling;
      let samplingText = "正在读取该 PON 的随机在线样本及历史 ONU RX……";
      if (sampling) {
        const comparison = sampling.comparison;
        const sampleName = sampling.sample?.candidate?.name || "随机在线用户";
        if (sampling.status === "no-online") {
          samplingText = sampling.message || "该 PON 当前没有可抽样的在线村级用户。";
        } else if (comparison && Number.isFinite(comparison.current) && Number.isFinite(comparison.historical)) {
          samplingText = [
            `随机样本：${sampleName}`,
            `当前 ONU RX：${comparison.current.toFixed(2)} dBm · ${formatReadTime(comparison.currentAt)}`,
            `历史 ONU RX：${comparison.historical.toFixed(2)} dBm · ${formatReadTime(comparison.historicalAt)}`,
            `差值（当前 - 历史）：${comparison.difference.toFixed(2)} dB`,
            `历史来源：${comparison.source === "oss-ngb" ? "网管二期" : "本地只读历史"}`
          ].join("\n");
        } else {
          samplingText = [
            sampling.message || "当前或历史 ONU RX 光功率不可用，无法完成对比。",
            comparison?.current !== null && comparison?.currentAt
              ? `当前 ONU RX：${comparison.current.toFixed(2)} dBm · ${formatReadTime(comparison.currentAt)}`
              : null
          ].filter(Boolean).join("\n");
        }
      }
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: escapeCardText(samplingText)
        }
      });
    } else {
      elements.push({
        tag: "action",
        actions: [{
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: isPon ? "查看整口状态" : "查看 ONU 详情" },
          value: {
            token: reply.selection.token,
            index: candidateIndex,
            expiresAt: reply.selection.expiresAt
          }
        }]
      });
    }
  }
  if (pageCount > 1) {
    elements.push({
      tag: "action",
      actions: [
        page > 1 ? {
          tag: "button",
          type: "default",
          text: { tag: "plain_text", content: "上一页" },
          value: {
            token: reply.selection.token,
            index: 0,
            action: pagedVillage ? "village-pon-page" : "candidate-page",
            page: page - 1,
            expiresAt: reply.selection.expiresAt
          }
        } : null,
        page < pageCount ? {
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: "下一页" },
          value: {
            token: reply.selection.token,
            index: 0,
            action: pagedVillage ? "village-pon-page" : "candidate-page",
            page: page + 1,
            expiresAt: reply.selection.expiresAt
          }
        } : null
      ].filter(Boolean)
    });
  }
  return {
    msgType: "interactive",
    content: JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: pagedVillage ? "含该村用户的 PON" : isPon ? "请选择 PON 口" : "请选择匹配项" }
      },
      elements: elements.length
        ? elements
        : [{ tag: "div", text: { tag: "lark_md", content: "没有找到匹配项" } }]
    })
  };
}

function renderOpticalQueryLoading(reply) {
  const candidate = reply.candidate ?? {};
  const coordinate = coordinateText(candidate.onu ?? candidate.pon);
  const isPrimaryAddress = reply.kind === "onu-primary-address-loading";
  const isVillageSample = reply.kind === "village-pon-sample-loading";
  const title = isVillageSample ? "PON 随机样本光功率对比" : isPrimaryAddress ? "一级地址光功率查询" : "ONU 历史光功率";
  const detail = isPrimaryAddress
    ? "正在读取一级地址对应 PON 的 ONU 光功率。"
    : isVillageSample
      ? "正在读取该村用户的随机在线样本及历史 ONU RX。"
    : "正在读取网管二期历史光功率。";
  return {
    msgType: "interactive",
    content: {
      config: { wide_screen_mode: true },
      header: { template: "blue", title: { tag: "plain_text", content: title } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: [
          candidate.name ? `**${escapeCardText(candidate.name)}**` : "ONU 光功率查询",
          [
            candidate.oltName ? `设备 · ${escapeCardText(candidate.oltName)}` : null,
            coordinate ? `坐标 · ${escapeCardText(coordinate)}` : null
          ].filter(Boolean).join("  · ")
        ].filter(Boolean).join("\n") } },
        { tag: "hr" },
        { tag: "div", text: { tag: "lark_md", content: `**${detail}**` } },
        { tag: "div", text: { tag: "lark_md", content: "查询进度 · 进行中\n▰▰▰▱▱▱\n<font color='grey'>查询可能需要一些时间，请不要重复点击；完成后会自动更新本卡片。</font>" } }
      ]
    }
  };
}

function renderVillageSampleComparison(reply) {
  const candidate = reply.candidate ?? {};
  const sample = reply.sample;
  const comparison = reply.comparison;
  const pon = coordinateText(candidate.pon);
  const elements = [
    { tag: "div", text: { tag: "lark_md", content: `**含该村用户的 PON**\n${escapeCardText(pon ? `PON ${pon}` : "未提供 PON")} · ${escapeCardText(candidate.oltName || "已启用 OLT")}` } },
    { tag: "div", text: { tag: "lark_md", content: "随机抽样仅代表本次抽到的该村用户，不代表该 PON 或全村整体质量。" } }
  ];
  if (!sample?.candidate) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**${escapeCardText(reply.message || "该 PON 当前没有可抽样的在线村级用户。")}**` } });
  } else {
    const sampleName = sample.candidate.name || sample.candidate.candidateId || "随机在线用户";
    elements.push({ tag: "div", text: { tag: "lark_md", content: `随机样本：**${escapeCardText(sampleName)}** · ONU ${escapeCardText(coordinateText(sample.candidate.onu))}` } });
    if (!comparison || comparison.current === null) {
      elements.push({ tag: "div", text: { tag: "lark_md", content: "当前 ONU RX 光功率不可用，无法完成对比。" } });
    } else if (comparison.historical === null) {
      elements.push({ tag: "div", text: { tag: "lark_md", content: `当前 ONU RX：**${comparison.current.toFixed(2)} dBm**\n${escapeCardText(reply.message || "没有可用的历史 ONU RX 光功率记录。")}` } });
    } else {
      elements.push({ tag: "div", text: { tag: "lark_md", content: [
        `当前 ONU RX：**${comparison.current.toFixed(2)} dBm** · ${escapeCardText(formatReadTime(comparison.currentAt))}`,
        `历史 ONU RX：**${comparison.historical.toFixed(2)} dBm** · ${escapeCardText(formatReadTime(comparison.historicalAt))}`,
        `差值（当前 - 历史）：**${comparison.difference.toFixed(2)} dB**`,
        `历史来源：${comparison.source === "oss-ngb" ? "网管二期" : "本地只读历史"}`
      ].join("\n") } });
    }
  }
  elements.push({ tag: "div", text: { tag: "lark_md", content: "本次只比较 ONU RX 与 ONU RX，不提供阈值或整体质量结论。" } });
  return {
    msgType: "interactive",
    content: {
      config: { wide_screen_mode: true },
      header: { template: "blue", title: { tag: "plain_text", content: "PON 随机样本光功率对比" } },
      elements
    }
  };
}

function renderVillageSummaryLoading(reply) {
  return {
    msgType: "interactive",
    content: {
      config: { wide_screen_mode: true },
      header: { template: "blue", title: { tag: "plain_text", content: "村级 PON 光功率汇总" } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: `**${escapeCardText(reply.village || "村级查询")}**\n${escapeCardText(reply.message || "正在查询全部 PON 口……")}` } },
        { tag: "div", text: { tag: "lark_md", content: `匹配 PON：${Number(reply.total) || 0} 口\n查询进度 · 进行中\n▰▰▰▱▱▱\n<font color='grey'>将按每页 5 口顺序读取，完成后自动发送汇总。</font>` } }
      ]
    }
  };
}

function renderVillageSummary(reply) {
  const normal = reply.normal === true;
  const findings = reply.findings ?? [];
  const elements = [];
  if (reply.message) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**${escapeCardText(reply.message)}**` } });
  }
  if (reply.repairVerdictText) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**【抢修熔接定界判定】**\n${escapeCardText(reply.repairVerdictText)}`
      }
    });
    elements.push({ tag: "hr" });
  }
  if (Array.isArray(reply.degradedSamples) && reply.degradedSamples.length > 0) {
    const degradedLines = reply.degradedSamples.map((s, idx) => {
      const uName = s.sample?.candidate?.name || "在线用户";
      const uCoord = coordinateText(s.sample?.candidate?.onu) || "未知坐标";
      const curRx = Number.isFinite(s.current) ? `${s.current.toFixed(2)} dBm` : "未知";
      const histRx = Number.isFinite(s.historical) ? `${s.historical.toFixed(2)} dBm` : "未知";
      const diffVal = Number.isFinite(s.diff) ? `${Math.abs(s.diff).toFixed(2)} dB` : "";
      const addr = s.candidate?.address ? ` · ${s.candidate.address}` : "";
      return `${idx + 1}. **PON ${coordinateText(s.candidate?.pon)}${addr}** (样本: ${escapeCardText(uName)}):\n` +
        `   历史: ${histRx} → 抢修后: <font color='red'>**${curRx}**</font> (衰耗突增 +${diffVal}，需开盒复核)`;
    });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**⚠️ 抢修光衰突增恶化 PON 口**\n${degradedLines.join("\n")}`
      }
    });
    elements.push({ tag: "hr" });
  } else if (Array.isArray(reply.topWorstSamples) && reply.topWorstSamples.length > 0) {
    const worstLines = reply.topWorstSamples.map((s, idx) => {
      const uName = s.sample?.candidate?.name || "在线用户";
      const uCoord = coordinateText(s.sample?.candidate?.onu) || "未知坐标";
      const curRx = Number.isFinite(s.current) ? `${s.current.toFixed(2)} dBm` : "未知";
      const color = s.current < -27 ? "red" : s.current < -24 ? "orange" : "green";
      return `${idx + 1}. **${escapeCardText(uName)}** (ONU ${escapeCardText(uCoord)})：<font color='${color}'>**${curRx}**</font>`;
    });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**🎯 最差 Top ${reply.topWorstSamples.length} 弱光监测样本**\n${worstLines.join("\n")}`
      }
    });
    elements.push({ tag: "hr" });
  }
  if (!normal) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `总 PON：${Number(reply.total) || 0} 口 · 异常：${Number(reply.abnormalCount) || 0} 口 · 未完成：${Number(reply.incompleteCount) || 0} 口 · 第 ${reply.page || 1}/${reply.pageCount || 1} 页` } });
    for (const finding of findings) {
      const candidate = finding.candidate ?? {};
      const coordinate = coordinateText(candidate.pon);
      const sampling = finding.sampling ?? {};
      const comparison = sampling.comparison;
      const sampleCandidate = sampling.sample?.candidate ?? {};
      const title = `PON ${coordinate || "未知"} · ${finding.classification === "abnormal" ? "异常" : "未完成"}`;
      const details = comparison && Number.isFinite(comparison.current) && Number.isFinite(comparison.historical)
        ? [
          `当前 ONU RX：${comparison.current.toFixed(2)} dBm · ${formatReadTime(comparison.currentAt)}`,
          `历史 ONU RX：${comparison.historical.toFixed(2)} dBm · ${formatReadTime(comparison.historicalAt)}`,
          `差值（当前 - 历史）：${comparison.difference.toFixed(2)} dB`
        ].join("\n")
        : comparison && Number.isFinite(comparison.current)
          ? `当前 ONU RX：${comparison.current.toFixed(2)} dBm · ${formatReadTime(comparison.currentAt)}\n历史对比：暂无7天历史数据（实时光功率正常）`
          : (sampling.message || "当前/历史 ONU RX 光功率未完成读取。");
      const historySource = comparison?.source || sampling.history?.source;
      const sourceLabel = historySource === "oss-ngb" ? "网管二期" : historySource ? "本地只读历史" : "未读取";
      const context = [
        `一级地址：${candidate.address || candidate.primaryAddress || "暂无台账记录"}`,
        sampleCandidate.name ? `抽样用户：${sampleCandidate.name}` : (sampling.status === "no-online" ? "抽样用户：整口暂无在线用户" : "抽样用户：未提供"),
        coordinateText(sampleCandidate.onu) ? `样本 ONU 坐标：${coordinateText(sampleCandidate.onu)}` : null,
        `历史来源：${sourceLabel}`
      ].filter(Boolean).join("\n");
      elements.push({ tag: "div", text: { tag: "lark_md", content: `**${escapeCardText(title)}**\n${escapeCardText(candidate.oltName || "已启用 OLT")}\n${escapeCardText(context)}\n${escapeCardText(details)}` } });
    }
    elements.push({ tag: "div", text: { tag: "lark_md", content: "随机抽样仅代表抽到的目标村在线用户，不代表该 PON 或全村整体质量；本次仅按 ONU RX 差值展示，不提供阈值外推或整体质量结论。" } });
    if (reply.pageCount > 1 && reply.selection) {
      elements.push({
        tag: "action",
        actions: [
          reply.page > 1 ? { tag: "button", type: "default", text: { tag: "plain_text", content: "上一页" }, value: { token: reply.selection.token, index: 0, action: "village-pon-summary-page", page: reply.page - 1, expiresAt: reply.selection.expiresAt } } : null,
          reply.page < reply.pageCount ? { tag: "button", type: "primary", text: { tag: "plain_text", content: "下一页" }, value: { token: reply.selection.token, index: 0, action: "village-pon-summary-page", page: reply.page + 1, expiresAt: reply.selection.expiresAt } } : null
        ].filter(Boolean)
      });
    }
  } else {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `本次共检查：**${Number(reply.total) || 0} 口**\n全部 PON 口的抽样光功率对比均正常。` } });
    elements.push({ tag: "div", text: { tag: "lark_md", content: "<font color='grey'>说明：每个 PON 口基于一名目标村在线用户抽样，并非全量 ONU 逐一检测。</font>" } });
  }
  return {
    msgType: "interactive",
    content: {
      config: { wide_screen_mode: true },
      header: { template: normal ? "green" : "orange", title: { tag: "plain_text", content: "村级 PON 光功率汇总" } },
      elements
    }
  };
}

function formatOpticalPowerDisplay(opticalValue) {
  if (!opticalValue || opticalValue === "unknown") return "未提供";
  const num = rxPowerNumber(opticalValue);
  if (num === null) return displayValue(opticalValue);
  if (num >= -24 && num <= -8) {
    return `<font color='green'>**🟢 良好 (${num.toFixed(2)} dBm)**</font>`;
  }
  if (num < -24 && num >= -27) {
    return `<font color='orange'>**🟠 临界弱光 (${num.toFixed(2)} dBm)**</font>`;
  }
  if (num < -27) {
    return `<font color='red'>**🔴 严重弱光 (${num.toFixed(2)} dBm)**</font>`;
  }
  if (num > -8) {
    return `<font color='red'>**🔴 光饱和 (${num.toFixed(2)} dBm)**</font>`;
  }
  return displayValue(opticalValue);
}

function renderDetail(reply) {
  if (reply?.kind === "onu-detail") {
    const candidate = reply.candidate ?? {};
    const detail = reply.detail?.detail ?? {};
    const status = reply.detail?.status ?? {};
    const coordinate = coordinateText(reply.detail?.onu ?? candidate.onu);
    const phase = detail.phaseState || status.phase;
    const color = statusColor({ phase, rxPower: detail.opticalRxPower || status.rxPower });
    const online = onlineState(phase);
    const statusMarkup = `<font color='${color}'>**${escapeCardText(statusText({ phase, rxPower: detail.opticalRxPower || status.rxPower }))}**</font>`;
    const opticalValue = detail.opticalRxPower || status.rxPower || "";
    const opticalMarkup = formatOpticalPowerDisplay(opticalValue);
    const rawOfflineCause = Number.isInteger(detail.lastOfflineCauseCode)
      ? `${offlineCauseCodeLabel(detail.lastOfflineCauseCode)}（代码 ${detail.lastOfflineCauseCode}）`
      : detail.lastOfflineCause
        ? phaseLabel(detail.lastOfflineCause)
        : null;
    let offlineCauseMarkup = null;
    if (rawOfflineCause) {
      const lower = String(rawOfflineCause).toLowerCase();
      if (lower.includes("dyinggasp") || lower.includes("掉电")) {
        offlineCauseMarkup = `<font color='red'>**⚡ 用户侧掉电 (DyingGasp) · 切勿盲目上门翻光纤**</font>`;
      } else if (lower.includes("los") || lower.includes("wirecut") || lower.includes("断纤")) {
        offlineCauseMarkup = `<font color='red'>**✂️ 物理光纤断裂 (LOS) · 需带红光笔/熔接机排查**</font>`;
      } else {
        offlineCauseMarkup = `<font color='red'>**${escapeCardText(rawOfflineCause)}**</font>`;
      }
    }
    const phoneMarkup = candidate.phone
      ? `[${escapeCardText(candidate.phone)}](tel:${encodeURIComponent(candidate.phone)})`
      : "未提供";
    const elements = [
      reply.degraded
        ? { tag: "div", text: { tag: "lark_md", content: `<font color='orange'>${escapeCardText(reply.degradedReason || "实时详细字段暂不可用，以下为用户资料和可读取的实时状态。")}</font>` } }
        : null,
      { tag: "div", text: { tag: "lark_md", content: "**用户与位置**" } },
      fieldGroup([
        ["姓名", displayValue(candidate.name || detail.name || status.name)],
        ["电话", phoneMarkup],
        ["OLT", displayValue(candidate.oltName || "已启用 OLT")],
        ["ONU 坐标", displayValue(coordinate)]
      ]),
      candidate.address ? longField("装机地址", candidate.address) : null,
      candidate.primaryAddress ? longField("一级地址", candidate.primaryAddress) : null,
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "**ONU 技术状态**" } },
      fieldGroup([
        ...(candidate.deviceNumber ? [["ONU 设备号", displayValue(candidate.deviceNumber)]] : []),
        ["SN", displayValue(detail.serialNumber || status.serial || candidate.serialNumber)],
        ["LOID", displayValue(candidate.loid)],
        ["MAC", displayValue(candidate.mac)],
        ["状态", statusMarkup],
        ["接收光功率", opticalMarkup],
        ["距离", displayValue(detail.distance || status.distance)]
      ]),
      detail.lastOnlineTime || detail.lastOfflineTime
        ? fieldGroup([
            ["最近上线", formatReadTime(detail.lastOnlineTime)],
            ["最近离线", formatReadTime(detail.lastOfflineTime)]
          ])
        : null,
      offlineCauseMarkup ? longField("最后离线原因", offlineCauseMarkup, true) : null,
      candidate.snapshotAt ? longField("资料时间", `快照：${formatReadTime(candidate.snapshotAt)}`) : null,
      reply.copyLoidQuery?.token && reply.copyLoidQuery?.expiresAt
        ? {
            tag: "action",
            actions: [{
              tag: "button",
              type: "primary",
              text: { tag: "plain_text", content: "复制 LOID" },
              value: {
                token: reply.copyLoidQuery.token,
                index: 0,
                action: "onu-copy-loid",
                expiresAt: reply.copyLoidQuery.expiresAt
              }
            }]
          }
        : null,
      reply.primaryAddressQuery?.token && reply.primaryAddressQuery?.expiresAt
        ? {
            tag: "action",
            actions: [{
              tag: "button",
              type: "primary",
              text: { tag: "plain_text", content: "一级地址光功率查询" },
              value: {
                token: reply.primaryAddressQuery.token,
                index: 0,
                action: "onu-primary-address-power",
                expiresAt: reply.primaryAddressQuery.expiresAt
              }
            }]
          }
        : null,
      reply.historyQuery?.token && reply.historyQuery?.expiresAt
        ? {
            tag: "action",
            actions: [{
              tag: "button",
              type: "default",
              text: { tag: "plain_text", content: "ONU 历史光功率" },
              value: {
                token: reply.historyQuery.token,
                index: 0,
                action: "onu-history",
                expiresAt: reply.historyQuery.expiresAt
              }
            }]
          }
        : null
    ].filter(Boolean);
    return {
      msgType: "interactive",
      content: {
        config: { wide_screen_mode: true },
        header: {
          template: online ? "green" : "red",
          title: { tag: "plain_text", content: "ONU 设备详情" }
        },
        elements
      }
    };
  }
  if (reply?.kind === "pon-detail") {
    const candidate = reply.candidate ?? {};
    const detail = reply.detail ?? {};
    const sortMode = reply.sorting?.current === "onu" ? "onu" : "power";
    const sortedOnus = sortPonOnus(detail.onus, sortMode);
    const rows = sortedOnus.map((item) => {
      const color = statusColor({ phase: item.phase, rxPower: item.rxPower });
      const name = item.name ? ` · ${escapeCardText(item.name)}` : " · 未关联用户";
      const rx = item.rxPower || "unknown";
      return `ONU ${escapeCardText(item.onu?.onuId ?? "")}${name}：<font color='${color}'>**${escapeCardText(statusText({ phase: item.phase, rxPower: rx }))}**</font> · <font color='${color}'>${escapeCardText(rx)}</font>`;
    });
    const onlineCount = (detail.onus ?? []).filter((item) => onlineState(item.phase)).length;
    const weakCount = (detail.onus ?? []).filter((item) => {
      const rx = rxPowerNumber(item.rxPower);
      return onlineState(item.phase) && rx !== null && rx <= -25;
    }).length;
    const pon = coordinateText(detail.pon ?? candidate.pon);
    const totalCount = detail.onuCount ?? (detail.onus ?? []).length;
    const offlineCount = Math.max(totalCount - onlineCount, 0);
    const context = [
      candidate.address ? `🏰 **一级地址**：**${escapeCardText(candidate.address)}**` : null,
      `**设备** ${escapeCardText(candidate.oltName || "已启用 OLT")}`,
      pon ? `**PON 端口** PON ${escapeCardText(pon)}` : null,
      `**端口概况** 配线总数 ${totalCount} 户 · 在线 ${onlineCount} 户 · 弱光 ${weakCount} 户 · 离线 ${offlineCount} 户`
    ].filter(Boolean).join("\n");
    const sortActions = reply.sorting?.token && reply.sorting?.expiresAt
      ? [{
          tag: "action",
          actions: [
            {
              tag: "button",
              type: sortMode === "power" ? "primary" : "default",
              text: { tag: "plain_text", content: "按光功率排序" },
              value: {
                token: reply.sorting.token,
                index: 0,
                action: "pon-sort-power",
                expiresAt: reply.sorting.expiresAt
              }
            },
            {
              tag: "button",
              type: sortMode === "onu" ? "primary" : "default",
              text: { tag: "plain_text", content: "按 ONU ID 排序" },
              value: {
                token: reply.sorting.token,
                index: 0,
                action: "pon-sort-onu",
                expiresAt: reply.sorting.expiresAt
              }
            }
          ]
        }]
      : [];
    return {
      msgType: "interactive",
      content: {
        config: { wide_screen_mode: true },
        header: { template: "blue", title: { tag: "plain_text", content: "整口 ONU 状态大盘" } },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: context || "PON 状态" } },
          fieldGroup([
            ["ONU 总数", displayValue(totalCount, "0")],
            ["在线", `<font color='green'>**${onlineCount}**</font>`],
            ["离线", `<font color='black'>**${offlineCount}**</font>`],
            ["弱光", `<font color='yellow'>**${weakCount}**</font>`]
          ]),
          { tag: "hr" },
          { tag: "div", text: { tag: "lark_md", content: `**ONU 明细** · ${sortMode === "onu" ? "按 ONU ID 排序" : "按光功率排序"}\n${rows.join("\n") || "暂无 ONU 数据"}` } },
          { tag: "div", text: { tag: "lark_md", content: `<font color='grey'>读取时间：${formatReadTime(detail.observedAt)}</font>` } },
          ...sortActions
        ]
      }
    };
  }
  return null;
}

function renderReply(reply) {
  if (reply?.kind === "help") {
    return {
      msgType: "interactive",
      content: {
        config: { wide_screen_mode: true },
        header: { template: "blue", title: { tag: "plain_text", content: "Feishu ONU 查询帮助" } },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: reply.message || "暂无帮助内容" } },
          { tag: "hr" },
          { tag: "div", text: { tag: "lark_md", content: "<font color='grey'>🤖 OLT Manager 数字装维副驾驶 · 查用户 / 查告警 / 抢修验收 · 严格只读</font>" } }
        ]
      }
    };
  }
  if (reply?.kind === "pi-agent-answer") {
    return {
      msgType: "interactive",
      content: {
        config: { wide_screen_mode: true },
        header: { template: "indigo", title: { tag: "plain_text", content: "Pi 智能运维助手" } },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: String(reply.message || "未能获取回答") } },
          { tag: "hr" },
          { tag: "div", text: { tag: "lark_md", content: "<font color='grey'>🤖 由 Pi Agent 智能分析生成 · 建议命令仅供人工核对与手动执行 · 严格只读</font>" } }
        ]
      }
    };
  }
  if (reply?.kind === "candidate-set" || reply?.kind === "pon-candidate-set" || reply?.kind === "village-pon-set") {
    if (reply.selection?.token && reply.selection?.expiresAt) return renderCandidateCard(reply);
    const candidates = (reply.candidates ?? []).map((candidate, index) => {
      const coordinate = candidate.onu
        ? `${candidate.onu.chassis}/${candidate.onu.board}/${candidate.onu.pon}:${candidate.onu.onuId}`
        : `${candidate.pon?.chassis}/${candidate.pon?.board}/${candidate.pon?.pon}`;
      return `${index + 1}. ${candidate.name || candidate.address || "未备注"} · ${coordinate}`;
    });
    return { msgType: "text", content: { text: candidates.join("\n") || "没有找到匹配项" } };
  }
  if (reply?.kind === "onu-loid-copy") {
    return { msgType: "text", content: { text: String(reply.message || "该 ONU 未提供 LOID") } };
  }
  if (reply?.kind === "onu-history-loading" || reply?.kind === "onu-primary-address-loading") {
    return renderOpticalQueryLoading(reply);
  }
  if (reply?.kind === "village-pon-sample-loading") {
    return renderOpticalQueryLoading(reply);
  }
  if (reply?.kind === "village-pon-optical-comparison") {
    return renderVillageSampleComparison(reply);
  }
  if (reply?.kind === "village-pon-summary-loading") {
    return renderVillageSummaryLoading(reply);
  }
  if (reply?.kind === "village-pon-summary") {
    return renderVillageSummary(reply);
  }
  if (reply?.kind === "village-pon-summary-failed") {
    return { msgType: "text", content: { text: String(reply.message || "村级 PON 汇总读取失败，请稍后重试。") } };
  }
  if (reply?.kind === "onu-history") {
    const candidate = reply.candidate ?? {};
    const history = reply.history ?? {};
    const rows = Array.isArray(history.rows) ? history.rows.slice(0, 48) : [];
    const coordinate = coordinateText(history.onu ?? candidate.onu);
    const remote = history.source === "oss-ngb";
    const historyRows = rows.map((row) => remote
      ? renderRemoteHistoryRow(row)
      : renderLocalHistoryRow(row));
    const latest = rows[0];
    const latestSummary = remote && latest
      ? `**最新 ONU RX** <font color='${historyPowerColor(latest.rxOptical)}'>**${historyValue(latest.rxOptical, "dBm")}**</font>`
      : null;
    const sourceLabel = remote
      ? `<font color='blue'>网管二期实时查询</font> · ${escapeCardText(history.startDate || "-")} 至 ${escapeCardText(history.endDate || "-")}`
      : `<font color='green'>本地历史记录</font> · 最近 7 天 · 不触发刷新`;
    return {
      msgType: "interactive",
      content: {
        config: { wide_screen_mode: true },
        header: { template: remote ? "blue" : "green", title: { tag: "plain_text", content: "ONU 历史光功率" } },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: [
            candidate.name ? `**${escapeCardText(candidate.name)}**` : "ONU 历史记录",
            [
              candidate.oltName ? `设备 · ${escapeCardText(candidate.oltName)}` : null,
              coordinate ? `坐标 · ${escapeCardText(coordinate)}` : null
            ].filter(Boolean).join("  ·  ")
          ].filter(Boolean).join("\n") } },
          { tag: "div", text: { tag: "lark_md", content: `${sourceLabel} · ${rows.length}/48 条${latestSummary ? `\n${latestSummary}` : ""}` } },
          { tag: "hr" },
          ...(historyRows.length
            ? historyRows
            : [{ tag: "div", text: { tag: "lark_md", content: remote
              ? "查询范围内没有网管二期历史光功率记录。"
              : "最近 7 天没有本地历史光功率记录。" } }])
        ]
      }
    };
  }
  const detail = renderDetail(reply);
  if (detail) return detail;
  return { msgType: "text", content: { text: String(reply?.message || "请求已处理") } };
}

function createFeishuProductionRuntime({
  sdk,
  readSecret,
  onMessage,
  application,
  botOpenId,
  log = () => {}
}) {
  const longRunningCallbackActions = new Set(["onu-history", "onu-primary-address-power", "village-pon-sample", "village-pon-page"]);
  const dispatch = typeof onMessage === "function"
    ? onMessage
    : async ({ kind, event }) => {
        if (!application) return undefined;
        const verifiedEvent = { ...event, verifiedByTransport: true };
        return kind === "message"
          ? application.handleMessage(verifiedEvent)
          : application.handleCallback(verifiedEvent);
      };
  let client;
  let apiClient;
  let state = "stopped";
  let lastError = null;
  let resolvedBotOpenId = botOpenId ?? null;

  function status() {
    const connection = client?.getConnectionStatus?.();
    const connectionState = typeof connection === "string"
      ? connection : connection?.state ?? connection?.status;
    const connected = connectionState === "connected" || connection?.connected === true;
    return {
      state: connected ? "connected" : connectionState ?? state,
      lastError,
      ...(connection && typeof connection === "object" ? {
        reconnectAttempts: connection.reconnectAttempts,
        lastConnectTime: connection.lastConnectTime
      } : {})
    };
  }

  async function dispatchWithDiagnostics(kind, event) {
    try {
      log(`Feishu ${kind} received`, JSON.stringify({
        eventId: event.eventId,
        chatKind: event.kind,
        textLength: typeof event.text === "string" ? event.text.length : undefined
      }));
      const result = await dispatch({ kind, event });
      log(`Feishu ${kind} handled`, JSON.stringify({
        eventId: event.eventId,
        resultKind: result?.kind || (result?.duplicate ? "duplicate" : "")
      }));
      return result;
    } catch (error) {
      const message = error?.message || `Feishu ${kind} handling failed`;
      lastError = message;
      log(`Feishu ${kind} handling failed`, message);
      throw error;
    }
  }

  function dispatchCallback(event) {
    if (longRunningCallbackActions.has(event?.binding?.action) && event?.messageId) {
      void dispatchWithDiagnostics("callback", event).catch(() => {});
      return Promise.resolve({ kind: "callback-accepted" });
    }
    return dispatchWithDiagnostics("callback", event);
  }

  async function resolveBotOpenId() {
    if (resolvedBotOpenId || typeof apiClient?.request !== "function") return resolvedBotOpenId;
    const response = await apiClient.request({ url: "/open-apis/bot/v3/info", method: "GET" });
    resolvedBotOpenId = response?.bot?.open_id ?? response?.data?.bot?.open_id;
    if (!resolvedBotOpenId) throw new Error("Feishu bot identity unavailable");
    return resolvedBotOpenId;
  }

  return {
    async start({ appId, credentialReference }) {
      try {
        if (!APP_ID_PATTERN.test(String(appId ?? ""))) throw new Error("invalid Feishu App ID");
        const secret = await readSecret(requiredText(credentialReference, "Feishu credential reference"));
        if (!secret) throw new Error("Feishu credential unavailable");
        state = "connecting";
        lastError = null;
        client?.close?.();
        apiClient = new sdk.Client({ appId, appSecret: secret });
        await resolveBotOpenId();
        client = new sdk.WSClient({
          appId,
          appSecret: secret,
          loggerLevel: sdk.LoggerLevel?.error,
          autoReconnect: true,
          onReady: () => {
            state = "connected";
            lastError = null;
            log("Feishu long connection ready");
          },
          onReconnecting: () => {
            state = "reconnecting";
            log("Feishu long connection reconnecting");
          },
          onReconnected: () => {
            state = "connected";
            lastError = null;
            log("Feishu long connection reconnected");
          },
          onError: (error) => {
            state = "faulted";
            lastError = error?.message || "飞书长连接已断开，请重新连接";
            log("Feishu long connection error", lastError);
          }
        });
        const dispatcher = new sdk.EventDispatcher({}).register({
          "im.message.receive_v1": (event) => dispatchWithDiagnostics(
            "message",
            {
              ...normalizeMessage(event,
                event?.message?.chat_type !== "group" || mentionsBot(event, resolvedBotOpenId)),
              verifiedByTransport: true
            }
          ),
          "card.action.trigger": (event) => dispatchCallback({
            ...normalizeCallback(event),
            verifiedByTransport: true
          })
        });
        await client.start({ eventDispatcher: dispatcher });
        return status();
      } catch (error) {
        state = "faulted";
        lastError = error?.message || "Feishu connection failed";
        throw error;
      }
    },

    async stop() {
      client?.close?.();
      client = undefined;
      apiClient = undefined;
      state = "stopped";
      lastError = null;
    },

    async sendReply(chatId, reply, options = {}) {
      if (!apiClient) throw new Error("Feishu connection is not ready");
      const rendered = renderReply(reply);
      const content = typeof rendered.content === "string"
        ? rendered.content
        : JSON.stringify(rendered.content);
      try {
        if (options.replaceOriginal && options.messageId) {
          const patch = apiClient.im?.message?.patch ?? apiClient.im?.v1?.message?.patch;
          if (typeof patch === "function") {
            try {
              const response = await patch.call(apiClient.im?.message?.patch ? apiClient.im.message : apiClient.im.v1.message, {
                path: { message_id: options.messageId },
                data: { content }
              });
              if (response?.code) throw new Error(`Feishu message update failed: ${response.code}`);
              log("Feishu card updated", JSON.stringify({ messageId: options.messageId, kind: reply?.kind || "" }));
              return options.messageId;
            } catch (error) {
              log("Feishu card update failed; sending a follow-up", error?.message || "unknown error");
            }
          }
        }
        const response = await apiClient.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: { receive_id: chatId, msg_type: rendered.msgType, content }
        });
        if (response?.code) throw new Error(`Feishu send failed: ${response.code}`);
        log("Feishu reply sent", JSON.stringify({ msgType: rendered.msgType, messageId: response?.data?.message_id ?? response?.message_id ?? null }));
        return response?.data?.message_id ?? response?.message_id ?? null;
      } catch (error) {
        lastError = error?.message || "Feishu send failed";
        log("Feishu reply send failed", lastError);
        throw error;
      }
    },

    status,
    log
  };
}

module.exports = { createFeishuProductionRuntime, normalizeCallback, normalizeMessage, renderReply };
