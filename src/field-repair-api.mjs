// 渲染端抢修相关 API：夜间光功率基线与区域字典审核。
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function createFieldRepairApi({ request } = {}) {
  if (typeof request !== "function") throw new TypeError("抢修 API 需要注入 request。");
  return Object.freeze({
    baselineStatus() {
      return request("/api/optical-baseline");
    },
    saveBaselineSettings({ enabled, runHour } = {}) {
      return request("/api/optical-baseline/settings", { method: "PUT", ...json({ enabled, runHour }) });
    },
    runBaselineNow() {
      return request("/api/optical-baseline/run", { method: "POST" });
    },
    listRegions(village = "") {
      const params = new URLSearchParams();
      if (village) params.set("village", String(village).trim());
      return request(`/api/village-regions${params.toString() ? `?${params}` : ""}`);
    },
    discoverRegions(village) {
      return request("/api/village-regions/discover", { method: "POST", ...json({ village }) });
    },
    createRegion(input) {
      return request("/api/village-regions", { method: "POST", ...json(input) });
    },
    updateRegion(id, input) {
      return request(`/api/village-regions/${encodeURIComponent(String(id))}`, { method: "PUT", ...json(input) });
    },
    regionPons(id) {
      return request(`/api/village-regions/${encodeURIComponent(String(id))}/pons`);
    },
    saveRegionPons(id, { include = [], exclude = [] } = {}) {
      return request(`/api/village-regions/${encodeURIComponent(String(id))}/pons`, { method: "PUT", ...json({ include, exclude }) });
    },
    outageEvents(days = 90) {
      return request(`/api/field-archive/events?days=${encodeURIComponent(String(days))}`);
    },
    cableGroups(status = "") {
      return request(`/api/field-archive/cable-groups${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    },
    reviewCableGroup(id, input) {
      return request(`/api/field-archive/cable-groups/${encodeURIComponent(String(id))}`, { method: "PUT", ...json(input) });
    },
    refreshCableGroups() {
      return request("/api/field-archive/cable-groups/refresh", { method: "POST" });
    },
    deleteRegion(id) {
      return request(`/api/village-regions/${encodeURIComponent(String(id))}`, { method: "DELETE" });
    },
    // 用户归属（村 / 小组 / 小区，ADR-087）
    placeSummary() {
      return request("/api/places/summary");
    },
    placeUsers({ village = "", group = "", community = "", unassigned = false, includeEmpty = false, recommended = false, q = "", limit = 200 } = {}) {
      const params = new URLSearchParams();
      if (village) params.set("village", village);
      if (group) params.set("group", group);
      if (community) params.set("community", community);
      if (unassigned) params.set("unassigned", "1");
      if (includeEmpty) params.set("includeEmpty", "1");
      if (recommended) params.set("recommended", "1");
      if (q) params.set("q", q);
      params.set("limit", String(limit));
      return request(`/api/places/users?${params}`);
    },
    placeSuggestions(limit = 30) {
      return request(`/api/places/suggestions?limit=${encodeURIComponent(String(limit))}`);
    },
    placePonSummary() {
      return request("/api/places/pon-summary");
    },
    placeRules() {
      return request("/api/places/rules");
    },
    previewPlaceRule(input) {
      return request("/api/places/rules/preview", { method: "POST", ...json(input) });
    },
    createPlaceRule(input) {
      return request("/api/places/rules", { method: "POST", ...json(input) });
    },
    updatePlaceRule(id, input) {
      return request(`/api/places/rules/${encodeURIComponent(String(id))}`, { method: "PUT", ...json(input) });
    },
    deletePlaceRule(id) {
      return request(`/api/places/rules/${encodeURIComponent(String(id))}`, { method: "DELETE" });
    },
    savePortPlaces(input) {
      return request("/api/places/ports/batch", { method: "PUT", ...json(input) });
    },
    savePortPlace(input) {
      return request("/api/places/ports", { method: "PUT", ...json(input) });
    },
    acceptPlaceRecommendations(items) {
      return request("/api/places/overrides/accept", { method: "POST", ...json({ items }) });
    },
    savePlaceOverride(input) {
      return request("/api/places/overrides", { method: "PUT", ...json(input) });
    }
  });
}
