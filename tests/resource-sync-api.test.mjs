import test from "node:test";
import assert from "node:assert/strict";
import { createResourceSyncApi } from "../src/resource-sync-api.mjs";

test("resource sync API maps Chinese schedule input and encodes task IDs", async () => {
  const calls = [];
  const api = createResourceSyncApi({
    request: async (path, options) => {
      calls.push({ path, options });
      return { rows: [], ok: true };
    }
  });
  await api.createTask({ operation: "full", runAt: "2026-08-21T01:00:00.000Z", repeatEnabled: false, repeatDays: 20 });
  await api.cancelTask("task/1");
  await api.deleteTask("task/1");
  assert.equal(JSON.parse(calls[0].options.body).repeatDays, 0);
  assert.equal(calls[1].path, "/api/admin/resource-sync-tasks/task%2F1");
  assert.equal(calls[2].path, "/api/admin/resource-sync-tasks/task%2F1/delete");
});

test("resource sync API keeps merged operations on fixed read-only endpoints", async () => {
  const calls = [];
  const api = createResourceSyncApi({ request: async (path, options) => { calls.push({ path, options }); return { rows: [] }; } });
  await api.listMergedSnapshots({ oltId: "olt-1" });
  await api.syncMerged("network");
  await api.syncMerged("unknown");
  assert.equal(calls[0].path, "/api/admin/merged-onu/snapshots?oltId=olt-1");
  assert.equal(calls[1].path, "/api/admin/merged-onu/sync/network");
  assert.equal(calls[2].path, "/api/admin/merged-onu/sync");
  assert.equal(calls[1].options.method, "POST");
});
