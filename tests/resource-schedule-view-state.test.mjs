import test from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCE_SYNC_OPERATIONS,
  resourceScheduleLastResult,
  resourceScheduleOperationText,
  resourceSchedulePayload,
  resourceScheduleRepeatText,
  resourceScheduleStatusText,
  resourceScheduleStatusType
} from "../src/resource-schedule-view-state.mjs";

test("resource schedule view state preserves status and result labels", () => {
  assert.equal(resourceScheduleStatusText("pending"), "待执行");
  assert.equal(resourceScheduleStatusText("custom"), "custom");
  assert.equal(resourceScheduleStatusType("failed"), "danger");
  assert.equal(resourceScheduleStatusType("custom"), "info");
  assert.equal(resourceScheduleRepeatText({ repeatDays: 5 }), "每 5 天");
  assert.equal(resourceScheduleRepeatText({ repeatDays: 0 }), "仅一次");
  assert.equal(resourceScheduleLastResult({ status: "success" }), "已完成");
  assert.equal(resourceScheduleLastResult({ status: "failed", error: "连接失败" }), "失败：连接失败");
  assert.equal(resourceScheduleLastResult({ status: "canceled" }), "已取消");
  assert.equal(resourceScheduleOperationText("network"), "网管二期同步");
  assert.equal(resourceScheduleOperationText("nmse"), "NMSE-PON同步");
  assert.equal(resourceScheduleOperationText("merge"), "手动合并");
  assert.equal(resourceScheduleOperationText("full"), "全量同步");
  assert.equal(RESOURCE_SYNC_OPERATIONS.length, 4);
});

test("resource schedule payload disables repeat days for one-time tasks", () => {
  assert.deepEqual(resourceSchedulePayload({ operation: "nmse", runAt: "2026-08-20T05:00", repeatEnabled: true, repeatDays: 5 }), {
    operation: "nmse",
    runAt: "2026-08-20T05:00",
    repeatDays: 5
  });
  assert.deepEqual(resourceSchedulePayload({ operation: "full", runAt: "2026-08-20T05:00", repeatEnabled: false, repeatDays: 5 }), {
    operation: "full",
    runAt: "2026-08-20T05:00",
    repeatDays: 0
  });
});
