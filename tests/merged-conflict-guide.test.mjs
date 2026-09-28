import test from "node:test";
import assert from "node:assert/strict";
import {
  getConflictGuide,
  summarizeConflicts,
  filterConflictRows,
  CONFLICT_REASON_GUIDE
} from "../src/merged-conflict-guide.mjs";

test("getConflictGuide returns detailed guide with cause, tolerance, suggestion, and actionMethods", () => {
  const guide = getConflictGuide("network_coordinate_duplicate");
  assert.equal(guide.label, "二期物理坐标重复");
  assert.equal(guide.tagType, "danger");
  assert.ok(guide.cause.includes("网管二期"));
  assert.ok(guide.tolerance.includes("自动择优保留"));
  assert.ok(guide.suggestion.includes("清理注销已拆机"));
  assert.ok(Array.isArray(guide.actionMethods));
  assert.ok(guide.actionMethods.length >= 3);

  // Unknown fallback
  const fallback = getConflictGuide("some_unknown_reason");
  assert.equal(fallback.label, "其他属性差异");
});

test("summarizeConflicts calculates category counts and sorts descending", () => {
  const rows = [
    { reason: "network_coordinate_duplicate" },
    { reason: "network_coordinate_duplicate" },
    { reason: "network_coordinate_unparseable" },
    { reason: "nmse_loid_duplicate" }
  ];
  const summary = summarizeConflicts(rows);
  assert.equal(summary.total, 4);
  assert.equal(summary.counts.network_coordinate_duplicate, 2);
  assert.equal(summary.categories[0].key, "network_coordinate_duplicate");
  assert.equal(summary.categories[0].count, 2);
});

test("filterConflictRows filters by reason, oltIp, and keyword", () => {
  const rows = [
    { reason: "network_coordinate_duplicate", oltIp: "172.19.104.98", loid: "DG1001", onuIndexDisplay: "1/1/1:1", detail: "重复1" },
    { reason: "network_coordinate_unparseable", oltIp: "172.19.104.99", loid: "DG1002", onuIndexDisplay: "1/1/1:2", detail: "非标" },
    { reason: "nmse_loid_duplicate", oltIp: "172.19.104.98", loid: "DG1003", onuIndexDisplay: "1/1/1:3", detail: "重复2" }
  ];

  assert.equal(filterConflictRows(rows, { reason: "network_coordinate_duplicate" }).length, 1);
  assert.equal(filterConflictRows(rows, { oltIp: "172.19.104.98" }).length, 2);
  assert.equal(filterConflictRows(rows, { keyword: "dg1002" }).length, 1);
  assert.equal(filterConflictRows(rows, { keyword: "非标" }).length, 1);
  assert.equal(filterConflictRows(rows, { reason: "all" }).length, 3);
});
