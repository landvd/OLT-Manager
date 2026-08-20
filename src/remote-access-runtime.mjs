/**
 * 深模块：封装两个远端只读系统的登录、会话访问和凭据解锁。
 * 调用方只需要关心 session、OLT 映射和失效操作，不接触密码解密细节。
 */
export function createRemoteAccessRuntime({
  sessionState,
  NmseClient,
  OssNgbClient,
  getResourceManagementConfig,
  getResourceManagementPassword,
  resourceManagementSecretProvider,
  getOssResourceConfig,
  getOssResourceCredential,
  saveOssResourceCredential,
  encryptOssNgbPassword,
  decryptOssNgbPassword,
  migrationMasterPasswordIsValid,
  ossAutoLoginStore
} = {}) {
  function activeNmseSession() {
    const session = sessionState.getNmseSession();
    if (!session) {
      const error = new Error("资源管理系统未登录或会话已失效，请先登录。");
      error.status = 401;
      throw error;
    }
    return session;
  }

  function resourceGridRank(session, olt) {
    const remote = session.olts.find((item) => item.host === olt.host);
    if (!remote) {
      const error = new Error("当前资源管理账号未发现该 OLT，请核对 OLT IP 与账号权限。");
      error.status = 404;
      throw error;
    }
    return remote.gridRank;
  }

  async function loginNmseSession({ migrationMasterPassword = "" } = {}) {
    const config = await getResourceManagementConfig();
    const loginPassword = await getResourceManagementPassword({
      provider: resourceManagementSecretProvider,
      masterPassword: migrationMasterPassword || sessionState.getNmseMigrationMasterPassword()
    });
    const client = new NmseClient({ serverUrl: config.serverUrl });
    const auth = await client.login(config.username, loginPassword);
    if (migrationMasterPassword) sessionState.setNmseMigrationMasterPassword(migrationMasterPassword);
    const discovered = await client.discoverOlts(auth);
    const session = { client, auth, olts: discovered };
    sessionState.setNmseSession(session);
    return session;
  }

  async function ensureNmseSession() {
    return sessionState.getNmseSession() || loginNmseSession();
  }

  function activeOssNgbSession() {
    const session = sessionState.getOssNgbSession();
    if (!session) {
      const error = new Error("网管二期未登录或会话已失效。");
      error.status = 401;
      throw error;
    }
    return session;
  }

  async function loginOssNgbSession({ password = "", migrationMasterPassword = "", rememberPassword = false, autoLogin = false } = {}) {
    const config = await getOssResourceConfig();
    if (!config.configured) {
      const error = new Error("请先保存完整的网管二期配置。");
      error.status = 400;
      throw error;
    }
    const suppliedPassword = typeof password === "string" ? password : "";
    const validMasterPassword = migrationMasterPasswordIsValid(migrationMasterPassword);
    if (suppliedPassword && !validMasterPassword && !(rememberPassword && ossAutoLoginStore.isAvailable())) {
      const error = new Error("请输入至少 8 位迁移主密码，或在桌面版勾选本机自动登录。");
      error.status = 400;
      throw error;
    }
    let loginPassword = suppliedPassword;
    if (!loginPassword && autoLogin) {
      try {
        loginPassword = await ossAutoLoginStore.read();
      } catch {
        const error = new Error("本机自动登录凭据不可用，请改为手动输入网管二期密码。");
        error.status = 401;
        throw error;
      }
      if (!loginPassword) {
        const error = new Error("本机没有已保存的网管二期自动登录密码。");
        error.status = 400;
        throw error;
      }
    }
    if (!loginPassword) {
      if (!validMasterPassword) {
        const error = new Error("请输入至少 8 位迁移主密码；主密码不会保存。");
        error.status = 400;
        throw error;
      }
      const credential = await getOssResourceCredential();
      if (!credential) {
        const error = new Error("首次保存请同时填写网管二期登录密码和迁移主密码。");
        error.status = 400;
        throw error;
      }
      try {
        loginPassword = decryptOssNgbPassword(credential, migrationMasterPassword);
      } catch {
        const error = new Error("迁移主密码错误或已保存的网管二期密码密文无法解锁。");
        error.status = 401;
        throw error;
      }
    }
    const client = new OssNgbClient({ authBaseUrl: config.authBaseUrl, ngbBaseUrl: config.ngbBaseUrl });
    const session = await client.login({
      username: config.username,
      password: loginPassword,
      organizationName: config.organizationName,
      roomName: config.roomName
    });
    if (suppliedPassword && validMasterPassword) {
      await saveOssResourceCredential(encryptOssNgbPassword(suppliedPassword, migrationMasterPassword));
    }
    if (suppliedPassword && rememberPassword) await ossAutoLoginStore.save(suppliedPassword);
    const activeSession = { client, ...session };
    sessionState.setOssNgbSession(activeSession);
    return activeSession;
  }

  return {
    activeNmseSession,
    resourceGridRank,
    loginNmseSession,
    ensureNmseSession,
    activeOssNgbSession,
    loginOssNgbSession
  };
}
