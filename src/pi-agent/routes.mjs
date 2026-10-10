import { json, readBody } from "../http-protocol.mjs";
import { getPiAgentConfig, updatePiAgentConfig, maskApiKey } from "./config.mjs";

export async function handlePiAgentRoutes(req, res, url, {
  piAgentEngine,
  saveBotAiConfig,
  corsHeaders = {},
  getUserCorrections = null,
  reviewUserCorrection = null,
  deleteUserCorrection = null,
  getUserCorrection = null,
  getMergedOnuSnapshots = null
} = {}) {
  const pathname = url.pathname;
  const fail = (err, fallback, status = 500) => json(res, err?.status || status, { ok: false, error: err?.message || fallback });

  // 用户资料修正建议：现场对话中纠正的电话 / 地址，按 LOID 审核后写入合并台账。
  if (pathname.startsWith("/api/pi-agent/corrections")) {
    try {
      const matchesPath = /^\/api\/pi-agent\/corrections\/(\d+)\/matches$/.exec(pathname);
      const idPath = /^\/api\/pi-agent\/corrections\/(\d+)$/.exec(pathname);
      if (req.method === "GET" && pathname === "/api/pi-agent/corrections") {
        const rows = typeof getUserCorrections === "function" ? await getUserCorrections({ status: url.searchParams.get("status") || "" }) : [];
        json(res, 200, { ok: true, count: rows.length, rows });
        return true;
      }
      if (req.method === "GET" && matchesPath) {
        const correction = typeof getUserCorrection === "function" ? await getUserCorrection(Number(matchesPath[1])) : null;
        if (!correction) throw Object.assign(new Error("修正建议不存在。"), { status: 404 });
        const rows = typeof getMergedOnuSnapshots === "function" ? await getMergedOnuSnapshots() : [];
        const matches = rows.filter((row) => String(row.username || "").trim() === correction.username).slice(0, 50).map((row) => ({
          loid: row.loid, oltIp: row.oltIp, onuIndex: row.onuIndex, username: row.username,
          userPhone: row.userPhone, installationAddress: row.installationAddress
        }));
        json(res, 200, { ok: true, matches });
        return true;
      }
      if (req.method === "PUT" && idPath && typeof reviewUserCorrection === "function") {
        const payload = await readBody(req);
        const row = await reviewUserCorrection(Number(idPath[1]), { status: payload.status, loid: payload.loid, value: payload.value });
        json(res, 200, { ok: true, row });
        return true;
      }
      if (req.method === "DELETE" && idPath && typeof deleteUserCorrection === "function") {
        await deleteUserCorrection(Number(idPath[1]));
        json(res, 200, { ok: true });
        return true;
      }
      json(res, 404, { ok: false, error: "API not found" });
    } catch (err) {
      fail(err, "资料修正建议操作失败", 400);
    }
    return true;
  }

  // 审核记忆：PUT /api/pi-agent/memories/:id
  const memoryIdPath = /^\/api\/pi-agent\/memories\/(\d+)$/.exec(pathname);
  if (req.method === "PUT" && memoryIdPath) {
    try {
      const payload = await readBody(req);
      if (typeof piAgentEngine.reviewLearnedMemory !== "function") throw Object.assign(new Error("不支持审核记忆。"), { status: 501 });
      const row = await piAgentEngine.reviewLearnedMemory(Number(memoryIdPath[1]), {
        status: payload.status, factContent: payload.factContent, antiPattern: payload.antiPattern
      });
      json(res, 200, { ok: true, row });
    } catch (err) {
      fail(err, "审核记忆失败", 400);
    }
    return true;
  }

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

  // GET /api/pi-agent/history?conversationKey=desktop:<oltId>
  if (req.method === "GET" && pathname === "/api/pi-agent/history") {
    try {
      if (typeof piAgentEngine.conversationHistory !== "function") throw Object.assign(new Error("不支持读取对话历史。"), { status: 501 });
      const result = await piAgentEngine.conversationHistory({ conversationKey: url.searchParams.get("conversationKey") || "" });
      json(res, 200, { ok: true, ...result });
    } catch (err) {
      fail(err, "读取对话历史失败", 400);
    }
    return true;
  }

  // POST /api/pi-agent/reset { conversationKey }
  if (req.method === "POST" && pathname === "/api/pi-agent/reset") {
    try {
      if (typeof piAgentEngine.resetConversation !== "function") throw Object.assign(new Error("不支持开启新对话。"), { status: 501 });
      const payload = await readBody(req);
      json(res, 200, await piAgentEngine.resetConversation({ conversationKey: payload.conversationKey }));
    } catch (err) {
      fail(err, "开启新对话失败", 400);
    }
    return true;
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

  // 5. GET /api/pi-agent/memories
  if (req.method === "GET" && pathname === "/api/pi-agent/memories") {
    try {
      const domain = url.searchParams.get("domain") || "";
      const status = url.searchParams.get("status") || "";
      const limit = Number(url.searchParams.get("limit")) || 50;
      const rows = typeof piAgentEngine.getLearnedMemories === "function"
        ? await piAgentEngine.getLearnedMemories({ domain, status, limit })
        : [];
      json(res, 200, { ok: true, count: rows.length, rows });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 6. POST /api/pi-agent/memories
  if (req.method === "POST" && pathname === "/api/pi-agent/memories") {
    try {
      const payload = await readBody(req);
      // 管理员在桌面端手动添加的规约直接生效。
      const row = typeof piAgentEngine.saveLearnedMemory === "function"
        ? await piAgentEngine.saveLearnedMemory({ ...payload, status: "active", source: "manual" })
        : null;
      json(res, 200, { ok: true, row });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 7. DELETE /api/pi-agent/memories
  if (req.method === "DELETE" && pathname.startsWith("/api/pi-agent/memories")) {
    try {
      const id = pathname.split("/").pop() || url.searchParams.get("id");
      if (typeof piAgentEngine.deleteLearnedMemory === "function" && id) {
        await piAgentEngine.deleteLearnedMemory(id);
      }
      json(res, 200, { ok: true });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  return false;
}
