import test from "node:test";
import assert from "node:assert/strict";
import { parseZteOuterVlanRows } from "../src/server.mjs";

const base = "1.3.6.1.4.1.3902.1082.40.50.2.1.4.1.7";

test("ZTE outer VLAN parser reads comma lists and ignores a single custom VLAN outlier", () => {
  const rows = [
    row("285278735.268632320", "5,8,90,1028,1052,3101,3124,3701"),
    row("285278735.268697856", "5,8,41,86,90,1028,1052,3101,3124,3701"),
    row("285278735.268763392", "86,1052,3124"),
    row("285278735.268828928", "3056"),
    row("285278735.268894464", "86,1052,3124"),
    row("285278735.268960000", "100"),
    row("285278735.269025536", "852"),
    row("285278735.269091072", "106")
  ];

  assert.equal(parseZteOuterVlanRows(rows).get("285278735"), "1052");
});

test("ZTE outer VLAN parser keeps the common 1000-range VLAN for simple rows", () => {
  const rows = [
    row("285278733.268501248", "1051"),
    row("285278733.268501504", "3115"),
    row("285278733.268501760", "90"),
    row("285278733.268502016", "86"),
    row("285278733.268566784", "1051"),
    row("285278733.268567040", "3115")
  ];

  assert.equal(parseZteOuterVlanRows(rows).get("285278733"), "1051");
});

function row(suffix, value) {
  return {
    oid: `${base}.${suffix}`,
    value: `STRING: "${value}"`
  };
}
