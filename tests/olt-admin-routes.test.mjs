import test from "node:test";
import assert from "node:assert/strict";
import { handleOltAdminRoutes } from "../src/olt-admin-routes.mjs";

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const dependencies = {
    getOlts: async () => [{ id: "olt-1", name: "OLT 1", readCommunity: "secret" }],
    replaceOlts: async (rows, source) => calls.push(["replace-olts", rows, source]),
    publicOlt: (olt) => ({ id: olt.id, name: olt.name }),
    getPonPorts: async () => [{ oltIp: "192.0.2.1", ponPort: "1/2/3" }],
    replacePonPorts: async (rows, source) => calls.push(["replace-pon", rows, source]),
    refreshPonVlans: async (body, olts) => { calls.push(["refresh-vlans", body, olts]); return { count: 1 }; },
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    olts: [{ id: "olt-1" }],
    ...overrides
  };
  return { responses, calls, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const handled = await handleOltAdminRoutes({ method, body: options.body }, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("OLT admin routes preserve credential-free projection and local table operations", async () => {
  const olts = await dispatch("GET", "/api/admin/olts");
  assert.deepEqual(olts.responses[0], { status: 200, body: [{ id: "olt-1", name: "OLT 1" }] });

  const update = await dispatch("PUT", "/api/admin/olts", { body: { olts: [{ id: "olt-1", name: "更新" }] } });
  assert.deepEqual(update.responses[0].body, { ok: true, olts: [{ id: "olt-1", name: "OLT 1" }], adminOlts: [{ id: "olt-1", name: "OLT 1" }] });
  assert.deepEqual(update.calls, [["replace-olts", [{ id: "olt-1", name: "更新" }], "admin"]]);

  const ports = await dispatch("GET", "/api/admin/pon-ports");
  assert.deepEqual(ports.responses[0].body, [{ oltIp: "192.0.2.1", ponPort: "1/2/3" }]);

  const imported = await dispatch("POST", "/api/admin/import-pon-ports", { body: { rows: [{ ponPort: "1/2/3" }] } });
  assert.deepEqual(imported.responses[0].body, { ok: true, count: 1 });
  assert.deepEqual(imported.calls, [["replace-pon", [{ ponPort: "1/2/3" }], "admin"]]);
});

test("OLT admin routes keep VLAN refresh injection and unmatched behavior", async () => {
  const refreshed = await dispatch("POST", "/api/admin/refresh-pon-vlans", { body: { oltId: "olt-1" } });
  assert.deepEqual(refreshed.responses[0].body, { count: 1 });
  assert.deepEqual(refreshed.calls, [["refresh-vlans", { oltId: "olt-1" }, [{ id: "olt-1" }]]]);

  const unmatched = await dispatch("GET", "/api/admin/olts/olt-1");
  assert.equal(unmatched.handled, false);
  assert.deepEqual(unmatched.responses, []);
});
