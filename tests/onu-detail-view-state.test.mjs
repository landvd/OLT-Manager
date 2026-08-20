import test from "node:test";
import assert from "node:assert/strict";
import { opticalValue, onuMgmtCli, rxHistoryPoints, servicePortCli } from "../src/onu-detail-view-state.mjs";

test("ONU detail view state formats optical values and keeps invalid values safe", () => {
  assert.equal(opticalValue(-19.456), "-19.46 dBm");
  assert.equal(opticalValue(""), "-");
  assert.equal(opticalValue("not-a-number"), "-");
});

test("ONU detail view state creates bounded RX history polyline points", () => {
  assert.equal(rxHistoryPoints({ history: { rxPower: [] } }), "");
  assert.equal(rxHistoryPoints({ history: { rxPower: [{ rxPower: -20 }, { rxPower: -18 }] } }), "20.0,160.0 580.0,20.0");
  assert.equal(rxHistoryPoints({ history: { rxPower: [{ rxPower: "bad" }, { rxPower: -18 }] } }), "");
});

test("ONU detail view state renders only the existing read-only CLI preview", () => {
  const detail = {
    onu: { chassis: "1", board: "2", pon: "3", onuId: "4" },
    servicePorts: [{ servicePort: "10", vport: "1", userVlan: "100", cVlan: "200", sVlan: "300" }],
    cliConfig: { onuRunningConfig: "show onu" }
  };
  assert.match(servicePortCli(detail), /interface gpon-onu_1\/2\/3:4/);
  assert.match(servicePortCli(detail), /svlan 300/);
  assert.equal(onuMgmtCli(detail), "show onu");
  assert.equal(servicePortCli({ cliConfig: { runningConfig: "existing" } }), "existing");
});
