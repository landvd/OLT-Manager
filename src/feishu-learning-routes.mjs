// 飞书查询日志与学习建议的本地管理接口。只读写本地 SQLite。
const USER_PATH = /^\/api\/feishu-users\/([^/]+)$/;
const SUGGESTION_PATH = /^\/api\/feishu-learning\/suggestions\/(\d+)$/;

export async function handleFeishuLearningRoutes(req, res, url, {
  getFeishuQueryLogs,
  getFeishuQueryStats,
  setFeishuUserName,
  getFeishuLearningSuggestions,
  upsertFeishuLearningSuggestion,
  reviewFeishuLearningSuggestion,
  deleteFeishuLearningSuggestion,
  feishuLearning,
  readBody,
  json
} = {}) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/feishu-logs") && !pathname.startsWith("/api/feishu-users/") && !pathname.startsWith("/api/feishu-learning/")) return false;
  const params = url.searchParams;
  try {
    if (req.method === "GET" && pathname === "/api/feishu-logs") {
      const result = await getFeishuQueryLogs({
        days: Number(params.get("days")) || 7,
        outcome: params.get("outcome") || "",
        q: params.get("q") || "",
        openId: params.get("openId") || "",
        limit: Number(params.get("limit")) || 100,
        offset: Number(params.get("offset")) || 0
      });
      await json(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === "GET" && pathname === "/api/feishu-logs/stats") {
      await json(res, 200, { ok: true, stats: await getFeishuQueryStats({ days: Number(params.get("days")) || 7 }) });
      return true;
    }
    const userMatch = USER_PATH.exec(pathname);
    if (req.method === "PUT" && userMatch) {
      const body = await readBody(req);
      await json(res, 200, { ok: true, user: await setFeishuUserName(decodeURIComponent(userMatch[1]), body.name) });
      return true;
    }
    if (req.method === "GET" && pathname === "/api/feishu-learning/suggestions") {
      await json(res, 200, { ok: true, rows: await getFeishuLearningSuggestions({ kind: params.get("kind") || "", status: params.get("status") || "" }) });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/feishu-learning/suggestions") {
      // 管理员手动添加的别名或说法：直接生效。
      const body = await readBody(req);
      if (!["alias", "phrase"].includes(body.kind)) throw Object.assign(new Error("类型无效。"), { status: 400 });
      if (body.kind === "phrase" && String(body.key || "").split("{value}").length !== 2) {
        throw Object.assign(new Error("说法里必须有且只有一个 {value}。"), { status: 400 });
      }
      const created = await upsertFeishuLearningSuggestion({ kind: body.kind, key: body.key, target: body.target });
      if (!created) throw Object.assign(new Error("内容不能为空。"), { status: 400 });
      const row = await reviewFeishuLearningSuggestion(created.id, { status: "active" });
      feishuLearning?.invalidate?.();
      await json(res, 200, { ok: true, row });
      return true;
    }
    const suggestionMatch = SUGGESTION_PATH.exec(pathname);
    if (suggestionMatch && req.method === "PUT") {
      const body = await readBody(req);
      const row = await reviewFeishuLearningSuggestion(Number(suggestionMatch[1]), { status: body.status, key: body.key, target: body.target });
      feishuLearning?.invalidate?.();
      await json(res, 200, { ok: true, row });
      return true;
    }
    if (suggestionMatch && req.method === "DELETE") {
      await deleteFeishuLearningSuggestion(Number(suggestionMatch[1]));
      feishuLearning?.invalidate?.();
      await json(res, 200, { ok: true });
      return true;
    }
    await json(res, 404, { ok: false, error: "API not found" });
  } catch (error) {
    await json(res, error?.status || 400, { ok: false, error: error?.message || "飞书日志操作失败。" });
  }
  return true;
}
