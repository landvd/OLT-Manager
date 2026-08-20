import test from "node:test";
import assert from "node:assert/strict";
import {
  ossLoginProjection,
  ossLogoutProjection,
  ossResourceConfigProjection,
  resourceManagementConfigProjection
} from "../src/resource-page-state.mjs";

test("resource page projects safe configuration state without retaining passwords", () => {
  assert.deepEqual(resourceManagementConfigProjection({ serverUrl: "nmse", username: "operator", password: "secret", loggedIn: true }), {
    config: { serverUrl: "nmse", username: "operator", password: "", migrationMasterPassword: "" },
    loggedIn: true
  });
  assert.deepEqual(ossResourceConfigProjection({ authBaseUrl: "auth", ngbBaseUrl: "ngb", username: "operator", organizationName: "org", roomName: "room", loggedIn: false }), {
    config: { authBaseUrl: "auth", ngbBaseUrl: "ngb", username: "operator", organizationName: "org", roomName: "room" },
    credentialConfigured: false,
    autoLoginAvailable: false,
    autoLoginConfigured: false,
    loggedIn: false
  });
});

test("resource page keeps login and logout transitions bounded", () => {
  assert.deepEqual(ossLoginProjection({ credentialConfigured: true, olts: [{ id: "olt-1" }] }, { rememberPassword: true }), {
    credentialConfigured: true,
    autoLoginConfigured: true,
    loggedIn: true,
    olts: [{ id: "olt-1" }]
  });
  assert.deepEqual(ossLogoutProjection(), { loggedIn: false, olts: [], historyRows: [] });
});
