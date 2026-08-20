import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEncryptedBackupPassword } from "../src/backup-view-state.mjs";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const backupApiSource = await readFile(new URL("../src/backup-api.mjs", import.meta.url), "utf8");

test("encrypted backup password validation enforces length and confirmation", () => {
  assert.equal(validateEncryptedBackupPassword("short", "short").reason, "too-short");
  assert.equal(validateEncryptedBackupPassword("12345678", "87654321").reason, "mismatch");
  assert.deepEqual(validateEncryptedBackupPassword("12345678", "12345678"), { valid: true, reason: "ok" });
});

test("encrypted backup UI uses the versioned HTTP endpoints and password header", () => {
  assert.match(backupApiSource, /fetch\("\/api\/admin\/backup\/encrypted"/);
  assert.match(backupApiSource, /body: JSON\.stringify\(\{ password: String\(password \|\| ""\) \}\)/);
  assert.match(backupApiSource, /fetch\("\/api\/admin\/restore-encrypted"/);
  assert.match(backupApiSource, /"X-OLT-Manager-Backup-Password": String\(password \|\| ""\)/);
  assert.match(source, /\.sqlite\.enc/);
  assert.doesNotMatch(source, /window\.prompt/);
});

test("encrypted backup password fields are cleared at request completion", () => {
  const exportBlock = source.slice(source.indexOf("async function exportEncryptedBackup"), source.indexOf("function triggerProjectRestore"));
  const restoreBlock = source.slice(source.indexOf("async function restoreProjectBackup"), source.indexOf("function triggerExcelImport"));
  assert.match(exportBlock, /finally \{[\s\S]*clearEncryptedBackupPasswords\(state\.encryptedBackup\)/);
  assert.match(restoreBlock, /finally \{[\s\S]*clearEncryptedBackupPasswords\(state\.encryptedBackup\)/);
  assert.match(source, /state\.encryptedBackup = createEncryptedBackupState\(\)/);
  assert.doesNotMatch(exportBlock, /localStorage|sessionStorage|console\.(log|error)/);
  assert.doesNotMatch(restoreBlock, /localStorage|sessionStorage|console\.(log|error)/);
});
