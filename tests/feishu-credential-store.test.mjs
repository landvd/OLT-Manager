import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFeishuCredentialStore } = require("../electron/feishu-credential-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8")
  };
}

test("desktop Feishu credential store keeps app secrets out of plaintext", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-feishu-credentials-"));
  const store = createFeishuCredentialStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  const reference = await store.writeSecret("secret-value");
  assert.match(reference, /^feishu-app-secret-/);
  assert.equal(await store.readSecret(reference), "secret-value");
  assert.doesNotMatch(await fs.readFile(path.join(directory, "feishu-credentials.json"), "utf8"), /secret-value/);
});

test("desktop Feishu credential store fails closed when OS encryption is unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-feishu-credentials-"));
  const store = createFeishuCredentialStore({
    dataDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => false }
  });
  await assert.rejects(() => store.writeSecret("secret-value"), /OS encryption unavailable/);
});
