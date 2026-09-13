import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-duplicate-audit-"));
const db = await import("../src/db.mjs");
const { mergeOnuDatasets } = await import("../src/merged-onu-sync.mjs");
const { createMergedOnuSyncRuntime } = await import("../src/merged-onu-sync-runtime.mjs");
const { handleMergedOnuRoutes } = await import("../src/merged-onu-routes.mjs");

test("replaceMergedOnuNetworkSource persists duplicateCount and duplicateConflicts, and getMergedOnuNetworkSource maps them back", async () => {
  await db.initDb();

  const inputRows = [
    {
      oltIp: "192.0.2.10",
      chassis: "1",
      board: "7",
      pon: "14",
      onuId: "10",
      onuIndexDisplay: "1/7/14:10",
      deviceName: "厚街OLT",
      deviceNumber: "DEV-1001",
      loid: "LOID-DUP-1",
      loidDisplay: "LOID-DUP-1",
      mac: "AA:BB:CC:DD:EE:10",
      serial: "SN1001",
      username: "张三",
      userPhone: "13800000001",
      installationAddress: "厚街镇莞太路1号",
      deviceType: "ZXHN F660",
      ponType: "GPON",
      phase: "在线",
      rxPower: "-19.2",
      distance: "1200",
      duplicateCount: 3,
      duplicateConflicts: ["LOID差异: LOID-DUP-1 vs LOID-DUP-OLD", "状态差异: 在线 vs 离线"]
    },
    {
      oltIp: "192.0.2.10",
      chassis: "1",
      board: "7",
      pon: "14",
      onuId: "11",
      onuIndexDisplay: "1/7/14:11",
      deviceName: "厚街OLT",
      deviceNumber: "DEV-1002",
      loid: "LOID-SINGLE",
      loidDisplay: "LOID-SINGLE",
      mac: "AA:BB:CC:DD:EE:11",
      serial: "SN1002",
      username: "李四",
      userPhone: "13800000002",
      installationAddress: "厚街镇莞太路2号",
      deviceType: "ZXHN F660",
      ponType: "GPON",
      phase: "在线",
      rxPower: "-20.1",
      distance: "1500",
      duplicateCount: 1,
      duplicateConflicts: []
    }
  ];

  await db.replaceMergedOnuNetworkSource({ rows: inputRows });

  const fetched = await db.getMergedOnuNetworkSource();
  assert.equal(fetched.length, 2);

  const dupRow = fetched.find((r) => r.onuId === "10");
  assert.ok(dupRow);
  assert.equal(dupRow.duplicateCount, 3);
  assert.deepEqual(dupRow.duplicateConflicts, [
    "LOID差异: LOID-DUP-1 vs LOID-DUP-OLD",
    "状态差异: 在线 vs 离线"
  ]);

  const singleRow = fetched.find((r) => r.onuId === "11");
  assert.ok(singleRow);
  assert.equal(singleRow.duplicateCount, 1);
  assert.deepEqual(singleRow.duplicateConflicts, []);
});

test("replaceMergedOnuNetworkSource with manifestContext atomically writes snapshot and manifest", async () => {
  const inputRows = [
    {
      oltIp: "192.0.2.10",
      chassis: "1",
      board: "1",
      pon: "1",
      onuId: "1",
      loid: "LOID-ATOMIC",
      username: "原子测试",
      duplicateCount: 1,
      duplicateConflicts: []
    }
  ];

  const manifestContext = {
    runId: "run-atomic-network",
    idempotencyKey: "idem-atomic-key",
    startedAt: "2026-09-10T01:00:00.000Z",
    completedAt: "2026-09-10T01:02:00.000Z",
    targetOltIds: ["olt-10"]
  };

  const stored = await db.replaceMergedOnuNetworkSource({ rows: inputRows, manifestContext });
  assert.equal(stored.count, 1);
  assert.ok(stored.manifest);
  assert.equal(stored.manifest.runId, "run-atomic-network");
  assert.equal(stored.manifest.source, "network");

  const manifest = await db.getLatestMergedOnuSourceManifest("network");
  assert.ok(manifest);
  assert.equal(manifest.runId, "run-atomic-network");
  assert.equal(manifest.rowCount, 1);
  assert.deepEqual(manifest.targetOltIds, ["olt-10"]);
});

test("mergeOnuSources generates network_coordinate_duplicate conflict when duplicateCount > 1", () => {
  const networkRows = [
    {
      oltIp: "192.0.2.10",
      chassis: "1",
      board: "7",
      pon: "14",
      onuId: "10",
      onuIndex: "1/7/14:10",
      loid: "LOID-DUP",
      username: "张三",
      duplicateCount: 2,
      duplicateConflicts: ["LOID差异: LOID-DUP vs LOID-OLD"]
    }
  ];

  const result = mergeOnuDatasets(networkRows, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, "network_coordinate_duplicate");
  assert.match(result.conflicts[0].detail, /网管二期坐标包含 2 条重复记录/);
  assert.match(result.conflicts[0].detail, /LOID差异/);
});

test("mergedOnuSyncRuntime fails closed when targets or rows are zero", async () => {
  // Test 1: 0 targets in runSourceSync
  const runtimeNoTargets = createMergedOnuSyncRuntime({
    state: { running: false, status: "idle", phase: "idle" },
    recoveryState: { inspectedAt: "", runs: [] },
    workerId: "w1",
    remoteSessionState: {},
    mergedOnuService: {
      selectMergedOnuTargets: () => [],
      selectMergedNmseTargets: () => []
    },
    getOlts: async () => [],
    getResourceOltIpMappings: async () => [],
    activeOssNgbSession: () => ({ olts: [], client: {} }),
    backupDatabaseBeforeSync: async () => ({ path: "/b.sqlite", bytes: 1, sha256: "s" }),
    listRecoverableMergedOnuSyncRuns: async () => [],
    beginMergedOnuSyncRun: async () => ({ duplicate: false, run: { runId: "r1", operation: "network", status: "running" } }),
    claimMergedOnuSyncLease: async () => ({ claimed: true }),
    renewMergedOnuSyncLease: async () => ({ renewed: true }),
    updateMergedOnuSyncRuntime: async () => ({ updated: true }),
    getLatestMergedOnuSourceManifest: async () => null,
    getMergedOnuDatasetStatus: async () => ({ sources: {} }),
    getMergedOnuSyncRuns: async () => [],
    getMergedOnuSourceStatus: async () => ({ network: {}, nmse: {} }),
    getMergedOnuNetworkSource: async () => [],
    getMergedOnuNmseSource: async () => [],
    replaceMergedOnuNetworkSource: async () => ({ source: {} }),
    runNmseBossIncremental: async () => {},
    persistMergedOnuManifest: async () => {},
    recordMergedOnuSourceSyncSuccess: async () => {},
    recordMergedOnuSyncFailure: async () => {},
    syncMergedOnuDataset: async () => ({})
  });

  await assert.rejects(
    () => runtimeNoTargets.runSourceSync("network"),
    /没有已启用的网管二期 OLT 目标/
  );

  await assert.rejects(
    () => runtimeNoTargets.runSourceSync("nmse"),
    /没有已启用的 NMSE-PON OLT 目标/
  );

  await assert.rejects(
    () => runtimeNoTargets.runFullSync(),
    /没有已启用的网管二期 OLT 目标/
  );

  // Test 2: 0 rows returned from readNetworkRows
  const runtimeZeroRows = createMergedOnuSyncRuntime({
    state: { running: false, status: "idle", phase: "idle" },
    recoveryState: { inspectedAt: "", runs: [] },
    workerId: "w2",
    remoteSessionState: {},
    mergedOnuService: {
      selectMergedOnuTargets: () => [{ target: { id: "olt-1", host: "10.0.0.1" }, mapping: { resourceIp: "r-1" } }]
    },
    getOlts: async () => [{ id: "olt-1", host: "10.0.0.1", enabled: true }],
    getResourceOltIpMappings: async () => [{ oltIp: "10.0.0.1", resourceIp: "r-1" }],
    activeOssNgbSession: () => ({
      olts: [{ resourceIp: "r-1", cuid: "cuid-1" }],
      client: { readOnuInventory: async () => [] } // returns 0 rows
    }),
    backupDatabaseBeforeSync: async () => ({ path: "/b.sqlite", bytes: 1, sha256: "s" }),
    listRecoverableMergedOnuSyncRuns: async () => [],
    beginMergedOnuSyncRun: async () => ({ duplicate: false, run: { runId: "r2", operation: "network", status: "running" } }),
    claimMergedOnuSyncLease: async () => ({ claimed: true }),
    renewMergedOnuSyncLease: async () => ({ renewed: true }),
    updateMergedOnuSyncRuntime: async () => ({ updated: true }),
    getLatestMergedOnuSourceManifest: async () => null,
    getMergedOnuDatasetStatus: async () => ({ sources: {} }),
    getMergedOnuSyncRuns: async () => [],
    getMergedOnuSourceStatus: async () => ({ network: {}, nmse: {} }),
    getMergedOnuNetworkSource: async () => [],
    getMergedOnuNmseSource: async () => [],
    replaceMergedOnuNetworkSource: async () => ({ source: {} }),
    runNmseBossIncremental: async () => {},
    persistMergedOnuManifest: async () => {},
    recordMergedOnuSourceSyncSuccess: async () => {},
    recordMergedOnuSyncFailure: async () => {},
    syncMergedOnuDataset: async () => ({})
  });

  await assert.rejects(
    () => runtimeZeroRows.runSourceSync("network"),
    /未读取到任何有效 ONU 记录/
  );

  await assert.rejects(
    () => runtimeZeroRows.runFullSync(),
    /未读取到任何有效 ONU 记录/
  );
});

test("POST /api/admin/merged-onu/boss-name-history/reset resets historical completion state and creates backup", async () => {
  let resetCalled = false;
  let backupCalled = false;

  const dependencies = {
    backupDatabaseBeforeSync: async ({ reason }) => {
      backupCalled = true;
      assert.equal(reason, "nmse-boss-name-history-reset");
      return { path: "/data/backups/test-backup.sqlite", bytes: 1024, sha256: "abc123" };
    },
    resetNmseBossNameHistory: async () => {
      resetCalled = true;
      return { nameHistoryCompletedAt: "", nameHistoryCount: 0 };
    },
    readBody: async () => ({}),
    json: async (_res, status, body) => ({ status, body })
  };

  let jsonResult = null;
  const mockRes = {};
  const mockReq = { method: "POST" };
  const mockUrl = new URL("http://localhost/api/admin/merged-onu/boss-name-history/reset");

  const handled = await handleMergedOnuRoutes(mockReq, mockRes, mockUrl, {
    ...dependencies,
    json: async (_res, status, body) => {
      jsonResult = { status, body };
    }
  });

  assert.equal(handled, true);
  assert.equal(backupCalled, true);
  assert.equal(resetCalled, true);
  assert.equal(jsonResult.status, 200);
  assert.equal(jsonResult.body.ok, true);
  assert.equal(jsonResult.body.backup.name, "test-backup.sqlite");
  assert.equal(jsonResult.body.bossSync.nameHistoryCompletedAt, "");
});
