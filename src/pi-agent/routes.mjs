import { json, readBody } from "../http-protocol.mjs";
import { getPiAgentConfig, updatePiAgentConfig, maskApiKey } from "./config.mjs";

export async function handlePiAgentRoutes(req, res, url, {
  piAgentEngine,
  saveBotAiConfig,
  corsHeaders = {}
} = {}) {
  const pathname = url.pathname;

  // 1. POST /api/pi-agent/chat
  if (req.method === "POST" && pathname === "/api/pi-agent/chat") {
    try {
      const payload = await readBody(req);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const context = payload.context && typeof payload.context === "object" ? payload.context : {};
      
      const result = await piAgentEngine.chat({ messages, context });
      json(res, 200, result);
      return true;
    } catch (err) {
      json(res, 500, {
        ok: false,
        error: err.message || "Pi Agent 响应失败",
        reply: `抱歉，处理您的请求时发生异常：${err.message || "未知错误"}`
      });
      return true;
    }
  }

  // 2. GET /api/pi-agent/knowledge
  if (req.method === "GET" && pathname === "/api/pi-agent/knowledge") {
    try {
      const vendor = url.searchParams.get("vendor") || "";
      const model = url.searchParams.get("model") || "";
      const category = url.searchParams.get("category") || "";
      const keyword = url.searchParams.get("q") || "";

      const entries = piAgentEngine.getKnowledgeBase({ vendor, model, category, keyword });
      json(res, 200, { ok: true, count: entries.length, rows: entries });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. GET /api/pi-agent/config
  if (req.method === "GET" && pathname === "/api/pi-agent/config") {
    try {
      const config = getPiAgentConfig();
      json(res, 200, {
        ok: true,
        anysearchApiKey: config.anysearchApiKey,
        maskedKey: maskApiKey(config.anysearchApiKey),
        updatedAt: config.updatedAt
      });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 4. POST /api/pi-agent/config
  if (req.method === "POST" && pathname === "/api/pi-agent/config") {
    try {
      const payload = await readBody(req);
      const updated = updatePiAgentConfig({
        anysearchApiKey: payload.anysearchApiKey
      });
      if (typeof saveBotAiConfig === "function") {
        await saveBotAiConfig({ anysearchApiKey: updated.anysearchApiKey }).catch(() => {});
      }
      json(res, 200, {
        ok: true,
        message: "AnySearch 配置已成功更新并持久化",
        anysearchApiKey: updated.anysearchApiKey,
        maskedKey: maskApiKey(updated.anysearchApiKey),
        updatedAt: updated.updatedAt
      });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  return false;
}
