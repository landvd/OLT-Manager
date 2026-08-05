import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-internal-data-service-"));
const { startServer } = await import("../src/server.mjs");

async function request(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.json() };
}

test("the read-only data service remains available only in-process", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  assert.equal(typeof started.gateway.queryUsers, "function");
  assert.equal(typeof started.gateway.readOnuDetail, "function");

  const removedRoute = await request(started.url, "/api/gateway/v1/status");
  assert.equal(removedRoute.response.status, 404);
  assert.match(removedRoute.body.error, /API not found/);
});
