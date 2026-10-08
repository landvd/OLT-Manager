import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMergedCoordinate, mergeOnuDatasets } from "../src/merged-onu-sync.mjs";

test("normalizeMergedCoordinate 自适应兼容中兴复合坐标与 explicit 字段优先机制", () => {
  // 1. 中兴常见 1/1-1-9/3:3
  const zte1 = normalizeMergedCoordinate("1/1-1-9/3:3");
  assert.deepEqual(zte1, {
    chassis: "1",
    board: "9",
    pon: "3",
    onuId: "3",
    key: "1/9/3:3",
    display: "1/1-1-9/3:3"
  });

  // 2. 中兴 1/1-1-3/6:28
  const zte2 = normalizeMergedCoordinate("1/1-1-3/6:28");
  assert.deepEqual(zte2, {
    chassis: "1",
    board: "3",
    pon: "6",
    onuId: "28",
    key: "1/3/6:28",
    display: "1/1-1-3/6:28"
  });

  // 3. 显式字段优先机制（如表已有独立 chassis/board/pon/onu_id 列）
  const explicit = normalizeMergedCoordinate("1/1-1-5/4:DG214222L44", {
    chassis: "1",
    board: "5",
    pon: "4",
    onu_id: "11"
  });
  assert.deepEqual(explicit, {
    chassis: "1",
    board: "5",
    pon: "4",
    onuId: "11",
    key: "1/5/4:11",
    display: "1/1-1-5/4:DG214222L44"
  });

  // 4. 冒号后为 LOID 的单字符串容错
  const loidSuffix = normalizeMergedCoordinate("1/1-1-5/4:DG214222L44");
  assert.equal(loidSuffix.chassis, "1");
  assert.equal(loidSuffix.board, "5");
  assert.equal(loidSuffix.pon, "4");
  assert.equal(loidSuffix.onuId, "0");
});

test("mergeOnuDatasets 自主智能裁决后 conflictCount 归零且标记 resolved", () => {
  const networkRows = [
    {
      oltIp: "172.19.10.51",
      onuIndex: "1/1-1-9/3:3",
      loid: "LOID-RESILIENT",
      username: "李"
    }
  ];

  const nmseRows = [
    {
      oltIp: "172.19.10.51",
      coordinate: { chassis: "1", board: "9", pon: "3", onuId: "3" },
      loid: "LOID-RESILIENT",
      username: "李大伟",
      userPhone: "13812345678",
      installationAddress: "厚街镇厚街村中路1号"
    },
    {
      oltIp: "172.19.10.99",
      coordinate: { chassis: "1", board: "1", pon: "1", onuId: "1" },
      loid: "LOID-RESILIENT",
      username: "旧工单(已停机)",
      userPhone: "",
      installationAddress: ""
    }
  ];

  const result = mergeOnuDatasets(networkRows, nmseRows);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].username, "李大伟");
  assert.equal(result.rows[0].userPhone, "13812345678");

  // 关键断言：自主裁决后真实未决冲突数为 0
  assert.equal(result.stats.conflictCount, 0);
  assert.equal(result.stats.arbitratedCount, 1);
  assert.equal(result.stats.unresolvedCount, 0);

  // 审计记录中标记了 resolved 与 arbitrated
  const arbitratedConflict = result.conflicts.find((c) => c.loid === "LOID-RESILIENT");
  assert.ok(arbitratedConflict);
  assert.equal(arbitratedConflict.resolved, true);
  assert.equal(arbitratedConflict.arbitrated, true);
});
