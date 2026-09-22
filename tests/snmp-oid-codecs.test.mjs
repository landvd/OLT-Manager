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
  decodeSnmpDisplayString,
  decodeZteC600RxPower,
  decodeHuaweiRxPower,
  decodeSnmpDateAndTime,
  decodeZteRxPower,
  encodeZtePonIndex,
  encodeZteVportIndex,
  filterHuaweiUnregisteredSerialRows,
  indexRows,
  parseHuaweiIfNameRows,
  parseHuaweiOntIndex,
  parseHuaweiOuterVlanRows,
  decodeZteC600Port,
  encodeZteC600PonIndex,
  parseZteC600Index,
  parseZteIndex,
  parseZteOuterVlanRows,
  parseZteUnconfiguredIndex,
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

  // ZTE C600 index encoding: 0x1101SSPP
  const c600PonIndex = encodeZteC600PonIndex(1, 2, 1);
  assert.equal(c600PonIndex, 285278466); // 0x11010102
  assert.deepEqual(decodeZteC600Port(c600PonIndex), {
    chassis: 1,
    board: 1,
    slot: 1,
    pon: 2
  });
  assert.deepEqual(parseZteC600Index(`1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.3.${c600PonIndex}.5`, "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.3"), {
    chassis: 1,
    board: 1,
    slot: 1,
    pon: 2,
    onuId: 5,
    encoded: c600PonIndex,
    key: `${c600PonIndex}.5`
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
  assert.equal(decodeSnmpDisplayString("Hex-STRING: 5A 58 48 4E 20 46 36 32 30 47"), "ZXHN F620G");
  assert.equal(decodeSnmpDisplayString("Hex-STRING: 10 24 30"), "");
  assert.equal(decodeZteRxPower("INTEGER: 10000"), "-10.00 dBm");
  assert.equal(decodeZteRxPower("INTEGER: 65535"), "N/A");
  assert.equal(decodeZteC600RxPower("43163"), "-22.37 dBm");
  assert.equal(decodeZteC600RxPower("32989"), "-32.55 dBm");
  assert.equal(decodeZteC600RxPower("16697216"), "no signal");
  assert.equal(decodeZteC600RxPower("41425"), "-24.11 dBm");
  assert.equal(decodeHuaweiRxPower("INTEGER: 1234"), "12.34 dBm");
  assert.equal(decodeHuaweiRxPower("INTEGER: 64177"), "-13.59 dBm");
  assert.equal(decodeHuaweiRxPower("INTEGER: 63883"), "-16.53 dBm");
  assert.equal(decodeHuaweiRxPower("INTEGER: 65535"), "N/A");
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

test("C600 unconfigured ONU indexes preserve the port and table row key", () => {
  const base = "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.2";
  assert.deepEqual(parseZteUnconfiguredIndex(`${base}.285280258.1`, base), {
    chassis: 1,
    board: 8,
    slot: 8,
    pon: 2,
    entryIndex: 1,
    encoded: 285280258,
    key: "285280258.1"
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

test("Huawei interface rows normalize Win7 signed ifIndex output", () => {
  const base = "1.3.6.1.2.1.31.1.1.1.1";
  const interfaces = parseHuaweiIfNameRows([{
    oid: `${base}.-100653312`,
    value: 'STRING: "GPON 0/2/3"'
  }]);
  assert.equal(interfaces.get("0/2/3").ifIndex, 4194313984);
});

test("Huawei unregistered candidates require unconfirmed status and exclude registered serials", () => {
  const serialBaseOid = "1.3.6.1.4.1.2011.52.1.2";
  const statusBaseOid = "1.3.6.1.4.1.2011.52.1.3";
  const serialRows = [
    { oid: `${serialBaseOid}.42.1`, value: "Hex-STRING: 5A 4E 58 54 83 5B 9E 08" },
    { oid: `${serialBaseOid}.42.2`, value: "Hex-STRING: 5A 4E 58 54 83 5B 9E F8" },
    { oid: `${serialBaseOid}.42.3`, value: "Hex-STRING: 5A 4E 58 54 83 5B 9A A0" },
    { oid: `${serialBaseOid}.42.4`, value: "Hex-STRING: 5A 4E 58 54 83 5C 87 A0" }
  ];
  const statusRows = [
    { oid: `${statusBaseOid}.42.1`, value: "INTEGER: 9" },
    { oid: `${statusBaseOid}.42.2`, value: "INTEGER: 9" },
    { oid: `${statusBaseOid}.42.3`, value: "INTEGER: 9" },
    { oid: `${statusBaseOid}.42.4`, value: "INTEGER: 1" }
  ];
  const registeredSerialRows = [serialRows[2]];

  assert.deepEqual(
    filterHuaweiUnregisteredSerialRows({
      serialRows,
      statusRows,
      registeredSerialRows,
      serialBaseOid,
      statusBaseOid
    }).map((row) => row.oid),
    [`${serialBaseOid}.42.1`, `${serialBaseOid}.42.2`]
  );
});
