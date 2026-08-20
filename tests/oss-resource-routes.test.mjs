import test from "node:test";
import assert from "node:assert/strict";
import { handleOssResourceRoutes } from "../src/oss-resource-routes.mjs";

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const session = {
    olts: [{ resourceIp: "192.0.2.1", cuid: "cuid-1" }],
    client: {
      inspectOnuFieldNames: async (cuid, options) => {
        calls.push(["inspect", cuid, options]);
        return { fieldNames: ["deviceNo"], matches: [{ field: "deviceNo", value: "ONU-1" }] };
      }
    }
  };
  const dependencies = {
    getOssResourceConfig: async () => ({ baseUrl: "https://example.invalid" }),
    ossAutoLoginStore: { isAvailable: () => true, configured: async () => false },
    remoteSessionState: {
      getOssNgbSession: () => null,
      clearOssNgbSession: () => calls.push(["clear-session"])
    },
    json: async (_res, status, body) => responses.push({ status, body }),
    readBody: async (req) => req.body || {},
    activeOssNgbSession: () => session,
    mergedOnuService: {
      selectMergedOnuTargets: () => [{ target: { id: "olt-1", host: "192.0.2.1" }, mapping: { resourceIp: "192.0.2.1" } }]
    },
    getOlts: async () => [{ id: "olt-1", host: "192.0.2.1" }],
    getResourceOltIpMappings: async () => [],
    saveOssResourceConfig: async (body) => ({ saved: body.enabled === true }),
    loginOssNgbSession: async (options) => { calls.push(["login", options]); return { olts: [{ resourceIp: "192.0.2.1", cuid: "cuid-1" }] }; },
    publicOssOlts: (items) => items.map(({ resourceIp }) => ({ resourceIp })),
    resourceTargetOlt: (olts, id) => olts.find((olt) => olt.id === id) || (() => { throw Object.assign(new Error("OLT 不存在。"), { status: 404 }); })(),
    readHistoricalOpticalForTarget: async (input) => { calls.push(["history", input]); return [{ timestamp: "2026-08-19T00:00:00Z", rxPower: -18 }]; },
    olts: [{ id: "olt-1", name: "OLT 1", host: "192.0.2.1" }],
    ...overrides
  };
  return { responses, calls, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const handled = await handleOssResourceRoutes({ method, body: options.body }, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("OSS resource config and login routes keep credential-free response boundaries", async () => {
  const config = await dispatch("GET", "/api/admin/oss-resource/config");
  assert.deepEqual(config.responses[0].body, {
    baseUrl: "https://example.invalid",
    autoLoginAvailable: true,
    autoLoginConfigured: false,
    loggedIn: false
  });

  const login = await dispatch("POST", "/api/admin/oss-resource/login", { body: { password: "secret", rememberPassword: true, autoLogin: true } });
  assert.deepEqual(login.responses[0].body, { ok: true, credentialConfigured: true, oltCount: 1, olts: [{ resourceIp: "192.0.2.1" }] });
  assert.deepEqual(login.calls[0], ["login", { password: "secret", migrationMasterPassword: undefined, rememberPassword: true, autoLogin: true }]);
  assert.equal(JSON.stringify(login.responses).includes("secret"), false);
});

test("OSS field diagnosis validates needle, joins mapped OLT data, and invalidates 401 sessions", async () => {
  const result = await dispatch("GET", "/api/admin/oss-resource/diagnose-fields?needle=deviceNo");
  assert.deepEqual(result.responses[0].body, { ok: true, fieldNames: ["deviceNo"], matches: [{ oltIp: "192.0.2.1", oltId: "olt-1", field: "deviceNo", value: "ONU-1" }] });
  assert.deepEqual(result.calls[0], ["inspect", "cuid-1", { needle: "deviceNo" }]);

  const invalid = await dispatch("GET", "/api/admin/oss-resource/diagnose-fields?needle=");
  assert.deepEqual(invalid.responses[0], { status: 400, body: { ok: false, error: "字段诊断搜索值必须是 1-200 个字符。" } });

  const unauthorized = await dispatch("GET", "/api/admin/oss-resource/diagnose-fields?needle=x", {
    dependencies: { activeOssNgbSession: () => { throw Object.assign(new Error("会话失效"), { status: 401 }); } }
  });
  assert.deepEqual(unauthorized.responses, [{ status: 401, body: { ok: false, error: "会话失效" } }]);
  assert.deepEqual(unauthorized.calls, [["clear-session"]]);
});

test("OSS history and config mutation preserve coordinate mapping and session cleanup", async () => {
  const history = await dispatch("POST", "/api/onus/historical-optical", { body: { oltId: "olt-1", chassis: 1, slot: 2, pon: 3, onuId: 4, startDate: "2026-08-01", endDate: "2026-08-19" } });
  assert.deepEqual(history.responses[0].body, {
    ok: true,
    source: "oss-ngb",
    olt: { id: "olt-1", name: "OLT 1" },
    coordinate: { chassis: 1, board: 2, pon: 3, onuId: 4 },
    startDate: "2026-08-01",
    endDate: "2026-08-19",
    rows: [{ timestamp: "2026-08-19T00:00:00Z", rxPower: -18 }]
  });
  assert.deepEqual(history.calls[0], ["history", { target: { id: "olt-1", name: "OLT 1", host: "192.0.2.1" }, coordinate: { chassis: 1, board: 2, pon: 3, onuId: 4 }, startDate: "2026-08-01", endDate: "2026-08-19" }]);

  const saved = await dispatch("PUT", "/api/admin/oss-resource/config", { body: { enabled: true } });
  assert.deepEqual(saved.responses[0].body, { ok: true, saved: true, autoLoginAvailable: true, autoLoginConfigured: false, loggedIn: false });
  assert.deepEqual(saved.calls, [["clear-session"]]);

  const unmatched = await dispatch("GET", "/api/admin/oss-resource/unknown");
  assert.equal(unmatched.handled, false);
});
