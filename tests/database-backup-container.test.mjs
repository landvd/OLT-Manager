import test from "node:test";
import assert from "node:assert/strict";
import {
  createEncryptedBackupContainer,
  decryptEncryptedBackupContainer,
  inspectEncryptedBackupContainer
} from "../src/database-backup-container.mjs";

const MASTER = "test-backup-master-password";
const PAYLOAD = Buffer.from("SQLite snapshot fixture: no real backup data.", "utf8");

test("encrypted backup container round-trips Buffer and Uint8Array with authenticated metadata", () => {
  const container = createEncryptedBackupContainer(new Uint8Array(PAYLOAD), MASTER, { purpose: "sqlite-full" });
  assert.equal(Buffer.isBuffer(container), true);
  assert.deepEqual(decryptEncryptedBackupContainer(container, MASTER), PAYLOAD);
  assert.deepEqual(inspectEncryptedBackupContainer(container), {
    format: "olt-manager/encrypted-backup-container",
    version: 1,
    purpose: "sqlite-full",
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    payloadSize: PAYLOAD.length,
    payloadSha256: "44b551ac2abc5d84082cf1624a15ed2075b16b59a8db512067e5821400f46a6d"
  });
});

test("wrong password, tampering, purpose change, and malformed format fail closed", () => {
  const container = createEncryptedBackupContainer(PAYLOAD, MASTER, { purpose: "sqlite-full" });
  assert.throws(() => decryptEncryptedBackupContainer(container, "wrong-password"), { code: "BACKUP_DECRYPT_FAILED" });

  const tamperedEnvelope = JSON.parse(container.toString("utf8"));
  const tamperedCiphertext = Buffer.from(tamperedEnvelope.ciphertext, "base64");
  tamperedCiphertext[0] ^= 1;
  tamperedEnvelope.ciphertext = tamperedCiphertext.toString("base64");
  const tampered = Buffer.from(JSON.stringify(tamperedEnvelope), "utf8");
  assert.throws(() => decryptEncryptedBackupContainer(tampered, MASTER), { code: "BACKUP_DECRYPT_FAILED" });

  const changedPurpose = JSON.parse(container.toString("utf8"));
  changedPurpose.purpose = "other-purpose";
  assert.throws(() => decryptEncryptedBackupContainer(Buffer.from(JSON.stringify(changedPurpose)), MASTER), { code: "BACKUP_DECRYPT_FAILED" });
  assert.throws(() => inspectEncryptedBackupContainer(Buffer.from("not a container")), { code: "BACKUP_FORMAT_INVALID" });
  assert.throws(() => createEncryptedBackupContainer(PAYLOAD, "short"), { code: "BACKUP_PASSWORD_INVALID" });
});

test("returned values contain no password or plaintext backup content", () => {
  const container = createEncryptedBackupContainer(PAYLOAD, MASTER);
  assert.doesNotMatch(container.toString("utf8"), /test-backup-master-password|SQLite snapshot fixture/);
  assert.doesNotMatch(JSON.stringify(inspectEncryptedBackupContainer(container)), /test-backup-master-password|SQLite snapshot fixture/);
});
