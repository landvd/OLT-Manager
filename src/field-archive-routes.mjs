// 抢修档案接口：断纤事件、同缆组审核、Pi Agent 未解决问题。只读写本地 SQLite。
import { normalizeQuestion, outagePonKey } from "./outage-events.mjs";

const GROUP_ID = /^\/api\/field-archive\/cable-groups\/(\d+)$/;
const QUESTION_ID = /^\/api\/field-archive\/questions\/(\d+)$/;

export async function handleFieldArchiveRoutes(req, res, url, {
  fieldArchive,
  getCableGroups,
  reviewCableGroup,
  getUnresolvedQuestions,
  updateUnresolvedQuestion,
  saveLearnedMemory,
  getPonPorts = async () => [],
  getOlts = async () => [],
  readBody,
  json
} = {}) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/field-archive/")) return false;
  try {
    if (req.method === "GET" && pathname === "/api/field-archive/events") {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 90));
      const events = await fieldArchive.listEvents({ days });
      await json(res, 200, { ok: true, events });
      return true;
    }
    if (req.method === "GET" && pathname === "/api/field-archive/cable-groups") {
      const [groups, ports, olts] = await Promise.all([getCableGroups({ status: url.searchParams.get("status") || "" }), getPonPorts(), getOlts()]);
      const addresses = new Map();
      for (const port of ports) {
        const key = outagePonKey({ oltIp: port.oltIp, chassis: port.chassis, board: port.board ?? port.slot, pon: port.pon });
        if (!addresses.has(key) && port.address) addresses.set(key, String(port.address));
      }
      const names = new Map(olts.map((olt) => [String(olt.host), String(olt.name || olt.host)]));
      await json(res, 200, {
        ok: true,
        groups: groups.map((group) => ({
          ...group,
          pons: group.ponKeys.map((key) => {
            const [oltIp, coordinate] = key.split("|");
            return { ponKey: key, oltIp, oltName: names.get(oltIp) || oltIp, coordinate, address: addresses.get(key) || "" };
          })
        }))
      });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/field-archive/cable-groups/refresh") {
      const groups = await fieldArchive.refreshCableGroups();
      await json(res, 200, { ok: true, inferred: groups.length });
      return true;
    }
    const groupMatch = GROUP_ID.exec(pathname);
    if (req.method === "PUT" && groupMatch) {
      const body = await readBody(req);
      await json(res, 200, { ok: true, group: await reviewCableGroup(Number(groupMatch[1]), { status: body.status, note: body.note }) });
      return true;
    }
    if (req.method === "GET" && pathname === "/api/field-archive/questions") {
      await json(res, 200, { ok: true, rows: await getUnresolvedQuestions({ status: url.searchParams.get("status") || "" }) });
      return true;
    }
    const questionMatch = QUESTION_ID.exec(pathname);
    if (req.method === "PUT" && questionMatch) {
      const body = await readBody(req);
      const id = Number(questionMatch[1]);
      let memoryId = null;
      // 补答：保存为一条已生效的“常见问题”记忆，下次有人问相似的问题时 Pi Agent 会引用。
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
    await json(res, error?.status || 400, { ok: false, error: error?.message || "抢修档案操作失败。" });
  }
  return true;
}
