import test from "node:test";
import assert from "node:assert/strict";
import { createProjectApi } from "../src/project-api.mjs";

function fakeResponse(data, ok = true) {
  return { ok, json: async () => data };
}

test("project API centralizes list/save and keeps credentials out of payloads", async () => {
  const requests = [];
  const api = createProjectApi({
    fetch: async (path, options = {}) => {
      requests.push({ path, options });
      return fakeResponse({ project: { id: "p-1" }, rows: [] });
    }
  });

  assert.deepEqual(await api.list(" 项目 "), []);
  assert.deepEqual(await api.save({ id: "p-1", name: " 项目 ", vlan: 100, password: "must-not-send" }), { id: "p-1" });
  assert.equal(requests[0].path, "/api/admin/projects?q=%E9%A1%B9%E7%9B%AE");
  assert.equal(requests[1].path, "/api/admin/projects/p-1");
  const payload = JSON.parse(requests[1].options.body);
  assert.deepEqual(payload, { name: "项目", vlan: 100, address: "", contactName: "", contactPhone: "", contactNote: "" });
  assert.equal(Object.hasOwn(payload, "password"), false);
});

test("project API uses encoded IDs and stable error messages", async () => {
  const requests = [];
  const api = createProjectApi({
    fetch: async (path, options) => {
      requests.push({ path, options });
      return path.includes("/onus/") ? fakeResponse({ error: "bad" }, false) : fakeResponse({ rows: [{ id: 1 }] });
    }
  });

  assert.deepEqual(await api.listOnus("project/1"), [{ id: 1 }]);
  await assert.rejects(() => api.removeOnu("project/1", "onu/2"), /bad/);
  assert.equal(requests[0].path, "/api/admin/projects/project%2F1/onus");
  assert.equal(requests[1].path, "/api/admin/projects/project%2F1/onus/onu%2F2");
});
