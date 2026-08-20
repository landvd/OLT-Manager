import test from "node:test";
import assert from "node:assert/strict";
import { createOnuDataEnrichment, normalizeResourceOnuIndex } from "../src/onu-data-enrichment.mjs";

function createHarness(overrides = {}) {
  const calls = [];
  const service = createOnuDataEnrichment({
    getMergedOnuSnapshots: async (query) => { calls.push(["snapshots", query]); return [{ onuIndex: "1:2:3:4", loid: "LOID-1", deviceNumber: "ONU-1", syncedAt: "now" }]; },
    getProjectOnuAssignments: async () => [{ oltId: "olt-1", chassis: 1, board: 2, pon: 3, onuId: 4, projectId: "project-1", projectName: "专线", projectVlan: 100 }],
    getProjectOnus: async () => [{ oltId: "olt-1", chassis: 1, board: 2, pon: 3, onuId: 4, serial: "ZTEG-1", vlan: 100 }],
    listOnus: async (olt, query) => { calls.push(["onus", olt.id, query]); return [{ oltId: olt.id, chassis: 1, board: 2, pon: 3, onuId: 4, serial: "ZTEG-2", phase: "online", rxPower: "-18" }]; },
    ...overrides
  });
  return { service, calls };
}

test("ONU enrichment joins resource users and project assignments without changing source rows", async () => {
  const { service, calls } = createHarness();
  const source = [{ oltId: "olt-1", chassis: 1, board: 2, pon: 3, onuId: 4, phase: "online" }];
  const resource = await service.attachResourceUserFields(source, { host: "192.0.2.1" });
  assert.equal(source[0].deviceNumber, undefined);
  assert.equal(resource[0].deviceNumber, "ONU-1");
  assert.deepEqual(calls[0], ["snapshots", { oltIp: "192.0.2.1" }]);

  const assigned = await service.attachProjectAssignments(resource, "olt-1");
  assert.deepEqual(assigned[0].project, { id: "project-1", name: "专线", vlan: 100 });
  assert.equal(assigned[0].projectName, "专线");
});

test("project ONU enrichment keeps snapshots when OLT or live read is unavailable", async () => {
  const missingOlt = await createHarness().service.listProjectOnus("project-1", []).then((rows) => rows[0]);
  assert.match(missingOlt.refreshError, /未找到关联的 OLT/);

  const failed = await createHarness({ listOnus: async () => { throw new Error("SNMP unavailable"); } }).service.listProjectOnus("project-1", [{ id: "olt-1", name: "OLT 1", host: "192.0.2.1" }]);
  assert.match(failed[0].refreshError, /SNMP unavailable/);
  assert.equal(failed[0].serial, "ZTEG-1");
});

test("resource ONU index normalization remains strict and canonical", () => {
  assert.equal(normalizeResourceOnuIndex("1:2:3:4"), "1/2/3/4");
  assert.equal(normalizeResourceOnuIndex("1/2/3"), "");
  assert.equal(normalizeResourceOnuIndex("1/2/x/4"), "");
});
