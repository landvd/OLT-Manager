import test from "node:test";
import assert from "node:assert/strict";
import { handleResourceSyncRoutes } from "../src/resource-sync-routes.mjs";

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const tasks = [{ id: "task-1", operation: "full", oltId: "", status: "pending", runAt: "2099-01-01T00:00:00.000Z" }];
  const dependencies = {
    getResourceSyncTasks: async () => tasks,
    createResourceSyncTask: async (task) => ({ ...task, status: "pending" }),
    updateResourceSyncTask: async (id, update) => ({ id, ...update }),
    deleteResourceSyncTask: async (id) => calls.push(["delete", id]),
    resourceSyncScheduler: {
      schedule: (task) => calls.push(["schedule", task.id]),
      clear: (id) => calls.push(["clear", id])
    },
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    createTaskId: () => "task-created",
    ...overrides
  };
  return { responses, calls, tasks, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const handled = await handleResourceSyncRoutes({ method, body: options.body }, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("resource sync task routes create, list and schedule through injected dependencies", async () => {
  const list = await dispatch("GET", "/api/admin/resource-sync-tasks");
  assert.equal(list.handled, true);
  assert.deepEqual(list.responses[0], { status: 200, body: { rows: list.tasks } });

  const created = await dispatch("POST", "/api/admin/resource-sync-tasks", {
    body: { operation: "nmse", runAt: "2099-01-02T03:04:05.000Z", repeatDays: 7 }
  });
  assert.equal(created.responses[0].status, 200);
  assert.deepEqual(created.responses[0].body.task, {
    id: "task-created",
    operation: "nmse",
    runAt: "2099-01-02T03:04:05.000Z",
    repeatDays: 7,
    status: "pending"
  });
  assert.deepEqual(created.calls, [["schedule", "task-created"]]);
});

test("resource sync task routes preserve validation and cancellation/deletion rules", async () => {
  const invalid = await dispatch("POST", "/api/admin/resource-sync-tasks", { body: { operation: "full", runAt: "2000-01-01T00:00:00Z" } });
  assert.deepEqual(invalid.responses, [{ status: 400, body: { ok: false, error: "执行时间必须晚于当前时间。" } }]);
  const oldShape = await dispatch("POST", "/api/admin/resource-sync-tasks", { body: { oltId: "olt-1", operation: "nmse", runAt: "2099-01-01T00:00:00Z" } });
  assert.equal(oldShape.responses[0].status, 400);

  const canceled = await dispatch("DELETE", "/api/admin/resource-sync-tasks/task-1");
  assert.deepEqual(canceled.responses[0].body, { ok: true, task: { id: "task-1", status: "canceled", error: "", resultCount: 0 } });
  assert.deepEqual(canceled.calls, [["clear", "task-1"]]);

  const deleted = await dispatch("DELETE", "/api/admin/resource-sync-tasks/task-1/delete");
  assert.deepEqual(deleted.responses[0], { status: 200, body: { ok: true, id: "task-1" } });
  assert.deepEqual(deleted.calls, [["clear", "task-1"], ["delete", "task-1"]]);

  const unmatched = await dispatch("GET", "/api/admin/resource-sync-tasks/task-1");
  assert.equal(unmatched.handled, false);
  assert.deepEqual(unmatched.responses, []);
});
