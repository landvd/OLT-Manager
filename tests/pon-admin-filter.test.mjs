import test from "node:test";
import assert from "node:assert/strict";
import { createPonPortFilterState } from "../src/pon-admin-filter.mjs";

test("PON admin rows stay visible while editing fields used by current OLT filter", () => {
  const rows = [
    { oltIp: "172.19.104.98", ponPort: "1/2/1", chassis: "1", board: "2", pon: "1", outerVlan: "1061", address: "卓越" },
    { oltIp: "172.19.104.107", ponPort: "1/2/15", chassis: "1", board: "2", pon: "15", outerVlan: "1052", address: "沙田" }
  ];
  const filterState = createPonPortFilterState();
  filterState.reset(rows);

  rows[0].oltIp = "1";
  rows[0].outerVlan = "2";

  const filtered = filterState.rows({ ponPorts: rows, keyword: "", selectedHost: "172.19.104.98" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].port.address, "卓越");
});

test("PON admin search matches both original and edited row values", () => {
  const rows = [
    { oltIp: "172.19.104.98", ponPort: "1/2/1", chassis: "1", board: "2", pon: "1", outerVlan: "1061", address: "卓越" }
  ];
  const filterState = createPonPortFilterState();
  filterState.reset(rows);

  rows[0].outerVlan = "2001";
  rows[0].address = "新地址";

  assert.equal(filterState.rows({ ponPorts: rows, keyword: "1061", selectedHost: "" }).length, 1);
  assert.equal(filterState.rows({ ponPorts: rows, keyword: "新地址", selectedHost: "" }).length, 1);
});
