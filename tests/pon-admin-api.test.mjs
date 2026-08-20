import test from "node:test";
import assert from "node:assert/strict";
import { createPonAdminApi } from "../src/pon-admin-api.mjs";

test("PON admin API centralizes list and save request contracts", async () => {
  const calls = [];
  const api = createPonAdminApi({
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/admin/pon-ports") return new Response(JSON.stringify({ ponPorts: [{ ponPort: "1/1/1" }] }), { status: 200 });
      return new Response(JSON.stringify({ count: 1 }), { status: 200 });
    }
  });

  assert.deepEqual(await api.list(), [{ ponPort: "1/1/1" }]);
  assert.deepEqual(await api.save([{ ponPort: "1/1/1" }]), { count: 1 });
  assert.equal(calls[0].path, "/api/admin/pon-ports");
  assert.equal(calls[1].path, "/api/admin/import-pon-ports");
  assert.deepEqual(JSON.parse(calls[1].options.body), { rows: [{ ponPort: "1/1/1" }] });
});

test("PON admin API preserves server errors and requires fetch", async () => {
  assert.throws(() => createPonAdminApi(), /需要注入 fetch/);
  const api = createPonAdminApi({ fetch: async () => new Response(JSON.stringify({ error: "台账失败" }), { status: 400 }) });
  await assert.rejects(api.save([], "导入失败"), /台账失败/);
});
