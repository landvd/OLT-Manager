export function resourceManagementConfigProjection(config = {}) {
  return {
    config: {
      serverUrl: config.serverUrl || "",
      username: config.username || "",
      password: "",
      migrationMasterPassword: ""
    },
    loggedIn: Boolean(config.loggedIn)
  };
}

export function ossResourceConfigProjection(config = {}) {
  return {
    config: {
      authBaseUrl: config.authBaseUrl || "",
      ngbBaseUrl: config.ngbBaseUrl || "",
      username: config.username || "",
      organizationName: config.organizationName || "",
      roomName: config.roomName || ""
    },
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
