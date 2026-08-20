import test from "node:test";
import assert from "node:assert/strict";
import { createOltAdminApi } from "../src/olt-admin-api.mjs";

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 400, async json() { return body; } };
}

test("OLT admin API centralizes list and save contracts", async () => {
  const calls = [];
  const api = createOltAdminApi({
    fetch: async (...args) => {
      calls.push(args);
      return response({ olts: [{ id: "olt-1" }], adminOlts: [{ id: "olt-1", host: "192.0.2.1" }] });
    }
  });
  const rows = [{ id: "olt-1", host: "192.0.2.1" }];

  assert.deepEqual(await api.list(), { olts: [{ id: "olt-1" }], adminOlts: [{ id: "olt-1", host: "192.0.2.1" }] });
  assert.deepEqual(await api.save(rows), { olts: [{ id: "olt-1" }], adminOlts: [{ id: "olt-1", host: "192.0.2.1" }] });
  assert.equal(calls[0][0], "/api/admin/olts");
  assert.equal(calls[1][0], "/api/admin/olts");
  assert.deepEqual(calls[1][1], {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ olts: rows })
  });
});

test("OLT admin API keeps server errors and requires fetch", async () => {
  const api = createOltAdminApi({ fetch: async () => response({ error: "禁止保存" }, false) });
  await assert.rejects(api.save([]), /禁止保存/);
  assert.throws(() => createOltAdminApi({ fetch: null }), /requires fetch/);
});
