import test from "node:test";
import assert from "node:assert/strict";
import { createOnuQueryService, HUAWEI_PON_RX_POWER_TIMEOUT_MS } from "../src/server/onu-query-service.mjs";

const IF_INDEX = 4194313216;
const OID = {
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ontDescription: "1.3.6.1.4.1.2011.6.128.1.1.2.45.1.4",
  ontSerialNumber: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30",
  runStatus: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15",
  rxPower: "1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4",
  distance: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.20"
};

function rows(baseOid, values) {
  return values.map((value, onuId) => ({ oid: `.${baseOid}.${IF_INDEX}.${onuId}`, value }));
}

test("华为单 PON 口光功率表读取超时不低于 30 秒，且整口 ONU 都能读到光功率", async () => {
  const walks = [];
  const snmpWalk = async (_olt, oid, _option, timeout) => {
    walks.push({ oid, timeout });
    if (oid === OID.ifName) return { ok: true, rows: [{ oid: `.${OID.ifName}.${IF_INDEX}`, value: "STRING: GPON 0/1/4" }] };
    const base = oid.replace(`.${IF_INDEX}`, "");
    const count = 6;
    const values = {
      [OID.ontDescription]: Array.from({ length: count }, (_, i) => `STRING: user-${i}`),
      [OID.ontSerialNumber]: Array.from({ length: count }, () => "Hex-STRING: 48 57 54 43 00 00 00 01"),
      [OID.runStatus]: Array.from({ length: count }, () => "INTEGER: 1"),
      [OID.rxPower]: ["INTEGER: -1818", "INTEGER: -1869", "INTEGER: -1954", "INTEGER: -1991", "INTEGER: 2147483647", "INTEGER: -1790"],
      [OID.distance]: Array.from({ length: count }, () => "INTEGER: 1200")
    }[base];
    return { ok: true, rows: values ? rows(base, values) : [] };
  };
  const service = createOnuQueryService({
    getPonPorts: async () => [],
    getOnuDataEnrichment: () => ({
      attachResourceUserFields: async (items) => items,
      attachProjectAssignments: async (items) => items
    }),
    snmpWalk
  });

  const result = await service.listOnus(
    { id: "huawei-1", vendor: "huawei", model: "MA5800", host: "192.0.2.10", readCommunity: "test" },
    { chassis: "0", board: "1", pon: "4" }
  );

  assert.ok(HUAWEI_PON_RX_POWER_TIMEOUT_MS >= 30000);
  const rxWalk = walks.find((walk) => walk.oid === `${OID.rxPower}.${IF_INDEX}`);
  assert.equal(rxWalk.timeout, HUAWEI_PON_RX_POWER_TIMEOUT_MS);
  assert.deepEqual(result.map((row) => row.rxPower), [
    "-18.18 dBm", "-18.69 dBm", "-19.54 dBm", "-19.91 dBm", "N/A", "-17.90 dBm"
  ]);
});
