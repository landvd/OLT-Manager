import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-cleanup-dup-test-"));

const db = await import("../src/db.mjs");
const { normalizeBossChange } = await import("../src/nmse-boss-sync.mjs");
const change = (input) => normalizeBossChange({ processStatus: "成功", installationAddress: "厚街镇测试地址", ...input });

test("cleanupDuplicateSnapshotCoordinates runs safely on clean database", async () => {
  await db.initDb();
  const result = await db.cleanupDuplicateSnapshotCoordinates();
  assert.equal(result.cleanedCount, 0);
  assert.deepEqual(result.cleanedLoids, []);
});

test("cleanupDuplicateSnapshotCoordinates removes stale coordinate and resolves BOSS 409 conflict", async () => {
  await db.initDb();
  await db.initializeNmseBossSyncState({ watermark: "2026-09-07 00:00:00" });

  // 1. 模拟历史快照中同一个 LOID 存在两个不同坐标
  await db.replaceResourceUsersBatch({
    datasets: [{
      oltIp: "192.0.2.10",
      gridRank: "g",
      rows: [
        { onuIndexName: "1/1/1:1", loid: "CONFLICT-LOID-1", username: "张三" },
        { onuIndexName: "1/1/1:2", loid: "CONFLICT-LOID-1", username: "张三" }
      ]
    }]
  });
  await db.replaceMergedOnuNmseSource({
    rows: [
      { oltIp: "192.0.2.10", onuIndexDisplay: "1/1/1:1", loid: "CONFLICT-LOID-1", username: "张三" },
      { oltIp: "192.0.2.10", onuIndexDisplay: "1/1/1:2", loid: "CONFLICT-LOID-1", username: "张三" }
    ]
  });

  // 2. 模拟当前真实设备在线基准中，张三在 1/1/1:2
  await db.rawExec(`
    INSERT OR REPLACE INTO merged_onu_snapshots (
      olt_ip, chassis, board, pon, onu_id, onu_index_display, loid, username
    ) VALUES (
      '192.0.2.10', '1', '1', '1', '2', '1/1/1:2', 'CONFLICT-LOID-1', '张三'
    );
  `);

  // 3. 在清理前，尝试对 CONFLICT-LOID-1 下发 BOSS 移机工单，断言必须触发熔断保护 (409 多个旧快照)
  const bossChangeRow = change({
    operation: "移机",
    workOrder: "wo-test-1",
    idempotencyKey: "key-test-1",
    LOID: "CONFLICT-LOID-1",
    receivedAt: "2026-09-07 01:00:00",
    oltIp: "192.0.2.20",
    onuIndex: "1/2/3:4"
  });

  await assert.rejects(
    db.applyNmseBossIncrementalChanges({
      rows: [bossChangeRow],
      watermark: "2026-09-08 00:00:00",
      windowStart: "2026-09-07 00:00:00",
      windowEnd: "2026-09-08 00:00:00"
    }),
    /多个旧快照/
  );

  // 4. 执行自动清理
  const cleanupResult = await db.cleanupDuplicateSnapshotCoordinates();
  assert.equal(cleanupResult.cleanedCount, 1);
  assert.deepEqual(cleanupResult.cleanedLoids, ["CONFLICT-LOID-1"]);

  // 5. 校验快照表中，旧坐标 1/1/1:1 已被安全剔除，仅保留真实坐标 1/1/1:2
  const resourceRows = await db.rawQuery(
    "SELECT olt_ip, onu_index, loid FROM resource_user_snapshots WHERE loid = 'CONFLICT-LOID-1';"
  );
  assert.equal(resourceRows.length, 1);
  assert.equal(resourceRows[0].onu_index, "1/1/1:2");

  const nmseRows = await db.rawQuery(
    "SELECT olt_ip, onu_index_display, loid FROM merged_onu_nmse_snapshots WHERE loid = 'CONFLICT-LOID-1';"
  );
  assert.equal(nmseRows.length, 1);
  assert.equal(nmseRows[0].onu_index_display, "1/1/1:2");

  // 6. 清理后，再次下发同样的 BOSS 增量工单，断言必须顺利提交，不再报错
  const applyResult = await db.applyNmseBossIncrementalChanges({
    rows: [bossChangeRow],
    watermark: "2026-09-08 00:00:00",
    windowStart: "2026-09-07 00:00:00",
    windowEnd: "2026-09-08 00:00:00"
  });
  assert.equal(applyResult.count, 1);
});

test("POST /api/admin/merged-onu/cleanup-duplicates route works via createServerDataAccess", async () => {
  const { createServerDataAccess } = await import("../src/server-data-access.mjs");
  const { handleMergedOnuRoutes } = await import("../src/merged-onu-routes.mjs");

  const dataAccess = createServerDataAccess(db);
  assert.equal(typeof dataAccess.cleanupDuplicateSnapshotCoordinates, "function");

  const responses = [];
  const handled = await handleMergedOnuRoutes(
    { method: "POST" },
    {},
    new URL("http://localhost:8787/api/admin/merged-onu/cleanup-duplicates"),
    {
      cleanupDuplicateSnapshots: dataAccess.cleanupDuplicateSnapshotCoordinates,
      json: async (_res, status, body) => responses.push({ status, body })
    }
  );

  assert.equal(handled, true);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.ok, true);
  assert.equal(typeof responses[0].body.cleanedCount, "number");
});

