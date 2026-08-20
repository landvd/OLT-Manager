function resourceManagementConfigPayload(input = {}) {
  return {
    serverUrl: String(input.serverUrl || "").trim().replace(/\/$/, ""),
    username: String(input.username || "").trim(),
    password: String(input.password || ""),
    migrationMasterPassword: String(input.migrationMasterPassword || "")
  };
}

export function createResourceManagementApi({ request } = {}) {
  if (typeof request !== "function") throw new TypeError("资源管理 API 需要注入 request。 ");

  return Object.freeze({
    async config() {
      return request("/api/admin/resource-management/config");
    },

    async saveConfig(input = {}) {
      return request("/api/admin/resource-management/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resourceManagementConfigPayload(input))
      });
    },

    async login(migrationMasterPassword = "") {
      return request("/api/admin/resource-management/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ migrationMasterPassword: String(migrationMasterPassword || "") })
      });
    },

    async logout() {
      return request("/api/admin/resource-management/logout", { method: "POST" });
    },

    async syncVlans(oltId) {
      return request("/api/admin/resource-management/sync-vlans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oltId: String(oltId || "") })
      });
    }
  });
}
