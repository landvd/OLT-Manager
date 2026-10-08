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

test("rxHistoryChart lays out axis ticks, threshold bands and time labels", async () => {
  const { rxHistoryChart } = await import("../src/onu-detail-view-state.mjs");
  assert.equal(rxHistoryChart({ history: { rxPower: [{ rxPower: -20 }] } }), null);
  const chart = rxHistoryChart({ history: { rxPower: [
    { sampledAt: "2026-10-07 01:00:00", rxPower: -22.5 },
    { sampledAt: "2026-10-07 02:00:00", rxPower: -25.1 },
    { sampledAt: "2026-10-08 03:30:00", rxPower: -28.2 }
  ] } });
  assert.equal(chart.points.length, 3);
  assert.deepEqual(chart.bands.map((band) => band.tone), ["good", "warn", "bad"]);
  assert.ok(chart.bands.every((band) => band.height > 0), "-30~-15 范围内三个阈值区都应可见");
  assert.deepEqual(chart.yTicks.map((tick) => tick.label), ["-15", "-18", "-21", "-24", "-27", "-30"]);
  assert.deepEqual(chart.xLabels.map((label) => label.label), ["10-07 01:00", "10-07 02:00", "10-08 03:30"]);
  assert.equal(chart.stats.tone, "bad");
  assert.equal(chart.stats.delta, 5.7);
  // 越弱的光功率在图上越靠下
  assert.ok(chart.points[2].y > chart.points[0].y);
});
