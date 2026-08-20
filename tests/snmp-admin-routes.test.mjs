import test from "node:test";
import assert from "node:assert/strict";
import { handleSnmpAdminRoutes } from "../src/snmp-admin-routes.mjs";

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const dependencies = {
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    olts: [{ id: "olt-1" }],
    defaultOlt: { id: "olt-1" },
    publicOidProfiles: () => [{ id: "zte-c300", verified: true }],
    snmpGet: async (...args) => { calls.push(["get", ...args]); return { ok: true, value: "synthetic-value", rows: [] }; },
    snmpWalk: async (...args) => { calls.push(["walk", ...args]); return { ok: true, value: "", rows: [{ oid: "1.2.3.4", value: "synthetic-row" }] }; },
    addSnmpProbe: async (probe) => calls.push(["probe", probe]),
    getSnmpHistory: async (limit) => ({ type: "snmp", limit }),
    getAdminEvents: async (limit) => ({ type: "events", limit }),
    ...overrides
  };
  return { responses, calls, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const handled = await handleSnmpAdminRoutes({ method, body: options.body }, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("SNMP admin routes keep public profiles, read-only validation, and probe recording", async () => {
  const profiles = await dispatch("GET", "/api/admin/oid-profiles");
  assert.equal(profiles.handled, true);
  assert.deepEqual(profiles.responses, [{ status: 200, body: [{ id: "zte-c300", verified: true }] }]);

  const blocked = await dispatch("POST", "/api/admin/snmp-test", { body: { operation: "set", oid: "1.2.3" } });
  assert.equal(blocked.responses[0].status, 400);
  assert.match(blocked.responses[0].body.error, /危险操作已被禁止/);
  assert.deepEqual(blocked.calls, []);

  const get = await dispatch("POST", "/api/admin/snmp-test", { body: { oltId: "olt-1", operation: "GET", oid: "1.2.3" } });
  assert.equal(get.responses[0].status, 200);
  assert.equal(get.responses[0].body.summary, "synthetic-value");
  assert.equal(get.calls[0][0], "get");
  assert.equal(get.calls[1][0], "probe");

  const walk = await dispatch("POST", "/api/admin/snmp-test", { body: { operation: "walk", oid: "1.2.3" } });
  assert.equal(walk.responses[0].body.summary, "1 rows");
  assert.equal(walk.responses[0].body.rawOutput, "1.2.3.4 = synthetic-row");
  assert.equal(walk.calls[0][0], "walk");
});

test("SNMP admin routes preserve OID errors and bounded history queries", async () => {
  const invalidOid = await dispatch("POST", "/api/admin/snmp-test", { body: { operation: "get", oid: "1.2.bad" } });
  assert.deepEqual(invalidOid.responses, [{ status: 400, body: { ok: false, error: "OID 格式无效，只允许数字点分格式。" } }]);

  const history = await dispatch("GET", "/api/admin/snmp-history?limit=12");
  assert.deepEqual(history.responses, [{ status: 200, body: { type: "snmp", limit: 12 } }]);
  const events = await dispatch("GET", "/api/admin/events");
  assert.deepEqual(events.responses, [{ status: 200, body: { type: "events", limit: 80 } }]);

  const unmatched = await dispatch("GET", "/api/admin/snmp-test");
  assert.equal(unmatched.handled, false);
  assert.deepEqual(unmatched.responses, []);
});
