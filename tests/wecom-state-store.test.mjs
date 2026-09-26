import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createWecomStateStore } = require("../electron/wecom-state-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8")
  };
}

test("desktop WeCom state store keeps state encrypted and round-trippable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-wecom-state-"));
  const store = createWecomStateStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  const value = { format: "olt-manager/wecom-state/v1", enabled: true, bot: { botId: "bot_123" } };
  await store.write(value);
  assert.deepEqual(await store.read(), value);
  const stateFile = await fs.readFile(path.join(directory, "wecom-state.enc"), "utf8");
  assert.doesNotMatch(stateFile, /bot_123|enabled/);
  assert.equal((await fs.readdir(directory)).includes("wecom-state-key.json"), true);
});

test("desktop WeCom state store fails closed when safeStorage is unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-wecom-state-"));
  const store = createWecomStateStore({
    dataDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => false }
  });
  await assert.rejects(() => store.write({}), /OS encryption unavailable/);
});

test("desktop WeCom state store recovers gracefully when safeStorage key changes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-wecom-state-heal-"));
  let decryptShouldFail = false;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => {
      if (decryptShouldFail) throw new Error("Error: Decryption failed (authentication failed)");
      return value.toString("utf8");
    }
  };
  const store = createWecomStateStore({ dataDirectory: directory, safeStorage });
  await store.write({ format: "olt-manager/wecom-state/v1", enabled: true });

  // 模拟设备迁移或钥匙串密钥变动
  decryptShouldFail = true;
  assert.equal(await store.read(), undefined);

  // 重新恢复正常加密并允许写入新状态
  decryptShouldFail = false;
  await store.write({ format: "olt-manager/wecom-state/v1", enabled: false });
  assert.deepEqual(await store.read(), { format: "olt-manager/wecom-state/v1", enabled: false });
});
