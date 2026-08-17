import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createOssAutoLoginStore } from "../src/oss-auto-login-store.mjs";

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { return Buffer.from([...value].reverse().join(""), "utf8"); },
    decryptString(value) { return [...value.toString("utf8")].reverse().join(""); }
  };
}

test("OSS/NGB auto-login store persists only OS-encrypted ciphertext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olt-oss-autologin-"));
  const store = createOssAutoLoginStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  await store.save("test-only-secret");
  assert.equal(await store.configured(), true);
  assert.equal(await store.read(), "test-only-secret");
  assert.doesNotMatch(await readFile(join(directory, "oss-ngb-autologin.json"), "utf8"), /test-only-secret/);
  await store.clear();
  assert.equal(await store.configured(), false);
});

test("OSS/NGB auto-login store fails closed without OS encryption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olt-oss-autologin-disabled-"));
  const store = createOssAutoLoginStore({ dataDirectory: directory, safeStorage: { isEncryptionAvailable: () => false } });
  assert.equal(store.isAvailable(), false);
  await assert.rejects(() => store.save("test-only-secret"), /系统加密存储/);
  assert.equal(await store.configured(), false);
});
