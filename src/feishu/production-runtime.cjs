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

function renderReply(reply) {
  if (reply?.kind === "candidate-set" || reply?.kind === "pon-candidate-set") {
    const candidates = (reply.candidates ?? []).map((candidate, index) => {
      const coordinate = candidate.onu
        ? `${candidate.onu.chassis}/${candidate.onu.board}/${candidate.onu.pon}:${candidate.onu.onuId}`
        : `${candidate.pon?.chassis}/${candidate.pon?.board}/${candidate.pon?.pon}`;
      return `${index + 1}. ${candidate.name || candidate.address || "未备注"} · ${coordinate}`;
    });
    return { msgType: "text", content: { text: candidates.join("\n") || "没有找到匹配项" } };
  }
  return { msgType: "text", content: { text: String(reply?.message || "请求已处理") } };
}

function createFeishuProductionRuntime({
  sdk,
  readSecret,
  onMessage = async () => {},
  botOpenId,
  log = () => {}
}) {
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
    return { state: connected ? "connected" : connectionState ?? state, lastError };
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
          onReconnecting: () => { state = "reconnecting"; },
          onReconnected: () => { state = "connected"; lastError = null; },
          onError: () => { state = "faulted"; lastError = "飞书长连接已断开，请重新连接"; }
        });
        const dispatcher = new sdk.EventDispatcher({}).register({
          "im.message.receive_v1": (event) => onMessage({
            kind: "message",
            event: normalizeMessage(event,
              event?.message?.chat_type !== "group" || mentionsBot(event, resolvedBotOpenId)),
            verifiedByTransport: true
          }),
          "card.action.trigger": (event) => onMessage({
            kind: "callback", event, verifiedByTransport: true
          })
        });
        await client.start({ eventDispatcher: dispatcher });
        state = "connected";
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
      const response = await apiClient.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: chatId, msg_type: rendered.msgType, content: JSON.stringify(rendered.content) }
      });
      if (response?.code) throw new Error(`Feishu send failed: ${response.code}`);
      return response?.data?.message_id ?? response?.message_id ?? null;
    },

    async listGroupMembers(chatId) {
      if (!apiClient) throw new Error("Feishu connection is not ready");
      const members = [];
      let pageToken;
      do {
        const response = await apiClient.im.chatMembers.get({
          path: { chat_id: chatId },
          params: { member_id_type: "open_id", page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) }
        });
        if (response?.code || !Array.isArray(response?.data?.items)) {
          throw new Error("incomplete group member page");
        }
        members.push(...response.data.items.map((item) => item.member_id));
        pageToken = response.data.has_more ? response.data.page_token : undefined;
        if (response.data.has_more && !pageToken) throw new Error("incomplete group member page");
      } while (pageToken);
      return members;
    },

    status,
    log
  };
}

module.exports = { createFeishuProductionRuntime, normalizeMessage, renderReply };
