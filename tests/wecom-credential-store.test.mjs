import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createWecomCredentialStore } = require("../electron/wecom-credential-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8")
  };
}

test("desktop WeCom credential store keeps bot secrets out of plaintext", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-wecom-credentials-"));
  const store = createWecomCredentialStore({ dataDirectory: directory, safeStorage: fakeSafeStorage() });
  const reference = await store.writeSecret("wecom-secret-123456");
  assert.match(reference, /^wecom-bot-secret-/);
  assert.equal(await store.readSecret(reference), "wecom-secret-123456");
  assert.doesNotMatch(await fs.readFile(path.join(directory, "wecom-credentials.json"), "utf8"), /wecom-secret-123456/);
});

test("desktop WeCom credential store fails closed when OS encryption is unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "olt-wecom-credentials-"));
  const store = createWecomCredentialStore({
    dataDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => false }
  });
  await assert.rejects(() => store.writeSecret("secret-value"), /OS encryption unavailable/);
});
