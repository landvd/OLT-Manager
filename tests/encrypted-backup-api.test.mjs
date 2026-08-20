import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-encrypted-api-"));
const { startServer } = await import("../src/server.mjs");

const LOCAL_PASSWORD = "synthetic-local-password";
const BACKUP_PASSWORD = "synthetic-backup-password";

async function request(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  let data = null;
  if ((response.headers.get("content-type") || "").startsWith("application/json")) data = JSON.parse(bytes.toString("utf8"));
  return { response, bytes, data };
}

test("encrypted backup API authenticates, round-trips, and fails closed before replacing the old snapshot", async (t) => {
  const started = await startServer({ port: 0, authRequired: true, authPassword: LOCAL_PASSWORD });
  t.after(() => started.server.close());

  const login = await request(started.url, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: LOCAL_PASSWORD })
  });
  assert.equal(login.response.status, 200);
  const authorization = { authorization: `Bearer ${login.data.token}` };

  const before = await request(started.url, "/api/admin/olts", { headers: authorization });
  assert.equal(before.response.status, 200);

  const missingExportPassword = await request(started.url, "/api/admin/backup/encrypted", {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(missingExportPassword.response.status, 400);
  assert.equal(missingExportPassword.data.code, "BACKUP_PASSWORD_REQUIRED");

  const exported = await request(started.url, "/api/admin/backup/encrypted", {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ password: BACKUP_PASSWORD })
  });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.response.headers.get("content-type"), "application/vnd.olt-manager.encrypted-backup");
  assert.equal(exported.bytes.includes(Buffer.from(BACKUP_PASSWORD)), false);
  assert.equal(exported.bytes.includes(Buffer.from("SQLite format 3")), false);

  const missingRestorePassword = await request(started.url, "/api/admin/restore-encrypted", {
    method: "POST",
    headers: { ...authorization, "content-type": "application/octet-stream" },
    body: exported.bytes
  });
  assert.equal(missingRestorePassword.response.status, 400);
  assert.equal(missingRestorePassword.data.code, "BACKUP_PASSWORD_REQUIRED");

  const wrongPassword = await request(started.url, "/api/admin/restore-encrypted", {
    method: "POST",
    headers: { ...authorization, "content-type": "application/octet-stream", "x-olt-manager-backup-password": "wrong-password" },
    body: exported.bytes
  });
  assert.equal(wrongPassword.response.status, 400);
  assert.equal(wrongPassword.data.code, "ENCRYPTED_BACKUP_INVALID");

  const tampered = Buffer.from(exported.bytes);
  tampered[tampered.length - 1] ^= 1;
  const tamperResult = await request(started.url, "/api/admin/restore-encrypted", {
    method: "POST",
    headers: { ...authorization, "content-type": "application/vnd.olt-manager.encrypted-backup", "x-olt-manager-backup-password": BACKUP_PASSWORD },
    body: tampered
  });
  assert.equal(tamperResult.response.status, 400);
  assert.equal(tamperResult.data.code, "ENCRYPTED_BACKUP_INVALID");

  const afterFailure = await request(started.url, "/api/admin/olts", { headers: authorization });
  assert.deepEqual(afterFailure.data, before.data);

  const restored = await request(started.url, "/api/admin/restore-encrypted", {
    method: "POST",
    headers: { ...authorization, "content-type": "application/vnd.olt-manager.encrypted-backup", "x-olt-manager-backup-password": BACKUP_PASSWORD },
    body: exported.bytes
  });
  assert.equal(restored.response.status, 200);
  assert.deepEqual((await request(started.url, "/api/admin/olts", { headers: authorization })).data, before.data);
});

test("encrypted backup API rejects an unknown content type", async (t) => {
  const started = await startServer({ port: 0, authRequired: true, authPassword: LOCAL_PASSWORD });
  t.after(() => started.server.close());
  const login = await request(started.url, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: LOCAL_PASSWORD })
  });
  const result = await request(started.url, "/api/admin/backup/encrypted", {
    method: "POST",
    headers: { authorization: `Bearer ${login.data.token}`, "content-type": "text/plain" },
    body: "password"
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.code, "ENCRYPTED_BACKUP_INVALID");
});
