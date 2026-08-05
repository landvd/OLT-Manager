import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCombinedBackupService } = require("../electron/combined-backup.cjs");

function stateFactory(state) {
  return ({ dataDirectory }) => ({
    async read() {
      await fs.access(path.join(dataDirectory, "feishu-state.enc"));
      return structuredClone(state);
    }
  });
}

function credentialFactory(reference) {
  return ({ dataDirectory }) => ({
    async readSecret(value) {
      await fs.access(path.join(dataDirectory, "feishu-credentials.json"));
      if (value !== reference) throw new Error("missing reference");
      return "decrypted only in test adapter";
    }
  });
}

async function makeService({ includeState = true, restoreThrows = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-combined-backup-"));
  const databaseDirectory = path.join(root, "data");
  const feishuDirectory = path.join(root, "user");
  await fs.mkdir(databaseDirectory);
  await fs.mkdir(feishuDirectory);
  if (includeState) {
    await fs.writeFile(path.join(feishuDirectory, "feishu-state.enc"), "encrypted-state");
    await fs.writeFile(path.join(feishuDirectory, "feishu-state-key.json"), "encrypted-key");
    await fs.writeFile(path.join(feishuDirectory, "feishu-credentials.json"), "encrypted-credentials");
  }
  const state = { app: { credentialReference: includeState ? "ref-1" : "" } };
  const service = createCombinedBackupService({
    dataDirectory: databaseDirectory,
    feishuDataDirectory: feishuDirectory,
    safeStorage: {},
    exportDatabaseBackup: async () => Buffer.from("sqlite-data"),
    validateDatabaseBackup: async (bytes) => assert.equal(bytes.toString(), "sqlite-data"),
    restoreDatabaseBackup: async (bytes) => {
      assert.equal(bytes.toString(), "sqlite-data");
      if (restoreThrows) throw new Error("database restore failed");
    },
    createStateStore: stateFactory(state),
    createCredentialStore: credentialFactory("ref-1")
  });
  return { service, feishuDirectory };
}

test("combined backup contains encrypted Feishu files and a verifiable manifest", async () => {
  const { service } = await makeService();
  const archive = JSON.parse((await service.exportBackup()).toString());
  assert.equal(archive.format, "olt-manager/combined-backup/v1");
  assert.deepEqual(Object.keys(archive.manifest).sort(), [
    "database.sqlite", "feishu-credentials.json", "feishu-state-key.json", "feishu-state.enc"
  ]);
  assert.equal(archive.manifest["database.sqlite"].size, 11);
  assert.equal(archive.manifest["database.sqlite"].sha256.length, 64);
  assert.equal(archive.files["feishu-state.enc"].data, Buffer.from("encrypted-state").toString("base64"));
});

test("combined restore fails before mutation on manifest tamper and can restore OLT without Feishu state", async () => {
  const full = await makeService();
  const archive = JSON.parse((await full.service.exportBackup()).toString());
  archive.files["database.sqlite"].data = Buffer.from("tampered").toString("base64");
  await assert.rejects(() => full.service.restoreBackup(Buffer.from(JSON.stringify(archive)), { confirmed: true }), /校验失败/);

  const oltOnly = await makeService({ includeState: false });
  const bytes = await oltOnly.service.exportBackup();
  const result = await oltOnly.service.restoreBackup(bytes, { confirmed: true });
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /Feishu/);
});

test("combined restore rolls Feishu ciphertext back if SQLite restore fails", async () => {
  const { service, feishuDirectory } = await makeService({ restoreThrows: true });
  const before = await fs.readFile(path.join(feishuDirectory, "feishu-state.enc"), "utf8");
  const archive = await service.exportBackup();
  await assert.rejects(() => service.restoreBackup(archive, { confirmed: true }), /database restore failed/);
  assert.equal(await fs.readFile(path.join(feishuDirectory, "feishu-state.enc"), "utf8"), before);
});
