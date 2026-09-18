import test from "node:test";
import assert from "node:assert/strict";
import { buildZteC600PonOpticalCommand, parseZteC600PonRxPowerOutput } from "../src/zte-telnet.mjs";

test("C600 PON optical command keeps TITAN interface spelling", () => {
  assert.equal(
    buildZteC600PonOpticalCommand({ chassis: 1, board: 2, pon: 15 }),
    "show pon power olt-rx gpon_olt-1/2/15"
  );
});

test("C600 PON optical output maps ONU coordinates and no-signal rows", () => {
  const output = [
    "Onu                  Rx power",
    "------------------------------------",
    "gpon_onu-1/2/15:1    no signal",
    "gpon_onu-1/2/15:2    -22.373(dbm)",
    "gpon_onu-1/2/15:19   -22.034(dbm)"
  ].join("\n");
  assert.deepEqual([...parseZteC600PonRxPowerOutput(output).entries()], [
    ["1/2/15/1", "no signal"],
    ["1/2/15/2", "-22.37 dBm"],
    ["1/2/15/19", "-22.03 dBm"]
  ]);
});
