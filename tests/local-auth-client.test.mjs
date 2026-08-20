import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthClient } from "../src/local-auth-client.mjs";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key)
  };
}

function createFetchSpy() {
  const calls = [];
  const fetchImpl = async (input, options) => {
    calls.push({ input, options });
    return new Response("{}", { status: 200 });
  };
  return { calls, fetchImpl };
}

test("persists the token in session storage and restores it for a new client", () => {
  const storage = createStorage();
  const first = createLocalAuthClient({ fetchImpl: async () => new Response(), storage });

  first.setToken("session-token");

  const second = createLocalAuthClient({ fetchImpl: async () => new Response(), storage });
  assert.equal(second.getToken(), "session-token");
  assert.equal(storage.getItem("olt-manager-auth-token"), "session-token");
});

test("clears the token from memory and session storage on logout cleanup", () => {
  const storage = createStorage({ "olt-manager-auth-token": "session-token" });
  const client = createLocalAuthClient({ fetchImpl: async () => new Response(), storage });

  client.clearToken();

  assert.equal(client.getToken(), "");
  assert.equal(storage.has("olt-manager-auth-token"), false);
});

test("does not inject Bearer into auth endpoints", async () => {
  const storage = createStorage();
  const { calls, fetchImpl } = createFetchSpy();
  const client = createLocalAuthClient({ fetchImpl, storage });
  client.setToken("session-token");

  await client.fetch("/api/auth/session");
  await client.fetch("/api/auth/login", { method: "POST" });

  assert.equal(calls[0].options.headers.has("authorization"), false);
  assert.equal(calls[1].options.headers.has("authorization"), false);
});

test("preserves an explicit Bearer header for session restoration", async () => {
  const { calls, fetchImpl } = createFetchSpy();
  const client = createLocalAuthClient({ fetchImpl, storage: createStorage() });

  await client.fetch("/api/auth/session", { headers: { authorization: "Bearer session-token" } });

  assert.equal(calls[0].options.headers.get("authorization"), "Bearer session-token");
});

test("injects Bearer into ordinary API requests", async () => {
  const { calls, fetchImpl } = createFetchSpy();
  const client = createLocalAuthClient({ fetchImpl, storage: createStorage() });
  client.setToken("session-token");

  await client.fetch("/api/bootstrap");

  assert.equal(calls[0].options.headers.get("authorization"), "Bearer session-token");
});

test("does not inject Bearer into non-API requests", async () => {
  const { calls, fetchImpl } = createFetchSpy();
  const client = createLocalAuthClient({ fetchImpl, storage: createStorage() });
  client.setToken("session-token");

  await client.fetch("/index.html");

  assert.equal(calls[0].options.headers.has("authorization"), false);
});
