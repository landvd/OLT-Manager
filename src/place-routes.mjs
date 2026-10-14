// 用户归属（村 / 小组 / 小区）管理接口（ADR-087）：只读写本地 SQLite，不触发任何 OLT 命令。
const RULE_ID_PATH = /^\/api\/places\/rules\/(\d+)$/;
const OVERRIDE_ID_PATH = /^\/api\/places\/overrides\/(\d+)$/;

export async function handlePlaceRoutes(req, res, url, {
  getPlaceSummary,
  getPlaceUsers,
  getPlaceSuggestions,
  previewPlaceRule,
  getPlaceRules,
  createPlaceRule,
  updatePlaceRule,
  deletePlaceRule,
  getPlaceOverrides,
  savePlaceOverride,
  deletePlaceOverride,
  acceptPlaceRecommendations,
  getPortPlaceAssignments,
  savePortPlaceAssignment,
  savePortPlaceAssignments,
  ensurePlaceAssignments,
  getPonPlaceSummary,
  readBody,
  json
} = {}) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/places")) return false;
  const fail = (error, fallback) => json(res, error?.status || 400, { ok: false, error: error?.message || fallback });
  const ruleId = RULE_ID_PATH.exec(pathname)?.[1];
  const overrideId = OVERRIDE_ID_PATH.exec(pathname)?.[1];
  try {
    if (req.method === "GET" && pathname === "/api/places/summary") {
      await json(res, 200, { ok: true, ...(await getPlaceSummary()) });
    } else if (req.method === "GET" && pathname === "/api/places/users") {
      const params = url.searchParams;
      await json(res, 200, {
        ok: true,
        ...(await getPlaceUsers({
          village: params.get("village") || "",
          group: params.get("group") || "",
          community: params.get("community") || "",
          unassigned: params.get("unassigned") === "1",
          includeEmpty: params.get("includeEmpty") === "1",
          recommendedOnly: params.get("recommended") === "1",
          q: params.get("q") || "",
          limit: Number(params.get("limit")) || 200
        }))
      });
    } else if (req.method === "GET" && pathname === "/api/places/suggestions") {
      await json(res, 200, { ok: true, rows: await getPlaceSuggestions({ limit: Number(url.searchParams.get("limit")) || 30 }) });
    } else if (req.method === "GET" && pathname === "/api/places/pon-summary") {
      await json(res, 200, { ok: true, ports: await getPonPlaceSummary() });
    } else if (req.method === "POST" && pathname === "/api/places/recompute") {
      await json(res, 200, { ok: true, ...(await ensurePlaceAssignments({ force: true })) });
    } else if (req.method === "POST" && pathname === "/api/places/rules/preview") {
      await json(res, 200, { ok: true, ...(await previewPlaceRule(await readBody(req))) });
    } else if (req.method === "GET" && pathname === "/api/places/rules") {
      await json(res, 200, { ok: true, rows: await getPlaceRules() });
    } else if (req.method === "POST" && pathname === "/api/places/rules") {
      const rule = await createPlaceRule(await readBody(req));
      await json(res, 200, { ok: true, rule, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "PUT" && ruleId) {
      const rule = await updatePlaceRule(ruleId, await readBody(req));
      await json(res, 200, { ok: true, rule, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "DELETE" && ruleId) {
      await deletePlaceRule(ruleId);
      await json(res, 200, { ok: true, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "GET" && pathname === "/api/places/overrides") {
      await json(res, 200, { ok: true, rows: await getPlaceOverrides() });
    } else if (req.method === "PUT" && pathname === "/api/places/overrides") {
      const override = await savePlaceOverride(await readBody(req));
      await json(res, 200, { ok: true, override, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "POST" && pathname === "/api/places/overrides/accept") {
      const body = await readBody(req);
      const result = await acceptPlaceRecommendations(body.items);
      await json(res, 200, { ok: true, ...result, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "GET" && pathname === "/api/places/ports") {
      await json(res, 200, { ok: true, rows: await getPortPlaceAssignments() });
    } else if (req.method === "PUT" && pathname === "/api/places/ports") {
      const assignment = await savePortPlaceAssignment(await readBody(req));
      await json(res, 200, { ok: true, assignment, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "PUT" && pathname === "/api/places/ports/batch") {
      const result = await savePortPlaceAssignments(await readBody(req));
      await json(res, 200, { ok: true, ...result, ...(await ensurePlaceAssignments()) });
    } else if (req.method === "DELETE" && overrideId) {
      await deletePlaceOverride(overrideId);
      await json(res, 200, { ok: true, ...(await ensurePlaceAssignments()) });
    } else {
      return false;
    }
  } catch (error) {
    await fail(error, "用户归属操作失败。");
  }
  return true;
}
