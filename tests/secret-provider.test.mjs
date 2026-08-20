import test from "node:test";
import assert from "node:assert/strict";
import { createSecretProvider } from "../src/secret-provider.mjs";

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { return Buffer.from([...value].reverse().join(""), "utf8"); },
    decryptString(value) { return [...value.toString("utf8")].reverse().join(""); }
  };
}

test("SecretProvider uses injected safeStorage for desktop secrets", async () => {
  const provider = createSecretProvider({ safeStorage: fakeSafeStorage() });
  const envelope = await provider.seal("test-only-desktop-secret", {
    mode: "os", purpose: "olt/telnet", reference: "keychain:olt:test"
  });
  assert.equal(envelope.backend, "safeStorage");
  assert.equal(await provider.open(envelope), "test-only-desktop-secret");
  assert.doesNotMatch(JSON.stringify(envelope), /test-only-desktop-secret/);
  assert.equal(provider.metadata(envelope).reference, "keychain:olt:test");
});

test("SecretProvider uses portable AES-GCM when requested", async () => {
  const provider = createSecretProvider({ safeStorage: { isEncryptionAvailable: () => false } });
  const envelope = await provider.seal("test-only-portable-secret", {
    mode: "portable", masterPassword: "test-master-password", purpose: "nmse/login"
  });
  assert.equal(envelope.backend, "masterPassword");
  assert.equal(await provider.open(envelope, { masterPassword: "test-master-password" }), "test-only-portable-secret");
  assert.doesNotMatch(JSON.stringify(envelope), /test-only-portable-secret|test-master-password/);
  await assert.rejects(() => provider.open(envelope, { masterPassword: "wrong-password" }), /可迁移凭据解密失败/);
});

test("auto mode prefers OS encryption but remains explicit about portable fallback", async () => {
  const desktop = createSecretProvider({ safeStorage: fakeSafeStorage() });
  assert.equal((await desktop.seal("test-only-secret", { mode: "auto" })).backend, "safeStorage");

  const node = createSecretProvider();
  const envelope = await node.seal("test-only-secret", { mode: "auto", masterPassword: "test-master-password" });
  assert.equal(envelope.backend, "masterPassword");
  assert.equal(node.capabilities().osEncryption, false);
});

test("SecretProvider fails closed for unavailable or malformed backends", async () => {
  const provider = createSecretProvider({ safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(() => provider.seal("test-only-secret", { mode: "os" }), /系统加密存储/);
  await assert.rejects(() => provider.open({ format: "olt-manager/secret-envelope/v1", version: 1, backend: "unknown" }), /后端不受支持/);
  await assert.rejects(() => provider.open({ format: "olt-manager/secret-envelope/v1", version: 1, backend: "safeStorage", ciphertext: "not-base64" }), /系统加密存储/);
});

test("references are opaque and generated without secret material", () => {
  const provider = createSecretProvider({ randomBytesImpl: () => Buffer.alloc(12, 7) });
  assert.equal(provider.randomReference("olt"), "olt-070707070707070707070707");
  assert.equal(provider.randomReference("bad value"), "secret-070707070707070707070707");
});
