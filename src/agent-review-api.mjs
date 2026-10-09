// 渲染端 Pi Agent 知识审核 API：记忆（知识与规约）与用户资料修正建议。
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const id = (value) => encodeURIComponent(String(value));

export function createAgentReviewApi({ request } = {}) {
  if (typeof request !== "function") throw new TypeError("知识审核 API 需要注入 request。");
  return Object.freeze({
    listMemories(status = "") {
      const params = new URLSearchParams({ limit: "500" });
      if (status) params.set("status", status);
      return request(`/api/pi-agent/memories?${params}`);
    },
    reviewMemory(memoryId, input) {
      return request(`/api/pi-agent/memories/${id(memoryId)}`, { method: "PUT", ...json(input) });
    },
    createMemory(input) {
      return request("/api/pi-agent/memories", { method: "POST", ...json(input) });
    },
    deleteMemory(memoryId) {
      return request(`/api/pi-agent/memories/${id(memoryId)}`, { method: "DELETE" });
    },
    listCorrections(status = "") {
      return request(`/api/pi-agent/corrections${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    },
    correctionMatches(correctionId) {
      return request(`/api/pi-agent/corrections/${id(correctionId)}/matches`);
    },
    reviewCorrection(correctionId, input) {
      return request(`/api/pi-agent/corrections/${id(correctionId)}`, { method: "PUT", ...json(input) });
    },
    listQuestions(status = "") {
      return request(`/api/field-archive/questions${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    },
    answerQuestion(questionId, { question, answer }) {
      return request(`/api/field-archive/questions/${id(questionId)}`, { method: "PUT", ...json({ question, answer }) });
    },
    setQuestionStatus(questionId, status) {
      return request(`/api/field-archive/questions/${id(questionId)}`, { method: "PUT", ...json({ status }) });
    },
    deleteCorrection(correctionId) {
      return request(`/api/pi-agent/corrections/${id(correctionId)}`, { method: "DELETE" });
    }
  });
}
