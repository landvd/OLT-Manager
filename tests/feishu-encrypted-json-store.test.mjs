import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createEncryptedJsonStore,
  FEISHU_STATE_ENVELOPE_FORMAT
} from "../src/feishu/encrypted-json-store.mjs";

function memoryFile() {
  let value;
  return {
    async readFile() { return value; },
    async writeFileAtomic(_path, next) { value = next; },
    value() { return value; }
  };
}

test("Feishu state store encrypts JSON and authenticates tampering", async () => {
  const file = memoryFile();
  const store = createEncryptedJsonStore({
    key: async () => Buffer.alloc(32, 7),
    readFile: file.readFile,
    writeFileAtomic: file.writeFileAtomic,
    path: "/tmp/feishu-state.enc"
  });
  const value = { format: "olt-manager/feishu-state/v1", enabled: false };
  await store.write(value);
  assert.match(file.value(), new RegExp(FEISHU_STATE_ENVELOPE_FORMAT));
  assert.doesNotMatch(file.value(), /enabled/);
  assert.deepEqual(await store.read(), value);
  const envelope = JSON.parse(file.value());
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
  await file.writeFileAtomic("/tmp/feishu-state.enc", JSON.stringify(envelope));
  await assert.rejects(() => store.read(), /authentication failed/);
});

test("Feishu state store rejects non-32-byte keys", async () => {
  const file = memoryFile();
  const store = createEncryptedJsonStore({
    key: async () => randomBytes(16), readFile: file.readFile,
    writeFileAtomic: file.writeFileAtomic, path: "/tmp/feishu-state.enc"
  });
  await assert.rejects(() => store.write({}), /encryption key unavailable/);
});
