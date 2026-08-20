import test from "node:test";
import assert from "node:assert/strict";
import { createBackupApi } from "../src/backup-api.mjs";

test("backup API keeps Web export and restore contracts", async () => {
  const calls = [];
  const api = createBackupApi({
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/admin/backup" || path === "/api/admin/backup/encrypted") return new Response("sqlite", { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });

  assert.equal(await (await api.exportSqlite()).text(), "sqlite");
  assert.equal(await (await api.exportEncrypted("secret")).text(), "sqlite");
  await api.restoreEncrypted(new Blob(["encrypted"]), "master");
  assert.deepEqual(await api.restoreSqlite(new Blob(["sqlite"])), { ok: true });
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/admin/backup",
    "/api/admin/backup/encrypted",
    "/api/admin/restore-encrypted",
    "/api/admin/restore"
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), { password: "secret" });
  assert.equal(calls[2].options.headers["X-OLT-Manager-Backup-Password"], "master");
});

test("backup API rejects Web errors and incomplete construction", async () => {
  assert.throws(() => createBackupApi(), /需要注入 fetch/);
  const api = createBackupApi({ fetch: async () => new Response(JSON.stringify({ error: "还原失败" }), { status: 400 }) });
  await assert.rejects(api.restoreSqlite(new Blob(["bad"])), /还原失败/);
  await assert.rejects(api.exportEncrypted("secret"), /加密备份导出失败/);
});
