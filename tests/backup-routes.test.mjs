import test from "node:test";
import assert from "node:assert/strict";
import { handleBackupRoutes } from "../src/backup-routes.mjs";

function createResponse() {
  return {
    headers: null,
    status: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

function createHarness(overrides = {}) {
  const responses = [];
  const calls = [];
  const dependencies = {
    exportDatabaseBackup: async () => Buffer.from("sqlite-backup"),
    restoreDatabaseBackup: async (backup) => calls.push(["restore", Buffer.from(backup).toString()]),
    validateDatabaseBackup: async () => calls.push(["validate"]),
    createEncryptedBackupContainer: (backup, password, options) => {
      calls.push(["encrypt", Buffer.from(backup).toString(), password, options]);
      return Buffer.from("encrypted-container");
    },
    decryptEncryptedBackupContainer: (container, password) => {
      calls.push(["decrypt", Buffer.from(container).toString(), password]);
      return Buffer.from("decrypted-backup");
    },
    readEncryptedBackupPasswordBody: async () => "synthetic-password",
    readEncryptedBackupContainer: async () => Buffer.from("encrypted-container"),
    readBinaryBody: async () => Buffer.from("sqlite-backup"),
    encryptedBackupError: (code) => Object.assign(new Error(code), { code }),
    encryptedBackupPasswordHeader: "x-olt-manager-backup-password",
    backupCleanupRuntime: {
      status: () => ({ state: "scheduled", running: false }),
      trigger: async ({ confirmed }) => { calls.push(["cleanup", confirmed]); return { dryRun: !confirmed, summary: {} }; }
    },
    readBody: async (req) => req.body || {},
    json: async (_res, status, body) => responses.push({ status, body }),
    clearRemoteSessions: () => calls.push(["clear-sessions"]),
    ...overrides
  };
  return { responses, calls, dependencies };
}

async function dispatch(method, path, options = {}) {
  const harness = createHarness(options.dependencies);
  const response = createResponse();
  const handled = await handleBackupRoutes({ method, headers: options.headers || {}, body: options.body }, response, new URL(`http://localhost${path}`), harness.dependencies);
  return { ...harness, response, handled };
}

test("backup routes preserve encrypted export and restore ordering", async () => {
  const exported = await dispatch("POST", "/api/admin/backup/encrypted");
  assert.equal(exported.handled, true);
  assert.equal(exported.response.status, 200);
  assert.equal(exported.response.body.toString(), "encrypted-container");
  assert.deepEqual(exported.calls, [["encrypt", "sqlite-backup", "synthetic-password", { purpose: "sqlite-full" }]]);

  const restored = await dispatch("POST", "/api/admin/restore-encrypted", {
    headers: { "x-olt-manager-backup-password": "synthetic-password" }
  });
  assert.equal(restored.handled, true);
  assert.deepEqual(restored.responses, [{ status: 200, body: { ok: true } }]);
  assert.deepEqual(restored.calls, [
    ["decrypt", "encrypted-container", "synthetic-password"],
    ["validate"],
    ["restore", "decrypted-backup"],
    ["clear-sessions"]
  ]);
});

test("backup routes keep ordinary backup compatibility and fail closed on invalid restore", async () => {
  const backup = await dispatch("GET", "/api/admin/backup");
  assert.equal(backup.handled, true);
  assert.equal(backup.response.headers["content-type"], "application/vnd.sqlite3");
  assert.equal(backup.response.body.toString(), "sqlite-backup");

  const failure = await dispatch("POST", "/api/admin/restore", {
    dependencies: {
      restoreDatabaseBackup: async () => { throw Object.assign(new Error("备份损坏"), { status: 400 }); }
    }
  });
  assert.deepEqual(failure.responses, [{ status: 400, body: { ok: false, error: "备份损坏" } }]);
  assert.deepEqual(failure.calls, []);

  const missingPassword = await dispatch("POST", "/api/admin/restore-encrypted");
  assert.deepEqual(missingPassword.responses, [{ status: 400, body: { ok: false, code: "BACKUP_PASSWORD_REQUIRED", error: "加密备份请求无效。" } }]);
});

test("backup cleanup routes expose status and require explicit confirmation for execution", async () => {
  const status = await dispatch("GET", "/api/admin/backup/cleanup/status");
  assert.deepEqual(status.responses, [{ status: 200, body: { ok: true, state: "scheduled", running: false } }]);

  const planned = await dispatch("POST", "/api/admin/backup/cleanup/trigger", { body: {} });
  assert.deepEqual(planned.responses, [{ status: 200, body: { ok: true, dryRun: true, summary: {} } }]);
  assert.deepEqual(planned.calls, [["cleanup", false]]);

  const executed = await dispatch("POST", "/api/admin/backup/cleanup/trigger", { body: { confirmed: true } });
  assert.deepEqual(executed.responses, [{ status: 200, body: { ok: true, dryRun: false, summary: {} } }]);
  assert.deepEqual(executed.calls, [["cleanup", true]]);
});
