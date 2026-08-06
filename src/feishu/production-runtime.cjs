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

function rxPowerNumber(value) {
  const number = Number.parseFloat(String(value ?? "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(number) ? number : null;
}

function statusColor({ phase, rxPower }) {
  if (!onlineState(phase)) return "red";
  const rx = rxPowerNumber(rxPower);
  if (rx !== null && rx < -28) return "red";
  if (rx !== null && rx < -25) return "orange";
  return "green";
}

function onuIdNumber(item) {
  const value = Number(item?.onu?.onuId);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function powerHealthRank(item) {
  if (!onlineState(item?.phase)) return 0;
  const rx = rxPowerNumber(item?.rxPower);
  if (rx !== null && rx < -25) return 1;
  return 2;
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
  const pageCount = Math.max(1, Math.ceil(allCandidates.length / pageSize));
  const page = Math.min(Math.max(1, Number(reply.page) || 1), pageCount);
  const start = (page - 1) * pageSize;
  const candidates = allCandidates.slice(start, start + pageSize);
  const isPon = reply.kind === "pon-candidate-set";
  const elements = [];
  if (reply.authorizedCount > allCandidates.length) {
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
      content: `共匹配 ${reply.authorizedCount ?? allCandidates.length} 条 · 第 ${page}/${pageCount} 页`
    }
  });
  for (const [index, candidate] of candidates.entries()) {
    const candidateIndex = start + index;
    const coordinate = isPon ? coordinateText(candidate.pon) : coordinateText(candidate.onu);
    const title = isPon
      ? candidate.address || "未备注地址"
      : candidate.name || "未登记姓名";
    const secondary = isPon
      ? [
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
    elements.push({
      tag: "action",
      actions: [{
        tag: "button",
        type: "primary",
        text: { tag: "plain_text", content: isPon ? "查看整口状态" : "查看 ONU 详情" },
        value: { token: reply.selection.token, index: candidateIndex, expiresAt: reply.selection.expiresAt }
      }]
    });
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
            action: "candidate-page",
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
            action: "candidate-page",
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
        title: { tag: "plain_text", content: isPon ? "请选择 PON 口" : "请选择匹配项" }
      },
      elements: elements.length
        ? elements
        : [{ tag: "div", text: { tag: "lark_md", content: "没有找到匹配项" } }]
    })
  };
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
    const statusMarkup = `<font color='${color}'>**${escapeCardText(online ? "在线" : phaseLabel(phase))}**</font>`;
    const opticalValue = detail.opticalRxPower || status.rxPower || "";
    const opticalColor = statusColor({ phase: online ? "online" : phase, rxPower: opticalValue });
    const opticalMarkup = opticalValue
      ? `<font color='${opticalColor}'>**${displayValue(opticalValue)}**</font>`
      : "未提供";
    const offlineCause = Number.isInteger(detail.lastOfflineCauseCode)
      ? `${offlineCauseCodeLabel(detail.lastOfflineCauseCode)}（代码 ${detail.lastOfflineCauseCode}）`
      : detail.lastOfflineCause
        ? phaseLabel(detail.lastOfflineCause)
        : null;
    const elements = [
      reply.degraded
        ? { tag: "div", text: { tag: "lark_md", content: `<font color='orange'>${escapeCardText(reply.degradedReason || "实时详细字段暂不可用，以下为用户资料和可读取的实时状态。")}</font>` } }
        : null,
      { tag: "div", text: { tag: "lark_md", content: "**用户与位置**" } },
      fieldGroup([
        ["姓名", displayValue(candidate.name || detail.name || status.name)],
        ["电话", displayValue(candidate.phone)],
        ["OLT", displayValue(candidate.oltName || "已启用 OLT")],
        ["ONU 坐标", displayValue(coordinate)]
      ]),
      candidate.address ? longField("装机地址", candidate.address) : null,
      candidate.primaryAddress ? longField("一级地址", candidate.primaryAddress) : null,
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "**ONU 技术状态**" } },
      fieldGroup([
        ["SN", displayValue(detail.serialNumber || status.serial || candidate.serialNumber)],
        ["LOID", displayValue(candidate.loid)],
        ["MAC", displayValue(candidate.mac)],
        ["状态", statusMarkup],
        ["接收光功率", opticalMarkup],
        ["距离", displayValue(detail.distance || status.distance)]
      ]),
      detail.lastOnlineTime || detail.lastOfflineTime
        ? fieldGroup([
            ["最近上线", displayValue(detail.lastOnlineTime)],
            ["最近离线", displayValue(detail.lastOfflineTime)]
          ])
        : null,
      offlineCause ? longField("最后离线原因", `<font color='red'>**${escapeCardText(offlineCause)}**</font>`, true) : null,
      candidate.snapshotAt ? longField("资料时间", `快照：${candidate.snapshotAt}`) : null
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
      const online = onlineState(item.phase);
      const color = statusColor({ phase: item.phase, rxPower: item.rxPower });
      const name = item.name ? ` · ${escapeCardText(item.name)}` : " · 未关联用户";
      return `ONU ${escapeCardText(item.onu?.onuId ?? "")}${name}：<font color='${color}'>**${online ? "在线" : phaseLabel(item.phase)}**</font> · ${escapeCardText(item.rxPower || "unknown")}`;
    });
    const onlineCount = (detail.onus ?? []).filter((item) => onlineState(item.phase)).length;
    const weakCount = (detail.onus ?? []).filter((item) => {
      const rx = rxPowerNumber(item.rxPower);
      return rx !== null && rx < -25;
    }).length;
    const pon = coordinateText(detail.pon ?? candidate.pon);
    const context = [
      candidate.address ? `**地址** ${escapeCardText(candidate.address)}` : null,
      `**设备** ${escapeCardText(candidate.oltName || "已启用 OLT")}`,
      pon ? `**PON 端口** PON ${escapeCardText(pon)}` : null
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
              text: { tag: "plain_text", content: "按 ONU 排序" },
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
            ["ONU 总数", displayValue(detail.onuCount ?? rows.length, "0")],
            ["在线", `<font color='green'>**${onlineCount}**</font>`],
            ["离线", `<font color='red'>**${Math.max((detail.onuCount ?? rows.length) - onlineCount, 0)}**</font>`],
            ["弱光", `<font color='orange'>**${weakCount}**</font>`]
          ]),
          ...sortActions,
          { tag: "hr" },
          { tag: "div", text: { tag: "lark_md", content: `**ONU 明细** · ${sortMode === "onu" ? "按 ONU 排序" : "按光功率排序"}\n${rows.join("\n") || "暂无 ONU 数据"}` } },
          { tag: "div", text: { tag: "lark_md", content: `<font color='grey'>读取时间：${escapeCardText(detail.observedAt || "-")}</font>` } }
        ]
      }
    };
  }
  return null;
}

function renderReply(reply) {
  if (reply?.kind === "candidate-set" || reply?.kind === "pon-candidate-set") {
    if (reply.selection?.token && reply.selection?.expiresAt) return renderCandidateCard(reply);
    const candidates = (reply.candidates ?? []).map((candidate, index) => {
      const coordinate = candidate.onu
        ? `${candidate.onu.chassis}/${candidate.onu.board}/${candidate.onu.pon}:${candidate.onu.onuId}`
        : `${candidate.pon?.chassis}/${candidate.pon?.board}/${candidate.pon?.pon}`;
      return `${index + 1}. ${candidate.name || candidate.address || "未备注"} · ${coordinate}`;
    });
    return { msgType: "text", content: { text: candidates.join("\n") || "没有找到匹配项" } };
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
          "card.action.trigger": (event) => dispatchWithDiagnostics("callback", {
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

    async sendReply(chatId, reply) {
      if (!apiClient) throw new Error("Feishu connection is not ready");
      const rendered = renderReply(reply);
      const content = typeof rendered.content === "string"
        ? rendered.content
        : JSON.stringify(rendered.content);
      try {
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
