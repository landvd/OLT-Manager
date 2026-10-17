// 未解决问题接口（“知识审核”页）：列出、起草答案、补答（生成常见问题记忆）、忽略。只读写本地 SQLite。
import { normalizeQuestion } from "./question-text.mjs";

const QUESTION_ID = /^\/api\/unresolved-questions\/(\d+)$/;
const QUESTION_DRAFT = /^\/api\/unresolved-questions\/(\d+)\/draft$/;

export async function handleUnresolvedQuestionRoutes(req, res, url, {
  getUnresolvedQuestions,
  updateUnresolvedQuestion,
  saveLearnedMemory,
  draftAnswer = null,
  readBody,
  json
} = {}) {
  const { pathname } = url;
  if (pathname !== "/api/unresolved-questions" && !pathname.startsWith("/api/unresolved-questions/")) return false;
  try {
    if (req.method === "GET" && pathname === "/api/unresolved-questions") {
      await json(res, 200, { ok: true, rows: await getUnresolvedQuestions({ status: url.searchParams.get("status") || "" }) });
      return true;
    }
    const draftMatch = QUESTION_DRAFT.exec(pathname);
    if (req.method === "POST" && draftMatch) {
      // 让内网大模型先起草答案，管理员审核修改后再保存，不会自动生效。
      if (typeof draftAnswer !== "function") throw Object.assign(new Error("Gd Agent 未就绪，无法起草答案。"), { status: 503 });
      const body = await readBody(req);
      const question = String(body.question || "").trim();
      if (!question) throw Object.assign(new Error("缺少问题。"), { status: 400 });
      await json(res, 200, { ok: true, draft: String(await draftAnswer(question) || "").trim() });
      return true;
    }
    const questionMatch = QUESTION_ID.exec(pathname);
    if (req.method === "PUT" && questionMatch) {
      const body = await readBody(req);
      const id = Number(questionMatch[1]);
      let memoryId = null;
      // 补答：保存为一条已生效的“常见问题”记忆，下次有人问相似的问题时 Gd Agent 会引用。
      if (body.answer) {
        const answer = String(body.answer).trim();
        const question = String(body.question || "").trim();
        if (!answer || !question) throw Object.assign(new Error("请填写问题和答案。"), { status: 400 });
        const memory = await saveLearnedMemory({
          domain: "faq",
          entityKey: normalizeQuestion(question),
          topic: question.slice(0, 120),
          factContent: answer,
          reason: "管理员补答未解决问题",
          status: "active",
          source: "manual"
        });
        memoryId = memory?.id || null;
      }
      const row = await updateUnresolvedQuestion(id, { status: body.answer ? "answered" : body.status, memoryId });
      await json(res, 200, { ok: true, row });
      return true;
    }
    await json(res, 404, { ok: false, error: "API not found" });
  } catch (error) {
    await json(res, error?.status || 400, { ok: false, error: error?.message || "未解决问题操作失败。" });
  }
  return true;
}
