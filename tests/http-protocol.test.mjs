import assert from "node:assert/strict";
import test from "node:test";
import {
  ENCRYPTED_BACKUP_CONTAINER_LIMIT,
  ENCRYPTED_BACKUP_PASSWORD_HEADER,
  ENCRYPTED_BACKUP_REQUEST_LIMIT,
  encryptedBackupError,
  json,
  readBinaryBody,
  readBody,
  readEncryptedBackupContainer,
  readEncryptedBackupPasswordBody,
  requestContentType
} from "../src/http-protocol.mjs";

function request(chunks = [], headers = {}) {
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

test("HTTP protocol helpers preserve JSON, binary, and response contracts", async () => {
  assert.deepEqual(await readBody(request([Buffer.from('{"ok":true}')])) , { ok: true });
  assert.deepEqual(await readBody(request()), {});
  assert.deepEqual(await readBinaryBody(request([Buffer.from("a"), Buffer.from("b")])), Buffer.from("ab"));
  await assert.rejects(readBinaryBody(request([Buffer.from("abcd")]), 3), (error) => error.status === 413 && error.message === "备份文件不能超过 100 MB。");

  assert.equal(requestContentType(request([], { "content-type": "Application/JSON; charset=utf-8" })), "application/json");
  assert.equal(requestContentType(request()), "");

  const response = { headers: null, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  json(response, 201, { ok: true });
  assert.equal(response.status, 201);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body, '{"ok":true}');
});

test("encrypted backup helpers enforce content types, limits, and password boundaries", async () => {
  const password = "synthetic-protocol-password";
  assert.equal(ENCRYPTED_BACKUP_PASSWORD_HEADER, "x-olt-manager-backup-password");
  assert.equal(await readEncryptedBackupPasswordBody(request([Buffer.from(JSON.stringify({ password }))], { "content-type": "application/json; charset=utf-8" })), password);

  await assert.rejects(readEncryptedBackupPasswordBody(request([Buffer.from("{}")], { "content-type": "application/json" })), (error) => error.code === "BACKUP_PASSWORD_REQUIRED" && !error.message.includes(password));
  await assert.rejects(readEncryptedBackupPasswordBody(request([Buffer.from(JSON.stringify({ password, token: "synthetic-token" }))], { "content-type": "application/json" })), (error) => error.code === "BACKUP_PASSWORD_REQUIRED" && !error.message.includes("synthetic-token"));
  await assert.rejects(readEncryptedBackupPasswordBody(request([Buffer.from("not-json")], { "content-type": "application/json" })), (error) => error.code === "ENCRYPTED_BACKUP_INVALID");
  await assert.rejects(readEncryptedBackupPasswordBody(request([{ length: ENCRYPTED_BACKUP_REQUEST_LIMIT + 1 }], { "content-type": "application/json" })), (error) => error.status === 413 && error.code === "ENCRYPTED_BACKUP_TOO_LARGE");
  await assert.rejects(readEncryptedBackupPasswordBody(request([Buffer.from("{}")], { "content-type": "text/plain" })), (error) => error.code === "ENCRYPTED_BACKUP_CONTENT_TYPE");

  const container = Buffer.from("synthetic-container");
  assert.deepEqual(await readEncryptedBackupContainer(request([container], { "content-type": "application/vnd.olt-manager.encrypted-backup; version=1" })), container);
  assert.deepEqual(await readEncryptedBackupContainer(request([container], { "content-type": "application/octet-stream" })), container);
  await assert.rejects(readEncryptedBackupContainer(request([container], { "content-type": "application/json" })), (error) => error.code === "ENCRYPTED_BACKUP_CONTENT_TYPE");
  await assert.rejects(readEncryptedBackupContainer(request([{ length: ENCRYPTED_BACKUP_CONTAINER_LIMIT + 1 }], { "content-type": "application/octet-stream" })), (error) => error.status === 413 && error.code === "ENCRYPTED_BACKUP_TOO_LARGE");

  const invalid = encryptedBackupError("ENCRYPTED_BACKUP_INVALID");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.code, "ENCRYPTED_BACKUP_INVALID");
  assert.doesNotMatch(invalid.message, /password|token|\/|synthetic/i);
});
