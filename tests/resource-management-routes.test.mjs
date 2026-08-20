import test from "node:test";
import assert from "node:assert/strict";
import { handleResourceManagementRoutes } from "../src/resource-management-routes.mjs";

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const session = { auth: { token: "synthetic" }, client: { getVlans: async (...args) => { calls.push(["get-vlans", ...args]); return { rows: [{ vlan: 100 }] }; } } };
  const dependencies = {
    getResourceUsers: async (query) => ({ query }),
    cleanResourceInstallationAddresses: async () => ({ count: 2 }),
    getResourceVlanSnapshot: async (oltIp) => ({ oltIp, rows: [] }),
    replaceResourceVlans: async (input) => { calls.push(["replace-vlans", input]); return { count: input.rows.length }; },
    resourceTargetOlt: (olts, id) => olts.find((olt) => olt.id === id) || (() => { throw Object.assign(new Error("OLT 不存在。"), { status: 404 }); })(),
    activeNmseSession: () => session,
    resourceGridRank: () => "grid-1",
    resourceUserSync: {
      progressFor: (id) => ({ oltId: id, running: false }),
      syncComplete: async (input) => { calls.push(["sync", input]); return { count: 3 }; },
      saveCheckpoint: async (input) => { calls.push(["checkpoint", input]); return { count: input.maxPages }; }
    },
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    olts: [{ id: "olt-1", host: "192.0.2.1" }],
    clearNmseSession: () => calls.push(["clear-session"]),
    ...overrides
  };
  return { responses, calls, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const handled = await handleResourceManagementRoutes({ method, body: options.body }, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("resource management routes keep read/query and sync dependency boundaries", async () => {
  const users = await dispatch("GET", "/api/admin/resource-management/users?oltId=olt-1&q=alice");
  assert.deepEqual(users.responses[0], { status: 200, body: { rows: { query: { oltIp: "192.0.2.1", q: "alice" } } } });

  const progress = await dispatch("GET", "/api/admin/resource-management/sync-users/progress?oltId=olt-1");
  assert.deepEqual(progress.responses[0].body, { oltId: "olt-1", running: false });

  const sync = await dispatch("POST", "/api/admin/resource-management/sync-users", { body: { oltId: "olt-1" } });
  assert.deepEqual(sync.responses[0].body, { ok: true, count: 3 });
  assert.equal(sync.calls[0][0], "sync");

  const checkpoint = await dispatch("POST", "/api/admin/resource-management/sync-users/checkpoint", { body: { oltId: "olt-1", pages: 999 } });
  assert.deepEqual(checkpoint.responses[0].body, { ok: true, count: 50 });
  assert.equal(checkpoint.calls[0][0], "checkpoint");
  assert.equal(checkpoint.calls[0][1].maxPages, 50);
});

test("resource management routes preserve cleanup, VLAN sync, and 401 invalidation", async () => {
  const cleanup = await dispatch("POST", "/api/admin/resource-management/clean-addresses");
  assert.deepEqual(cleanup.responses[0].body, { ok: true, count: 2 });

  const vlans = await dispatch("POST", "/api/admin/resource-management/sync-vlans", { body: { oltId: "olt-1" } });
  assert.deepEqual(vlans.responses[0].body, { ok: true, count: 1, snapshot: { oltIp: "192.0.2.1", rows: [] } });
  assert.equal(vlans.calls[0][0], "get-vlans");
  assert.equal(vlans.calls[1][0], "replace-vlans");

  const unauthorized = await dispatch("POST", "/api/admin/resource-management/sync-users", {
    body: { oltId: "olt-1" },
    dependencies: {
      activeNmseSession: () => { throw Object.assign(new Error("会话失效"), { status: 401 }); }
    }
  });
  assert.deepEqual(unauthorized.responses, [{ status: 401, body: { ok: false, error: "会话失效" } }]);
  assert.deepEqual(unauthorized.calls, [["clear-session"]]);

  const unmatched = await dispatch("GET", "/api/admin/resource-management/unknown");
  assert.equal(unmatched.handled, false);
});
