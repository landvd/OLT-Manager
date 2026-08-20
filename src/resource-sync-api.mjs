import { resourceSchedulePayload } from "./resource-schedule-view-state.mjs";

const syncEndpoint = Object.freeze({
  network: "/api/admin/merged-onu/sync/network",
  nmse: "/api/admin/merged-onu/sync/nmse",
  merge: "/api/admin/merged-onu/merge",
  full: "/api/admin/merged-onu/sync"
});

function taskIdPath(id) {
  return encodeURIComponent(String(id || "").trim());
}

export function createResourceSyncApi({ request } = {}) {
  if (typeof request !== "function") throw new TypeError("资源同步 API 需要注入 request。 ");
  return Object.freeze({
    async listTasks() {
      const data = await request("/api/admin/resource-sync-tasks");
      return Array.isArray(data.rows) ? data.rows : [];
    },
    async createTask(input = {}) {
      return request("/api/admin/resource-sync-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resourceSchedulePayload(input))
      });
    },
    async cancelTask(id) {
      return request(`/api/admin/resource-sync-tasks/${taskIdPath(id)}`, { method: "DELETE" });
    },
    async deleteTask(id) {
      return request(`/api/admin/resource-sync-tasks/${taskIdPath(id)}/delete`, { method: "DELETE" });
    },
    async listMergedSnapshots({ oltId = "", keyword = "" } = {}) {
      const params = new URLSearchParams();
      if (keyword) params.set("q", String(keyword).trim());
      else if (oltId) params.set("oltId", String(oltId));
      return request(`/api/admin/merged-onu/snapshots?${params}`);
    },
    async mergedStatus() {
      return request("/api/admin/merged-onu/status");
    },
    async mergedProgress() {
      return request("/api/admin/merged-onu/sync/progress");
    },
    async syncMerged(operation = "full") {
      const endpoint = syncEndpoint[operation] || syncEndpoint.full;
      return request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
    }
  });
}
