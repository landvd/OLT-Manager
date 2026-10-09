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

function formatSourceFootnote(source) {
  if (!source) return null;
  if (source.type === "rule") {
    return "<font color='grey'>⚡ 本地规则引擎直出 (0 Token 消耗)</font>";
  }
  if (source.type === "llm") {
    const modelText = source.model ? ` (${source.model})` : "";
    return `<font color='grey'>🤖 AI 大模型驱动解析${modelText}</font>`;
  }
  if (source.type === "pi-agent") {
    return "<font color='grey'>🧠 Pi Agent 专家智能分析</font>";
  }
  return null;
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
        if (sampling.status === "all-offline") {
          samplingText = sampling.message || "该 PON 下全部用户离线，按整口断纤风险处理。";
        } else if (sampling.status === "state-incomplete") {
          samplingText = sampling.message || "ONU 状态数据不完整，不能据此认定整口离线。";
        } else if (sampling.status === "no-online") {
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
  const footnote = formatSourceFootnote(reply.interpretationSource);
  if (footnote) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: footnote }
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
      header: { template: "blue", title: { tag: "plain_text", content: `${reply.village || "村级查询"} · 抢修验收` } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: `正在检查 **${Number(reply.total) || 0}** 个 PON 口，完成后自动发送结果。\n<font color='grey'>每口约需数秒，请稍候。</font>` } }
      ]
    }
  };
}

function formatDbm(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} dBm` : "未知";
}

function shortDate(value) {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[1]}-${match[2]}` : "";
}

function personLine(person) {
  const parts = [person.name || `ONU ${person.onuId || ""}`.trim(), person.address || ""].filter(Boolean);
  return parts.map(escapeCardText).join(" · ");
}

function renderVillageRegionMenu(reply) {
  const regions = Array.isArray(reply.regions) ? reply.regions : [];
  const intro = `**${escapeCardText(reply.village || "")}** 范围较大：主要 PON 口 ${Number(reply.total) || 0} 个` +
    (reply.sparseCount ? `，另有 ${Number(reply.sparseCount)} 个零星相关口` : "") +
    "。\n请选择断纤所在的小组，只检查该小组的 PON 口：";
  const elements = [{ tag: "div", text: { tag: "lark_md", content: intro } }];
  const buttons = regions.map((region) => ({
    tag: "button",
    type: region.status === "active" ? "primary" : "default",
    text: { tag: "plain_text", content: `${region.name}（${region.userCount}户/${region.ponCount}口）` },
    value: { token: reply.selection.token, index: region.index, action: "village-region-select", expiresAt: reply.selection.expiresAt }
  }));
  for (let index = 0; index < buttons.length; index += 2) {
    elements.push({ tag: "action", actions: buttons.slice(index, index + 2) });
  }
  const nav = [
    reply.page > 1 ? { tag: "button", type: "default", text: { tag: "plain_text", content: "上一页" }, value: { token: reply.selection.token, index: 0, action: "village-region-page", page: reply.page - 1, expiresAt: reply.selection.expiresAt } } : null,
    reply.page < reply.pageCount ? { tag: "button", type: "default", text: { tag: "plain_text", content: "下一页" }, value: { token: reply.selection.token, index: 0, action: "village-region-page", page: reply.page + 1, expiresAt: reply.selection.expiresAt } } : null,
    { tag: "button", type: "danger", text: { tag: "plain_text", content: `仍然检查全部 ${Number(reply.total) || 0} 口` }, value: { token: reply.selection.token, index: 0, action: "village-region-all", expiresAt: reply.selection.expiresAt } }
  ].filter(Boolean);
  elements.push({ tag: "action", actions: nav });
  const pending = regions.some((region) => region.status !== "active");
  elements.push({ tag: "div", text: { tag: "lark_md", content: `<font color='grey'>第 ${reply.page || 1}/${reply.pageCount || 1} 页${pending ? " · 灰色按钮为系统自动识别的小组，尚待管理员审核" : ""}</font>` } });
  return {
    msgType: "interactive",
    content: {
      config: { wide_screen_mode: true },
      header: { template: "blue", title: { tag: "plain_text", content: "选择断纤小组" } },
      elements
    }
  };
}

const SUMMARY_TEMPLATES = Object.freeze({ pass: "green", warning: "red", outage: "red", isolated: "orange" });
const SUMMARY_LIST_PREVIEW = 5;
const SAMPLE_JUDGEMENT_TEXT = Object.freeze({
  "pon-degraded": "<font color='red'>多数变差，疑似光路 / 熔接问题</font>",
  "single-degraded": "<font color='orange'>只有 1 户可对比，样本不足，请人工复核</font>",
  "user-side": "个别用户变差，多半是用户侧原因",
  normal: "正常"
});

function plainVerdict(value) {
  return String(value || "").replace(/^[\u{1F300}-\u{1FAFF}☀-➿]️?\s*/u, "").trim();
}

function summaryButton(reply, label, action, extra = {}, type = "default") {
  return { tag: "button", type, text: { tag: "plain_text", content: label }, value: { token: reply.selection.token, index: 0, action, expiresAt: reply.selection.expiresAt, ...extra } };
}

function summaryFields(items) {
  return { tag: "div", fields: items.map(([value, label]) => ({ is_short: true, text: { tag: "lark_md", content: `**${value}**\n<font color='grey'>${label}</font>` } })) };
}

function degradedLine(person) {
  const delta = Number.isFinite(person.delta) ? Math.abs(person.delta).toFixed(1) : "?";
  return `${personLine(person)} · PON ${escapeCardText(coordinateText(person.pon))}\n　${formatDbm(person.before)} → <font color='red'>${formatDbm(person.after)}</font>（差 ${delta} dB）`;
}

function notRecoveredLine(person) {
  const phone = person.phone ? ` · [${escapeCardText(person.phone)}](tel:${encodeURIComponent(person.phone)})` : "";
  return `${personLine(person)}${phone} · PON ${escapeCardText(coordinateText(person.pon))}`;
}

function listBlock(title, lines, total) {
  const more = total > lines.length ? `\n<font color='grey'>…另有 ${total - lines.length} 户</font>` : "";
  return { tag: "div", text: { tag: "lark_md", content: `**${title}**\n${lines.join("\n")}${more}` } };
}

function findingLine(finding) {
  const candidate = finding.candidate ?? {};
  const where = `**PON ${escapeCardText(coordinateText(candidate.pon) || "未知")}**${candidate.address ? ` · ${escapeCardText(candidate.address)}` : ""}`;
  const repair = finding.repair;
  if (finding.classification === "outage") {
    return `${where}\n　<font color='red'>整口离线</font>：${Number(finding.sampling?.ponStatus?.configuredCount) || "全部"} 户都不在线`;
  }
  if (repair?.counts) {
    const counts = repair.counts;
    const parts = [`已恢复 ${counts.recovered}/${counts.total}`];
    if (counts.degraded) parts.push(`<font color='red'>差 2 dB 以上 ${counts.degraded} 户</font>`);
    if (counts.notRecovered) parts.push(`未恢复 ${counts.notRecovered} 户`);
    const pattern = repair.patternText ? `\n　${escapeCardText(repair.patternText)}` : "";
    return `${where}\n　${parts.join(" · ")}${pattern}`;
  }
  const samples = Array.isArray(finding.sampling?.samples) ? finding.sampling.samples : [];
  if (samples.length) {
    const degradedCount = samples.filter((item) => Number.isFinite(item.diff) && item.diff <= -2).length;
    const judgement = SAMPLE_JUDGEMENT_TEXT[finding.sampling.judgement] || "";
    const worst = samples.filter((item) => Number.isFinite(item.diff)).sort((left, right) => left.diff - right.diff)[0];
    const worstText = worst && worst.diff <= -2
      ? `\n　最差：${escapeCardText(worst.name || "在线用户")} ${formatDbm(worst.historical)} → <font color='red'>${formatDbm(worst.current)}</font>`
      : "";
    return `${where}\n　抽测 ${samples.length} 户，${degradedCount} 户比之前差 2 dB 以上${judgement ? ` · ${judgement}` : ""}${worstText}`;
  }
  const comparison = finding.sampling?.comparison;
  if (comparison && Number.isFinite(comparison.current) && Number.isFinite(comparison.historical)) {
    return `${where}\n　抽测 ${formatDbm(comparison.historical)} → ${formatDbm(comparison.current)}（${comparison.difference >= 0 ? "+" : ""}${Number(comparison.difference).toFixed(2)} dB）`;
  }
  return `${where}\n　<font color='grey'>${escapeCardText(finding.sampling?.message || "对比未完成")}</font>`;
}

// 村级抢修验收卡片：标题颜色即结论，一句话结论 + 四个关键数字；名单和逐口明细在同一张卡片里切换查看。
function renderVillageSummary(reply) {
  const view = reply.view || "overview";
  const verdict = reply.repairVerdict || (reply.normal === true ? "pass" : "warning");
  const findings = reply.findings ?? [];
  const totals = reply.repairSummary?.totals;
  const degraded = Array.isArray(reply.repairDegraded) ? reply.repairDegraded : [];
  const notRecovered = Array.isArray(reply.repairNotRecovered) ? reply.repairNotRecovered : [];
  const conclusion = plainVerdict(reply.repairVerdictText) || (reply.normal === true ? "全部 PON 口光功率对比正常。" : "");
  const elements = [];

  if (view === "people") {
    if (degraded.length) elements.push(listBlock("需要复核熔接（比断纤前差 2 dB 以上）", degraded.map(degradedLine), Number(totals?.degraded) || degraded.length));
    if (notRecovered.length) elements.push(listBlock("断纤前在线、现在未恢复", notRecovered.map(notRecoveredLine), Number(totals?.notRecovered) || notRecovered.length));
    if (!degraded.length && !notRecovered.length) elements.push({ tag: "div", text: { tag: "lark_md", content: "没有需要复核或未恢复的用户。" } });
  } else if (view === "pons") {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `<font color='grey'>需要关注的 PON 口 · 第 ${reply.page || 1}/${reply.pageCount || 1} 页</font>` } });
    elements.push({ tag: "div", text: { tag: "lark_md", content: findings.length ? findings.map(findingLine).join("\n\n") : "所有 PON 口都正常。" } });
  } else {
    if (conclusion) elements.push({ tag: "div", text: { tag: "lark_md", content: `**${escapeCardText(conclusion)}**` } });
    elements.push(totals
      ? summaryFields([
        [`${Number(reply.total) || 0} 口`, "检查范围"],
        [`${totals.recovered}/${totals.total}`, "已恢复（户）"],
        [`${totals.degraded}`, "需复核熔接（户）"],
        [`${totals.notRecovered}`, "未恢复（户）"]
      ])
      : summaryFields([
        [`${Number(reply.total) || 0} 口`, "检查范围"],
        [`${Number(reply.abnormalCount) || 0}`, "需复核（口）"],
        [`${Number(reply.outageCount) || 0}`, "整口断纤风险（口）"],
        [`${Number(reply.incompleteCount) || 0}`, "对比未完成（口）"]
      ]));
    if (degraded.length || notRecovered.length) {
      elements.push({ tag: "hr" });
      if (degraded.length) elements.push(listBlock("需要复核熔接", degraded.slice(0, SUMMARY_LIST_PREVIEW).map(degradedLine), Number(totals?.degraded) || degraded.length));
      if (notRecovered.length) elements.push(listBlock("未恢复", notRecovered.slice(0, SUMMARY_LIST_PREVIEW).map(notRecoveredLine), Number(totals?.notRecovered) || notRecovered.length));
    } else {
      const outages = findings.filter((finding) => finding.classification === "outage");
      const samples = Array.isArray(reply.degradedSamples) && reply.degradedSamples.length ? reply.degradedSamples : (reply.topWorstSamples || []);
      if (outages.length) {
        elements.push({ tag: "hr" });
        elements.push({ tag: "div", text: { tag: "lark_md", content: outages.slice(0, SUMMARY_LIST_PREVIEW).map(findingLine).join("\n") } });
      } else if (samples.length) {
        elements.push({ tag: "hr" });
        elements.push(listBlock("抽测变差的用户", samples.slice(0, 3).map((sample) =>
          `${escapeCardText(sample.sample?.candidate?.name || "在线用户")} · PON ${escapeCardText(coordinateText(sample.candidate?.pon) || coordinateText(sample.sample?.candidate?.onu))}\n　${formatDbm(sample.historical)} → <font color='red'>${formatDbm(sample.current)}</font>`), samples.length));
      }
    }
  }

  const hints = Array.isArray(reply.cableHints) ? reply.cableHints : [];
  if (hints.length && view !== "people") {
    const lines = hints.slice(0, 5).map((hint) => {
      const partners = hint.partners.slice(0, 4).map((partner) => `${escapeCardText(partner.coordinate)}${partner.address ? `（${escapeCardText(partner.address)}）` : ""}`).join("、");
      return `PON ${escapeCardText(coordinateText(hint.pon))} 历史上与 ${partners} 一起断过 ${Number(hint.together) || 0} 次以上，疑似同一条主干光缆，建议一并检查`;
    });
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**同缆提示**\n${lines.join("\n")}` } });
  }

  const notes = [];
  if (reply.repairSummary?.baselineFrom && reply.repairSummary?.baselineTo) {
    notes.push(`基线：${shortDate(reply.repairSummary.baselineFrom)} 至 ${shortDate(reply.repairSummary.baselineTo)} 夜间采集中位数`);
  }
  if (findings.some((finding) => !finding.repair && finding.classification !== "outage") || (!reply.repairSummary && reply.normal === true)) {
    notes.push("未建立夜间基线的口随机抽测 1 户，变差超过 2 dB 时加测到 5 户，随机抽样仅代表抽到的在线用户");
  }
  if (Number(reply.userSideCount) > 0) notes.push(`${Number(reply.userSideCount)} 个口只有个别用户变差（用户侧）`);
  if (reply.ponScope === "main" && Number(reply.sparseCount) > 0) notes.push(`另有 ${Number(reply.sparseCount)} 个零星相关口未检查`);
  if (notes.length) elements.push({ tag: "div", text: { tag: "lark_md", content: `<font color='grey'>${notes.join(" · ")}</font>` } });

  if (reply.selection) {
    const actions = [];
    if (view !== "overview") actions.push(summaryButton(reply, "返回概览", "village-summary-overview"));
    if (view !== "people" && (degraded.length || notRecovered.length)) actions.push(summaryButton(reply, "完整名单", "village-summary-people"));
    if (view === "pons") {
      if (reply.page > 1) actions.push(summaryButton(reply, "上一页", "village-pon-summary-page", { page: reply.page - 1 }));
      if (reply.page < reply.pageCount) actions.push(summaryButton(reply, "下一页", "village-pon-summary-page", { page: reply.page + 1 }, "primary"));
    } else if (findings.length || Number(reply.pageCount) > 1) {
      actions.push(summaryButton(reply, "按 PON 口查看", "village-pon-summary-page", { page: 1 }));
    }
    if (reply.ponScope === "main" && Number(reply.sparseCount) > 0) actions.push(summaryButton(reply, "检查零星相关口", "village-sparse-check"));
    if (actions.length) elements.push({ tag: "action", actions });
  }
  const footnote = formatSourceFootnote(reply.interpretationSource);
  if (footnote) elements.push({ tag: "div", text: { tag: "lark_md", content: footnote } });
  return {
    msgType: "interactive",
    content: {
      config: { wide_screen_mode: true },
      header: { template: SUMMARY_TEMPLATES[verdict] || "orange", title: { tag: "plain_text", content: `${reply.village || "村级查询"} · 抢修验收` } },
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
    const footnote = formatSourceFootnote(reply.interpretationSource);
    if (footnote) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: footnote }
      });
    }
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
          ...(formatSourceFootnote(reply.interpretationSource) ? [{ tag: "div", text: { tag: "lark_md", content: formatSourceFootnote(reply.interpretationSource) } }] : []),
          ...sortActions
        ]
      }
    };
  }
  return null;
}

function formatFreshnessTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 用户资料类回复末尾附上合并数据集的更新时间，过旧或最近一次同步失败时提醒现场人员。
function freshnessFootnote(freshness) {
  if (!freshness?.syncedAt) return "";
  const time = formatFreshnessTime(freshness.syncedAt);
  if (!time) return "";
  if (freshness.lastSyncFailed) return `<font color='orange'>用户资料同步于 ${time}，最近一次同步失败，资料可能不是最新</font>`;
  if (freshness.stale) return `<font color='orange'>用户资料同步于 ${time}，已超过 1 天未同步，资料可能不是最新</font>`;
  return `<font color='grey'>用户资料同步于 ${time}</font>`;
}

function renderReply(reply) {
  const rendered = renderReplyCard(reply);
  const footnote = freshnessFootnote(reply?.dataFreshness);
  if (!footnote || !rendered) return rendered;
  const element = { tag: "div", text: { tag: "lark_md", content: footnote } };
  if (rendered.msgType === "interactive" && typeof rendered.content === "string") {
    try {
      const card = JSON.parse(rendered.content);
      if (Array.isArray(card.elements)) {
        card.elements.push(element);
        rendered.content = JSON.stringify(card);
      }
    } catch {
      // 无法解析的卡片保持原样。
    }
  } else if (rendered.msgType === "interactive" && Array.isArray(rendered.content?.elements)) {
    rendered.content.elements.push(element);
  } else if (rendered.msgType === "text" && typeof rendered.content?.text === "string") {
    rendered.content.text += `\n${footnote.replace(/<[^>]+>/g, "")}`;
  }
  return rendered;
}

function renderReplyCard(reply) {
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
  if (reply?.kind === "village-region-menu") {
    return renderVillageRegionMenu(reply);
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
  // 这些按钮要在原卡片上更新或触发较长的读取：先立即应答点击，再在后台更新卡片。
  // 飞书在点击回调尚未应答时不允许改写同一张卡片，同步处理会导致翻页“点了没反应”。
  const longRunningCallbackActions = new Set([
    "onu-history", "onu-primary-address-power", "village-pon-sample", "village-pon-page",
    "village-region-select", "village-region-all", "village-sparse-check",
    "village-region-page", "village-pon-summary-page", "village-summary-people", "village-summary-overview"
  ]);
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
