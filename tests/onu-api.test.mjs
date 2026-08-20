import test from "node:test";
import assert from "node:assert/strict";
import { createOnuApi } from "../src/onu-api.mjs";

test("ONU API centralizes fixed read-only query endpoints", async () => {
  const calls = [];
  const api = createOnuApi({
    request: async (path, options) => {
      calls.push({ path, options });
      return { rows: [] };
    }
  });

  await api.status();
  await api.unregistered();
  await api.configTemplates();
  await api.list(new URLSearchParams({ search: "张三", board: "1" }));
  await api.config({ oltId: "olt-1", chassis: "0", board: "1", pon: "2", onuId: "3", serial: "ZTEG-1" });

  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/status",
    "/api/unregistered-onus",
    "/api/config-templates",
    "/api/onus?search=%E5%BC%A0%E4%B8%89&board=1",
    "/api/onu-config?oltId=olt-1&chassis=0&board=1&slot=1&pon=2&onuId=3&serial=ZTEG-1"
  ]);
});

test("ONU config-plan requests keep the manual POST contract and validate request injection", async () => {
  const calls = [];
  const api = createOnuApi({ request: async (...args) => (calls.push(args), { ok: true }) });
  const row = { chassis: "0", slot: "1", pon: "2", serial: "ZTEG-1" };
  const payload = { templateId: "huawei-self", ethPorts: ["eth1"] };

  await api.configPlan(row, payload);
  assert.equal(calls[0][0], "/api/unregistered-onus/0%2F1%2F2-ZTEG-1/config-plan");
  assert.deepEqual(calls[0][1], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.throws(() => createOnuApi({ request: null }), /requires a request function/);
});
