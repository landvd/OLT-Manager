import test from "node:test";
import assert from "node:assert/strict";
import { decryptOssNgbPassword, encryptOssNgbPassword } from "../src/oss-credential-crypto.mjs";

test("OSS/NGB password encryption round-trips without storing plaintext", () => {
  const password = "test-only-secret";
  const masterPassword = "migration-master-only";
  const credential = encryptOssNgbPassword(password, masterPassword);

  assert.equal(decryptOssNgbPassword(credential, masterPassword), password);
  assert.notEqual(credential.ciphertext, password);
  assert.doesNotMatch(JSON.stringify(credential), /test-only-secret|migration-master-only/);
  assert.throws(() => decryptOssNgbPassword(credential, "wrong-master-only"));
});

test("OSS/NGB encryption rejects weak migration master passwords", () => {
  assert.throws(() => encryptOssNgbPassword("test-only-secret", "short"), /至少需要 8 位/);
});
