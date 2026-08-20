import test from "node:test";
import assert from "node:assert/strict";
import {
  HUAWEI_SRV_FLOW_FRAME_OID,
  HUAWEI_SRV_FLOW_PARAM_TYPE_OID,
  HUAWEI_SRV_FLOW_PON_OID,
  HUAWEI_SRV_FLOW_SLOT_OID,
  HUAWEI_SRV_FLOW_VLAN_ID_OID,
  ZTE_VLAN_IF_CONF_VLAN_OID,
  collectHuaweiOntIndexes,
  decodeHexSerial,
  decodeHuaweiRxPower,
  decodeSnmpDateAndTime,
  decodeZteRxPower,
  encodeZtePonIndex,
  encodeZteVportIndex,
  indexRows,
  parseHuaweiIfNameRows,
  parseHuaweiOntIndex,
  parseHuaweiOuterVlanRows,
  parseZteIndex,
  parseZteOuterVlanRows,
  requestCoordinate
} from "../src/snmp-oid-codecs.mjs";

test("ZTE index codecs preserve PON, ONU and vport encodings", () => {
  const ponIndex = encodeZtePonIndex(2, 3);
  assert.equal(ponIndex, 0x10020300);
  assert.equal(encodeZteVportIndex(7, 2), 0x18070200);
  assert.deepEqual(parseZteIndex(`1.3.6.1.4.1.1.${ponIndex}.7`, "1.3.6.1.4.1.1"), {
    chassis: 1,
    board: 2,
    slot: 2,
    pon: 3,
    onuId: 7,
    encoded: ponIndex,
    key: `${ponIndex}.7`
  });
});

test("Huawei index collection deduplicates rows and ignores missing objects", () => {
  const base = "1.3.6.1.4.1.2";
  const indexes = collectHuaweiOntIndexes([{
    baseOid: base,
    rows: [
      { oid: `${base}.42.3`, value: "x" },
      { oid: `${base}.42.1`, value: "x" },
      { oid: `${base}.43.2`, value: "No Such Instance currently" }
    ]
  }]);
  assert.deepEqual(indexes, [
    { ifIndex: 42, onuId: 1, key: "42.1" },
    { ifIndex: 42, onuId: 3, key: "42.3" }
  ]);
  assert.deepEqual(parseHuaweiOntIndex(`${base}.42.3`, base), { ifIndex: 42, onuId: 3, key: "42.3" });
});

test("ZTE and Huawei VLAN row codecs keep their existing selection rules", () => {
  const zteRows = [
    { oid: `${ZTE_VLAN_IF_CONF_VLAN_OID}.9.1`, value: 'STRING: "1052,3124,86"' },
    { oid: `${ZTE_VLAN_IF_CONF_VLAN_OID}.9.2`, value: 'STRING: "1052,3124"' }
  ];
  assert.equal(parseZteOuterVlanRows(zteRows).get("9"), "1052");

  const index = "100";
  const rows = (baseOid, value) => [{ oid: `${baseOid}.${index}`, value: `INTEGER: ${value}` }];
  assert.deepEqual(parseHuaweiOuterVlanRows({
    frameRows: rows(HUAWEI_SRV_FLOW_FRAME_OID, "0"),
    slotRows: rows(HUAWEI_SRV_FLOW_SLOT_OID, "2"),
    ponRows: rows(HUAWEI_SRV_FLOW_PON_OID, "3"),
    typeRows: rows(HUAWEI_SRV_FLOW_PARAM_TYPE_OID, "4"),
    vlanRows: rows(HUAWEI_SRV_FLOW_VLAN_ID_OID, "1068")
  }), new Map([["0/2/3", "1068"]]));
});

test("SNMP value codecs preserve serial, power, date and coordinate semantics", () => {
  assert.equal(decodeHexSerial("Hex-STRING: 5A 54 45 47 03 0C 09 14"), "ZTEG030C0914");
  assert.equal(decodeHexSerial("Hex-STRING: 00 00 00 00"), "N/A");
  assert.equal(decodeZteRxPower("INTEGER: 10000"), "-10.00 dBm");
  assert.equal(decodeZteRxPower("INTEGER: 65535"), "N/A");
  assert.equal(decodeHuaweiRxPower("INTEGER: 1234"), "12.34 dBm");
  assert.equal(decodeHuaweiRxPower("INTEGER: 2147483647"), "N/A");

  const date = decodeSnmpDateAndTime("Hex-STRING: 07 E8 01 02 03 04 05 00 2B 08 00");
  assert.equal(date.label, "2024-01-02 03:04:05");
  assert.equal(date.ts, Date.UTC(2024, 0, 2, 3, 4, 5) - 8 * 60 * 60 * 1000);
  assert.deepEqual(requestCoordinate({ ponPort: "2/3" }, { vendor: "huawei" }), {
    chassis: "0",
    board: "2",
    slot: "2",
    pon: "3",
    ponPort: "0/2/3"
  });
});

test("Huawei interface rows and generic index rows remain composable", () => {
  const base = "1.3.6.1.2.1.31.1.1.1.1";
  const interfaces = parseHuaweiIfNameRows([{ oid: `${base}.42`, value: 'STRING: "GPON 0/2/3"' }]);
  assert.deepEqual(interfaces.get("0/2/3"), {
    ifIndex: 42,
    chassis: 0,
    board: 2,
    slot: 2,
    pon: 3,
    name: "GPON 0/2/3"
  });
  const rows = indexRows(
    [{ oid: `${base}.42.7`, value: 'STRING: "ONT-7"' }],
    base,
    parseHuaweiOntIndex
  );
  assert.equal(rows.get("42.7").value, "ONT-7");
});
