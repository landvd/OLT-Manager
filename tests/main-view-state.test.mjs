import test from "node:test";
import assert from "node:assert/strict";
import {
  countDuplicateAddresses,
  countOnuGroups,
  excelRowsToPonRows,
  filterStorageKey,
  phaseInfo,
  ponRowsForExport,
  rxPowerInfo,
  uniqueSorted
} from "../src/main-view-state.mjs";

test("main view state keeps phase, power and aggregate display semantics", () => {
  assert.deepEqual(phaseInfo("LOS"), { text: "LOS", group: "los", type: "danger" });
  assert.equal(phaseInfo("unknown").type, "info");
  assert.deepEqual(rxPowerInfo("-20.5"), { text: "-20.5", className: "good" });
  assert.deepEqual(rxPowerInfo("-26"), { text: "-26", className: "warn" });
  assert.deepEqual(rxPowerInfo("-30"), { text: "-30", className: "bad" });
  assert.deepEqual(countOnuGroups([
    { phase: "working" }, { phase: "LOS" }, { phase: "dyinggasp" }, { phase: "offline" }, { phase: "other" }
  ]), { total: 5, online: 1, offline: 1, los: 1, power: 1, auth: 0, logging: 0, sync: 0 });
  assert.equal(countDuplicateAddresses([{ address: "A" }, { address: "A" }, { address: "B" }, { address: "" }]), 1);
});

test("main view state keeps filter keys, sorting, and Excel PON mapping", () => {
  assert.equal(filterStorageKey("olt-1"), "olt-manager-filters:olt-1");
  assert.deepEqual(uniqueSorted(["10", "2", "", "2"], true), ["2", "10"]);
  assert.deepEqual(uniqueSorted(["乙", "甲", "甲"]), ["甲", "乙"]);
  const rows = excelRowsToPonRows([{
    "OLT IP": "192.0.2.1", 槽: "1", 板卡: "2", PON: "3", "外层 VLAN": "100", 地址: "村一"
  }]);
  assert.deepEqual(rows[0], {
    oltIp: "192.0.2.1", chassis: "1", board: "2", slot: "2", pon: "3", ponPort: "1/2/3", outerVlan: "100", address: "村一"
  });
  assert.deepEqual(ponRowsForExport(rows), [{ "OLT IP": "192.0.2.1", "槽": "1", "板卡": "2", "PON": "3", "板槽端口": "1/2/3", "外层 VLAN": "100", "地址": "村一" }]);
});
