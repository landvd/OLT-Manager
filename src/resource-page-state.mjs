export function resourceManagementConfigProjection(config = {}) {
  return {
    config: {
      serverUrl: config.serverUrl || "http://172.18.254.7:9000",
      username: config.username || "",
      password: config.password || ""
    },
    loggedIn: Boolean(config.loggedIn)
  };
}

export function ossResourceConfigProjection(config = {}) {
  return {
    config: {
      authBaseUrl: config.authBaseUrl || "http://10.205.136.199:18140",
      ngbBaseUrl: config.ngbBaseUrl || "http://10.205.137.22:8080",
      username: config.username || "",
      organizationName: config.organizationName || "",
      roomName: config.roomName || ""
    },
    password: config.password || "",
    credentialConfigured: Boolean(config.credentialConfigured),
    autoLoginAvailable: Boolean(config.autoLoginAvailable),
    autoLoginConfigured: Boolean(config.autoLoginConfigured),
    loggedIn: Boolean(config.loggedIn)
  };
}

export function ossLoginProjection(result = {}, { rememberPassword = false, autoLoginConfigured = false } = {}) {
  return {
    credentialConfigured: Boolean(result.credentialConfigured),
    autoLoginConfigured: Boolean(rememberPassword) || Boolean(autoLoginConfigured),
    loggedIn: true,
    olts: Array.isArray(result.olts) ? result.olts : []
  };
}

export function ossLogoutProjection() {
  return { loggedIn: false, olts: [], historyRows: [] };
}
