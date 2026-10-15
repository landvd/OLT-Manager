// 用户归属（村 / 小组 / 小区）管理接口（ADR-087）：只读写本地 SQLite，不触发任何 OLT 命令。
const RULE_ID_PATH = /^\/api\/places\/rules\/(\d+)$/;
const OVERRIDE_ID_PATH = /^\/api\/places\/overrides\/(\d+)$/;

import { parsePlaceInput } from "./edit-request-service.mjs";

/**
 * Excel 导入的归属改动：逐行解析（写法同飞书资料修改，“新塘村/顺景大厦”也能认），
 * 归属相同的行一起保存；空值表示恢复自动；解析不了的行返回原因，不影响其它行。
 */
export async function importPortPlaces({ items = [] } = {}, { parsePlaceInput: parse, getKnownPlaces, savePortPlaceAssignments }) {
  const list = (Array.isArray(items) ? items : []).slice(0, 5000);
  const known = await getKnownPlaces();
  const groups = new Map();
  const errors = [];
  for (const item of list) {
    const port = { oltIp: item?.oltIp, board: item?.board, pon: item?.pon, address: item?.address || "" };
    if (!port.oltIp || !port.board || !port.pon) {
      errors.push({ line: item?.line, text: item?.text || "", error: "缺少 OLT IP、板卡或 PON" });
      continue;
    }
    let place = { village: "", villageGroup: "", community: "", label: "" };
    if (String(item?.text || "").trim()) {
      try {
        place = parse(item.text, known);
      } catch (error) {
        errors.push({ line: item?.line, text: item.text, error: error.message });
        continue;
      }
    }
    if (!groups.has(place.label)) groups.set(place.label, { place, ports: [] });
    groups.get(place.label).ports.push(port);
  }
  let saved = 0;
  let cleared = 0;
  for (const { place, ports } of groups.values()) {
    await savePortPlaceAssignments({ ports, village: place.village, villageGroup: place.villageGroup, community: place.community });
    if (place.label) saved += ports.length;
    else cleared += ports.length;
  }
  return { saved, cleared, errors };
}

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
  getKnownPlaces = async () => [],
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
    } else if (req.method === "POST" && pathname === "/api/places/ports/import") {
      await json(res, 200, { ok: true, ...(await importPortPlaces(await readBody(req), { parsePlaceInput, getKnownPlaces, savePortPlaceAssignments })), ...(await ensurePlaceAssignments()) });
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
