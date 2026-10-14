// 渲染端飞书查询日志与学习建议 API。
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const id = (value) => encodeURIComponent(String(value));

export function createFeishuLearningApi({ request } = {}) {
  if (typeof request !== "function") throw new TypeError("飞书日志 API 需要注入 request。");
  return Object.freeze({
    logs({ days = 7, outcome = "", q = "", openId = "", limit = 100, offset = 0 } = {}) {
      const params = new URLSearchParams({ days: String(days), limit: String(limit), offset: String(offset) });
      if (outcome) params.set("outcome", outcome);
      if (q) params.set("q", q);
      if (openId) params.set("openId", openId);
      return request(`/api/feishu-logs?${params}`);
    },
    stats(days = 7) {
      return request(`/api/feishu-logs/stats?days=${encodeURIComponent(String(days))}`);
    },
    setUserName(openId, name) {
      return request(`/api/feishu-users/${id(openId)}`, { method: "PUT", ...json({ name }) });
    },
    suggestions({ kind = "", status = "" } = {}) {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (status) params.set("status", status);
      return request(`/api/feishu-learning/suggestions${params.toString() ? `?${params}` : ""}`);
    },
    createSuggestion({ kind, key, target }) {
      return request("/api/feishu-learning/suggestions", { method: "POST", ...json({ kind, key, target }) });
    },
    reviewSuggestion(suggestionId, input) {
      return request(`/api/feishu-learning/suggestions/${id(suggestionId)}`, { method: "PUT", ...json(input) });
    },
    deleteSuggestion(suggestionId) {
      return request(`/api/feishu-learning/suggestions/${id(suggestionId)}`, { method: "DELETE" });
    },
    // 对话调试日志（ADR-091）。
    conversationLogs({ channel = "", q = "", days = 7, limit = 100, offset = 0 } = {}) {
      const params = new URLSearchParams({ days: String(days), limit: String(limit), offset: String(offset) });
      if (channel) params.set("channel", channel);
      if (q) params.set("q", q);
      return request(`/api/conversation-logs?${params}`);
    },
    conversationLog(logId) {
      return request(`/api/conversation-logs/${id(logId)}`);
    },
    exportConversationLogs(ids = []) {
      return request("/api/conversation-logs/export", { method: "POST", ...json({ ids }) });
    },
    // 资料修改审批（ADR-089）：审批人与申请记录。
    editApprover() {
      return request("/api/feishu/edit-approver");
    },
    saveEditApprover(openId) {
      return request("/api/feishu/edit-approver", { method: "PUT", ...json({ openId: openId || "" }) });
    },
    editRequests({ status = "", limit = 100 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (status) params.set("status", status);
      return request(`/api/feishu/edit-requests?${params}`);
    }
  });
}
