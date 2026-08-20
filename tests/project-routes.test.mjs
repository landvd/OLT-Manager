import test from "node:test";
import assert from "node:assert/strict";
import { handleProjectRoutes } from "../src/project-routes.mjs";

function createHarness(overrides = {}) {
  const calls = [];
  const responses = [];
  const dependencies = {
    getProjects: async (query) => ({ query }),
    createProject: async (body) => ({ id: "created", body }),
    updateProject: async (id, body) => ({ id, body }),
    deleteProject: async (id) => ({ ok: true, id }),
    listProjectOnus: async (id, olts) => ({ id, olts }),
    addProjectOnu: async (id, body) => ({ id, body }),
    updateProjectOnuNote: async (projectId, associationId, body) => ({ projectId, associationId, body }),
    deleteProjectOnu: async (projectId, associationId) => ({ ok: true, projectId, associationId }),
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    olts: [{ id: "olt-1" }],
    ...overrides
  };
  return { calls, responses, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const req = { method, body: options.body };
  const handled = await handleProjectRoutes(req, {}, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, handled };
}

test("project routes match, decode IDs, pass query/body/OLTs, and return handled", async () => {
  const list = await dispatch("GET", "/api/admin/projects?q=school%20a");
  assert.equal(list.handled, true);
  assert.deepEqual(list.responses[0], { status: 200, body: { rows: { query: { q: "school a" } } } });

  const create = await dispatch("POST", "/api/admin/projects", { body: { name: "项目", vlan: 100 } });
  assert.deepEqual(create.responses[0].body, { ok: true, project: { id: "created", body: { name: "项目", vlan: 100 } } });

  const update = await dispatch("PUT", "/api/admin/projects/project%201", { body: { name: "更新" } });
  assert.deepEqual(update.responses[0].body, { ok: true, project: { id: "project 1", body: { name: "更新" } } });

  const remove = await dispatch("DELETE", "/api/admin/projects/project%201");
  assert.deepEqual(remove.responses[0].body, { ok: true, id: "project 1" });

  const onus = await dispatch("GET", "/api/admin/projects/project%201/onus");
  assert.deepEqual(onus.responses[0].body, { ok: true, rows: { id: "project 1", olts: [{ id: "olt-1" }] } });

  const add = await dispatch("POST", "/api/admin/projects/project%201/onus", { body: { onuId: "4" } });
  assert.deepEqual(add.responses[0].body, { ok: true, onu: { id: "project 1", body: { onuId: "4" } } });

  const note = await dispatch("PUT", "/api/admin/projects/project%201/onus/association%202", { body: { note: "新备注" } });
  assert.deepEqual(note.responses[0].body, {
    ok: true,
    onu: { projectId: "project 1", associationId: "association 2", body: { note: "新备注" } }
  });

  const removeOnu = await dispatch("DELETE", "/api/admin/projects/project%201/onus/association%202");
  assert.deepEqual(removeOnu.responses[0].body, { ok: true, projectId: "project 1", associationId: "association 2" });
});

test("project route errors preserve status and unmatched paths return false", async () => {
  const failure = await dispatch("POST", "/api/admin/projects", {
    body: { name: "坏项目" },
    dependencies: {
      createProject: async () => {
        const error = new Error("项目无效");
        error.status = 400;
        throw error;
      }
    }
  });
  assert.deepEqual(failure.responses, [{ status: 400, body: { ok: false, error: "项目无效" } }]);

  const unmatched = await dispatch("GET", "/api/admin/projects/project-1");
  assert.equal(unmatched.handled, false);
  assert.deepEqual(unmatched.responses, []);
});
