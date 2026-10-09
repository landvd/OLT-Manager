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
    }
  });
}
