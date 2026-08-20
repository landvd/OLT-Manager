import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteAccessRuntime } from "../src/remote-access-runtime.mjs";

function createSessionState() {
  let nmseSession = null;
  let ossSession = null;
  let migrationMasterPassword = "";
  return {
    getNmseSession: () => nmseSession,
    setNmseSession: (value) => { nmseSession = value; },
    getOssNgbSession: () => ossSession,
    setOssNgbSession: (value) => { ossSession = value; },
    getNmseMigrationMasterPassword: () => migrationMasterPassword,
    setNmseMigrationMasterPassword: (value) => { migrationMasterPassword = value; }
  };
}

test("remote access runtime owns NMSE login, discovery and grid mapping", async () => {
  const sessionState = createSessionState();
  class FakeNmseClient {
    constructor(options) { this.options = options; }
    async login(username, password) { return { username, password, token: "memory-only" }; }
    async discoverOlts() { return [{ host: "192.0.2.10", gridRank: "grid-1" }]; }
  }
  const runtime = createRemoteAccessRuntime({
    sessionState,
    NmseClient: FakeNmseClient,
    OssNgbClient: class {},
    getResourceManagementConfig: async () => ({ serverUrl: "http://nmse.test", username: "operator" }),
    getResourceManagementPassword: async () => "nmse-password",
    resourceManagementSecretProvider: {},
    getOssResourceConfig: async () => ({ configured: false }),
    getOssResourceCredential: async () => null,
    saveOssResourceCredential: async () => {},
    encryptOssNgbPassword: () => ({}),
    decryptOssNgbPassword: () => "",
    migrationMasterPasswordIsValid: () => false,
    ossAutoLoginStore: { isAvailable: () => false }
  });

  const session = await runtime.loginNmseSession({ migrationMasterPassword: "master" });
  assert.equal(session.olts[0].gridRank, "grid-1");
  assert.equal(runtime.resourceGridRank(session, { host: "192.0.2.10" }), "grid-1");
  assert.equal(runtime.ensureNmseSession instanceof Function, true);
  assert.throws(() => runtime.resourceGridRank(session, { host: "192.0.2.11" }), /未发现该 OLT/);
});

test("remote access runtime unlocks and persists OSS credentials only through injected adapters", async () => {
  const sessionState = createSessionState();
  const saved = [];
  class FakeOssNgbClient {
    async login(options) { return { olts: [{ resourceIp: "198.51.100.10", cuid: "memory-only" }], options }; }
  }
  const runtime = createRemoteAccessRuntime({
    sessionState,
    NmseClient: class {},
    OssNgbClient: FakeOssNgbClient,
    getResourceManagementConfig: async () => ({}),
    getResourceManagementPassword: async () => "",
    resourceManagementSecretProvider: {},
    getOssResourceConfig: async () => ({ configured: true, authBaseUrl: "http://auth.test", ngbBaseUrl: "http://ngb.test", username: "operator", organizationName: "分公司", roomName: "机房" }),
    getOssResourceCredential: async () => null,
    saveOssResourceCredential: async (value) => saved.push(value),
    encryptOssNgbPassword: (password, master) => ({ ciphertext: `${password}:${master}` }),
    decryptOssNgbPassword: () => "",
    migrationMasterPasswordIsValid: (value) => value === "master-password",
    ossAutoLoginStore: { isAvailable: () => false, save: async () => {} }
  });

  const session = await runtime.loginOssNgbSession({ password: "secret-password", migrationMasterPassword: "master-password" });
  assert.equal(session.olts[0].resourceIp, "198.51.100.10");
  assert.deepEqual(saved, [{ ciphertext: "secret-password:master-password" }]);
  assert.equal(runtime.activeOssNgbSession(), session);
});

test("remote access runtime supports on-demand OSS auto login from the injected local store", async () => {
  const sessionState = createSessionState();
  const loginCalls = [];
  class FakeOssNgbClient {
    async login(options) {
      loginCalls.push(options);
      return { olts: [], options };
    }
  }
  const runtime = createRemoteAccessRuntime({
    sessionState,
    NmseClient: class {},
    OssNgbClient: FakeOssNgbClient,
    getResourceManagementConfig: async () => ({}),
    getResourceManagementPassword: async () => "",
    resourceManagementSecretProvider: {},
    getOssResourceConfig: async () => ({ configured: true, authBaseUrl: "http://auth.test", ngbBaseUrl: "http://ngb.test", username: "operator", organizationName: "分公司", roomName: "机房" }),
    getOssResourceCredential: async () => null,
    saveOssResourceCredential: async () => {},
    encryptOssNgbPassword: () => ({}),
    decryptOssNgbPassword: () => "",
    migrationMasterPasswordIsValid: () => false,
    ossAutoLoginStore: { isAvailable: () => true, read: async () => "local-only-password", save: async () => {} }
  });

  const session = await runtime.loginOssNgbSession({ autoLogin: true });
  assert.equal(session.options.password, "local-only-password");
  assert.equal(loginCalls.length, 1);
});
