import test from "node:test";
import assert from "node:assert/strict";
import { handleMergedOnuRoutes } from "../src/merged-onu-routes.mjs";

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const dependencies = {
    publicMergedOnuSyncState: () => ({ status: "idle" }),
    getMergedOnuSyncRuns: async () => [{ id: "run-1", backupPath: "/private/backup.sqlite" }],
    getMergedOnuConflicts: async (query) => ({ query }),
    getMergedOnuDatasetStatus: async () => ({ revision: "rev-1", count: 2 }),
    getMergedOnuSnapshots: async (query) => [{ oltIp: query.oltIp, loid: "alice" }, { oltIp: query.oltIp, loid: "bob" }],
    runMergedOnuSourceSync: async (operation, options) => { calls.push(["source", operation, options]); return { runId: "run-source", count: 2, source: { revision: "rev-source" } }; },
    runMergedOnuManualMerge: async (options) => { calls.push(["merge", options]); return { runId: "run-merge", revision: "rev-merge", networkCount: 1, nmseCount: 1, mergedCount: 1, conflictCount: 0, conflicts: [], backup: { id: "backup" } }; },
    runMergedOnuSync: async (options) => { calls.push(["full", options]); return { runId: "run-full", revision: "rev-full", networkCount: 1, nmseCount: 1, mergedCount: 1, conflictCount: 0, conflicts: [], backup: { id: "backup" } }; },
    resourceTargetOlt: (olts, id) => olts.find((olt) => olt.id === id),
    mergedSyncError: (message, status) => Object.assign(new Error(message), { status }),
    mergedSyncErrorMessage: () => "合并同步失败（已脱敏）。",
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    olts: [{ id: "olt-1", host: "192.0.2.1" }],
    ...overrides
  };
  return { responses, calls, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const handled = await handleMergedOnuRoutes({ method, body: options.body }, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("merged ONU routes sanitize run paths, filter snapshots, and pass idempotency keys", async () => {
  const runs = await dispatch("GET", "/api/admin/merged-onu/runs");
  assert.deepEqual(runs.responses[0].body.rows, [{ id: "run-1", backupPath: "backup.sqlite" }]);

  const snapshots = await dispatch("GET", "/api/admin/merged-onu/snapshots?oltId=olt-1&q=alice");
  assert.deepEqual(snapshots.responses[0].body.rows, [{ oltIp: "192.0.2.1", loid: "alice" }]);

  const source = await dispatch("POST", "/api/admin/merged-onu/sync/network", { body: { idempotencyKey: "key-1" } });
  assert.equal(source.responses[0].body.revision, "rev-source");
  assert.deepEqual(source.calls, [["source", "network", { idempotencyKey: "key-1" }]]);
});

test("merged ONU routes reject partial replacement and preserve operation responses", async () => {
  const partial = await dispatch("POST", "/api/admin/merged-onu/sync", { body: { oltId: "olt-1" } });
  assert.deepEqual(partial.responses, [{ status: 400, body: { ok: false, error: "合并 ONU 同步仅支持全量同步，不接受 oltId 参数。" } }]);
  assert.deepEqual(partial.calls, []);

  const merge = await dispatch("POST", "/api/admin/merged-onu/merge", { body: { idempotencyKey: "key-2" } });
  assert.deepEqual(merge.responses[0].body, {
    ok: true,
    operation: "merge",
    runId: "run-merge",
    recovered: false,
    recovery: null,
    revision: "rev-merge",
    networkCount: 1,
    nmseCount: 1,
    mergedCount: 1,
    conflictCount: 0,
    conflicts: [],
    backup: { id: "backup" }
  });
  assert.deepEqual(merge.calls, [["merge", { idempotencyKey: "key-2" }]]);
});
