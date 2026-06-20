import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeZtePonIfIndex,
  parseZteUnconfiguredIndex
} from "../src/snmp-parsers.mjs";

const zteUnconfiguredSerialOid = "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.2";

test("ZTE unconfigured ONU index decodes real slot and PON from field samples", () => {
  const samples = [
    { encoded: 0x1101020a, entryIndex: 1, slot: 2, pon: 10 },
    { encoded: 0x11010302, entryIndex: 1, slot: 3, pon: 2 },
    { encoded: 0x11010410, entryIndex: 1, slot: 4, pon: 16 },
    { encoded: 0x11010705, entryIndex: 1, slot: 7, pon: 5 },
    { encoded: 0x1101090d, entryIndex: 1, slot: 9, pon: 13 },
    { encoded: 0x11010910, entryIndex: 3, slot: 9, pon: 16 },
    { encoded: 0x11010910, entryIndex: 4, slot: 9, pon: 16 }
  ];

  for (const sample of samples) {
    const parsed = parseZteUnconfiguredIndex(
      `${zteUnconfiguredSerialOid}.${sample.encoded}.${sample.entryIndex}`,
      zteUnconfiguredSerialOid
    );
    assert.deepEqual(parsed, sample);
  }
});

test("ZTE PON ifIndex encoder matches service-port table indexes", () => {
  assert.equal(encodeZtePonIfIndex(9, 16), 0x11010910);
  assert.equal(encodeZtePonIfIndex("7", "5"), 0x11010705);
});
