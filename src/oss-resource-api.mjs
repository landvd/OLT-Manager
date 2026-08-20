function ossConfigPayload(input = {}) {
  return {
    authBaseUrl: String(input.authBaseUrl || "").trim(),
    ngbBaseUrl: String(input.ngbBaseUrl || "").trim(),
    username: String(input.username || "").trim(),
    organizationName: String(input.organizationName || "").trim(),
    roomName: String(input.roomName || "").trim()
  };
}

function ossLoginPayload(input = {}) {
  return {
    ...(input.password ? { password: String(input.password) } : {}),
    ...(input.migrationMasterPassword ? { migrationMasterPassword: String(input.migrationMasterPassword) } : {}),
    rememberPassword: input.rememberPassword === true,
    autoLogin: input.autoLogin === true
  };
}

function historicalOpticalPayload(input = {}) {
  return {
    oltId: String(input.oltId || ""),
    chassis: input.chassis,
    board: input.board ?? input.slot,
    pon: input.pon,
    onuId: input.onuId,
    startDate: input.startDate,
    endDate: input.endDate
  };
}

export function createOssResourceApi({ request } = {}) {
  if (typeof request !== "function") throw new TypeError("网管二期 API 需要注入 request。 ");

  return Object.freeze({
    async config() {
      return request("/api/admin/oss-resource/config");
    },

    async saveConfig(input = {}) {
      return request("/api/admin/oss-resource/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ossConfigPayload(input))
      });
    },

    async login(input = {}) {
      return request("/api/admin/oss-resource/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ossLoginPayload(input))
      });
    },

    async logout() {
      return request("/api/admin/oss-resource/logout", { method: "POST" });
    },

    async historicalOptical(input = {}) {
      return request("/api/onus/historical-optical", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(historicalOpticalPayload(input))
      });
    }
  });
}
