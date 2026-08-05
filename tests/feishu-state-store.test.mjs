import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFeishuStateStore } = require("../electron/feishu-state-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8")
  };
}

test("desktop Feishu state store keeps state encrypted and round-trippable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-feishu-state-"));
  const store = createFeishuStateStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  const value = { format: "olt-manager/feishu-state/v1", enabled: false, operators: [] };
  await store.write(value);
  assert.deepEqual(await store.read(), value);
  const stateFile = await fs.readFile(path.join(directory, "feishu-state.enc"), "utf8");
  assert.doesNotMatch(stateFile, /operators|enabled/);
  assert.equal((await fs.readdir(directory)).includes("feishu-state-key.json"), true);
});

test("desktop Feishu state store fails closed when safeStorage is unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-feishu-state-"));
  const store = createFeishuStateStore({
    dataDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => false }
  });
  await assert.rejects(() => store.write({}), /OS encryption unavailable/);
});
