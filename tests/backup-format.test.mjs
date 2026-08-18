import assert from "node:assert/strict";
import test from "node:test";
import { detectBackupFormat } from "../src/backup-format.mjs";

test("detects WEB SQLite backups by file signature", () => {
  assert.equal(detectBackupFormat({
    name: "olt-manager-backup.sqlite",
    type: "application/vnd.sqlite3",
    bytes: new TextEncoder().encode("SQLite format 3\u0000\u0000\u0000")
  }), "sqlite");
});

test("detects desktop combined JSON backups by content", () => {
  assert.equal(detectBackupFormat({
    name: "backup.sqlite",
    type: "application/octet-stream",
    bytes: new TextEncoder().encode('{"format":"olt-manager/combined-backup/v1"}')
  }), "combined-json");
});

test("uses supported backup extensions when file bytes are unavailable", () => {
  assert.equal(detectBackupFormat({ name: "backup.oltbackup.json" }), "combined-json");
  assert.equal(detectBackupFormat({ name: "backup.sqlite" }), "sqlite");
  assert.equal(detectBackupFormat({ name: "backup.bin" }), "unknown");
});
