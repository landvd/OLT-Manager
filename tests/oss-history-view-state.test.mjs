import test from "node:test";
import assert from "node:assert/strict";
import { ossHistoricalOpticalRequestFor, ossHistoryRowsFromResponse } from "../src/oss-history-view-state.mjs";

test("OSS historical optical request preserves ONU coordinate and board fallback", () => {
  assert.deepEqual(ossHistoricalOpticalRequestFor({
    detail: { olt: { id: "olt-1" }, onu: { chassis: 1, slot: 2, pon: 3, onuId: 4 } },
    dateRange: ["2026-08-01", "2026-08-19"]
  }), {
    ok: true,
    payload: { oltId: "olt-1", chassis: 1, board: 2, pon: 3, onuId: 4, startDate: "2026-08-01", endDate: "2026-08-19" }
  });
  assert.deepEqual(ossHistoricalOpticalRequestFor({
    detail: { olt: { id: "olt-1" }, onu: { chassis: 1, board: 2, pon: 3, onuId: 4 } },
    dateRange: ["2026-08-01", "2026-08-19"]
  }).payload.board, 2);
});

test("OSS historical optical request fails closed without complete detail or dates", () => {
  assert.deepEqual(ossHistoricalOpticalRequestFor({}), { ok: false, error: "ONU 详情或日期范围不完整" });
  assert.deepEqual(ossHistoricalOpticalRequestFor({ detail: { olt: { id: "olt-1" }, onu: {} }, dateRange: ["2026-08-01"] }), { ok: false, error: "ONU 详情或日期范围不完整" });
  assert.deepEqual(ossHistoryRowsFromResponse({ rows: [{ rxPower: -18 }] }), [{ rxPower: -18 }]);
  assert.deepEqual(ossHistoryRowsFromResponse({ rows: null }), []);
});
