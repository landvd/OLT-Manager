import test from "node:test";
import assert from "node:assert/strict";
import { createOssResourceApi } from "../src/oss-resource-api.mjs";

test("OSS resource API keeps fixed endpoints and excludes unrelated config fields", async () => {
  const calls = [];
  const api = createOssResourceApi({
    request: async (path, options) => {
      calls.push({ path, options });
      return { rows: [] };
    }
  });

  await api.config();
  await api.saveConfig({ authBaseUrl: " https://auth ", ngbBaseUrl: " https://ngb ", username: " operator ", organizationName: " org ", roomName: " room ", password: "secret" });
  await api.login({ password: "secret", migrationMasterPassword: "master", rememberPassword: true, autoLogin: false });
  await api.logout();
  await api.historicalOptical({ oltId: "olt-1", chassis: 1, slot: 2, pon: 3, onuId: 4, startDate: "2026-08-01", endDate: "2026-08-19", extra: "ignored" });

  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/admin/oss-resource/config",
    "/api/admin/oss-resource/config",
    "/api/admin/oss-resource/login",
    "/api/admin/oss-resource/logout",
    "/api/onus/historical-optical"
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    authBaseUrl: "https://auth",
    ngbBaseUrl: "https://ngb",
    username: "operator",
    organizationName: "org",
    roomName: "room"
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), { password: "secret", migrationMasterPassword: "master", rememberPassword: true, autoLogin: false });
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    oltId: "olt-1", chassis: 1, board: 2, pon: 3, onuId: 4, startDate: "2026-08-01", endDate: "2026-08-19"
  });
});

test("OSS resource API requires a request function", () => {
  assert.throws(() => createOssResourceApi(), /需要注入 request/);
});
