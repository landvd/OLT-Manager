import assert from "node:assert/strict";
import test from "node:test";
import {
  clearEncryptedBackupPasswords,
  createEncryptedBackupState,
  isEncryptedBackupFile,
  validateEncryptedBackupPassword
} from "../src/backup-view-state.mjs";

test("encrypted backup state starts with the existing fields and values", () => {
  assert.deepEqual(createEncryptedBackupState(), {
    password: "",
    confirmation: "",
    exporting: false,
    importing: false
  });
});

test("password cleanup removes only in-memory password fields", () => {
  const state = { password: "secret123", confirmation: "secret123", exporting: true, importing: false };
  assert.deepEqual(clearEncryptedBackupPasswords(state), {
    password: "",
    confirmation: "",
    exporting: true,
    importing: false
  });
  assert.equal(state.password, "secret123");
});

test("password validation keeps existing length and confirmation semantics", () => {
  assert.equal(validateEncryptedBackupPassword("short", "short").reason, "too-short");
  assert.equal(validateEncryptedBackupPassword("12345678", "87654321").reason, "mismatch");
  assert.deepEqual(validateEncryptedBackupPassword("12345678", "12345678"), { valid: true, reason: "ok" });
});

test("encrypted backup detection keeps extension and MIME behavior", () => {
  assert.equal(isEncryptedBackupFile({ name: "snapshot.SQLITE.ENC" }), true);
  assert.equal(isEncryptedBackupFile({ type: "application/vnd.olt-manager.encrypted-backup" }), true);
  assert.equal(isEncryptedBackupFile({ name: "snapshot.sqlite" }), false);
  assert.equal(isEncryptedBackupFile({ name: "snapshot.sqlite.enc", type: "application/octet-stream" }), true);
});
