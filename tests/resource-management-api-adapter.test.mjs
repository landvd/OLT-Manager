import test from "node:test";
import assert from "node:assert/strict";
import { createResourceManagementApi } from "../src/resource-management-api.mjs";

test("resource management API keeps fixed endpoints and sanitizes config payload", async () => {
  const calls = [];
  const api = createResourceManagementApi({
    request: async (path, options) => {
      calls.push({ path, options });
      return { ok: true };
    }
  });

  await api.config();
  await api.saveConfig({ serverUrl: " https://nmse.example/ ", username: " operator ", password: "secret", migrationMasterPassword: "master" });
  await api.login(" master ");
  await api.logout();
  await api.syncVlans(" olt-1 ");

  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/admin/resource-management/config",
    "/api/admin/resource-management/config",
    "/api/admin/resource-management/login",
    "/api/admin/resource-management/logout",
    "/api/admin/resource-management/sync-vlans"
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    serverUrl: "https://nmse.example",
    username: "operator",
    password: "secret",
    migrationMasterPassword: "master"
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), { migrationMasterPassword: " master " });
  assert.deepEqual(JSON.parse(calls[4].options.body), { oltId: " olt-1 " });
});

test("resource management API requires a request function", () => {
  assert.throws(() => createResourceManagementApi(), /需要注入 request/);
});
