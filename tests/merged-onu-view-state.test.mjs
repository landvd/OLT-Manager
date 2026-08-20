import test from "node:test";
import assert from "node:assert/strict";
import {
  mergedOnuSourceStatusText,
  mergedOnuSyncPercent,
  mergedOnuSyncPhaseText,
  mergedOnuSyncStatusText
} from "../src/merged-onu-view-state.mjs";

test("merged ONU view state keeps phase and status labels stable", () => {
  assert.equal(mergedOnuSyncPhaseText("fetching-network"), "正在读取网管二期全量 ONU");
  assert.equal(mergedOnuSyncPhaseText("unknown"), "等待同步状态");
  assert.equal(mergedOnuSyncStatusText({ status: "success" }), "已完成");
  assert.equal(mergedOnuSyncStatusText({ running: true }), "执行中");
  assert.equal(mergedOnuSyncStatusText({}), "尚未运行");
  assert.equal(mergedOnuSourceStatusText({ synced: false }), "尚未同步");
});

test("merged ONU sync progress keeps bounded phase percentages", () => {
  assert.equal(mergedOnuSyncPercent({ totalOlts: 4, completedOlts: 2, phase: "fetching-network" }), 40);
  assert.equal(mergedOnuSyncPercent({ totalOlts: 4, nmsePages: 10, nmseCompletedPages: 5, phase: "fetching-nmse" }), 90);
  assert.equal(mergedOnuSyncPercent({ totalOlts: 4, phase: "merging" }), 100);
  assert.equal(mergedOnuSyncPercent({ status: "success" }), 100);
  assert.equal(mergedOnuSyncPercent({ totalOlts: 0, phase: "fetching-network" }), 0);
});
