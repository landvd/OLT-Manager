import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEncryptedBackupPassword } from "../src/backup-view-state.mjs";
import { extractFunctionSource, readRendererSource } from "./renderer-source.mjs";

const source = readRendererSource();
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

test("encrypted backup stays offline in the renderer and .sqlite.enc gets a clear message", () => {
  const restoreBlock = extractFunctionSource(source, "restoreProjectBackup");
  // 加密备份于 1.2.6 有意下线：界面不提供导出入口，也不再收集主密码。
  assert.doesNotMatch(source, /function exportEncryptedBackup|backupApi\.exportEncrypted|backupApi\.restoreEncrypted/);
  assert.doesNotMatch(source, /state\.encryptedBackup/);
  assert.match(restoreBlock, /isEncryptedBackupFile\(file\)\) throw new Error\("加密备份（\.sqlite\.enc）功能已下线/);
  assert.doesNotMatch(restoreBlock, /localStorage|sessionStorage|console\.(log|error)/);
});
