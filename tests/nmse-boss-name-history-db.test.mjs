import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-boss-name-history-db-"));
const db = await import("../src/db.mjs");
const { mergeOnuDatasets } = await import("../src/merged-onu-sync.mjs");
const { normalizeBossChange } = await import("../src/nmse-boss-sync.mjs");

test("historical BOSS names overlay NMSE rows by LOID and remain available for network-only matches", async () => {
  await db.initDb();
  await db.initializeNmseBossSyncState({ watermark: "2026-09-07 00:00:00" });
  await db.replaceMergedOnuNmseSource({ rows: [{
    oltIp: "192.0.2.10", onuIndexDisplay: "1/1/1:1", loid: "MATCH-1", username: "叶"
  }] });

  const persisted = await db.replaceNmseBossNameHistory({
    rows: [
      { loid: "MATCH-1", username: "叶德华", workOrder: "history-1", receivedAt: "2025-01-02 03:04:05" },
      { loid: "NETWORK-ONLY", username: "张三丰", workOrder: "history-2", receivedAt: "2025-02-03 04:05:06" }
    ],
    watermark: "2026-09-10 12:00:00",
    windowStart: "2019-08-23 00:00:00",
    windowEnd: "2026-09-10 12:00:00",
    coverageThrough: "2026-09-09",
    eventCount: 3,
    skippedCount: 1,
    conflictCount: 0,
    manifestContext: {
      runId: "run-name-history", startedAt: "2026-09-10T03:00:00.000Z", completedAt: "2026-09-10T04:00:00.000Z",
      windowStart: "2019-08-22T16:00:00.000Z", windowEnd: "2026-09-10T04:00:00.000Z",
      coverageThrough: "2026-09-09", targetOltIds: ["olt-1"]
    }
  });

  assert.equal(persisted.nameCount, 2);
  const source = await db.getMergedOnuNmseSource();
  assert.equal(source.length, 2);
  assert.equal(source.find((row) => row.loid === "MATCH-1")?.username, "叶德华");
  assert.equal(source.find((row) => row.loid === "NETWORK-ONLY")?.username, "张三丰");

  const merged = mergeOnuDatasets([
    { oltIp: "192.0.2.10", onuIndex: "1/1/1:1", loid: "MATCH-1", username: "叶" },
    { oltIp: "192.0.2.10", onuIndex: "1/1/1:2", loid: "NETWORK-ONLY", username: "张" }
  ], source);
  assert.deepEqual(merged.rows.map(({ username, usernameSource }) => ({ username, usernameSource })), [
    { username: "叶德华", usernameSource: "nmse" },
    { username: "张三丰", usernameSource: "nmse" }
  ]);
  const state = await db.getNmseBossSyncState();
  assert.equal(state.nameHistoryStart, "2019-08-23 00:00:00");
  assert.equal(state.nameHistoryEnd, "2026-09-10 12:00:00");
  assert.equal(state.nameHistoryCount, 2);
  assert.equal(state.nameHistorySkippedCount, 1);
  assert.equal(state.coverageThrough, "2026-09-09");
  const manifest = await db.getLatestMergedOnuSourceManifest("nmse");
  assert.equal(manifest.rowCount, source.length);

  await assert.rejects(db.replaceNmseBossNameHistory({
    rows: [], watermark: "2026-09-10 13:00:00", windowStart: "2019-08-23 00:00:00", windowEnd: "2026-09-10 13:00:00"
  }), /已经初始化/);
});

test("later BOSS increment updates the persistent full-name directory", async () => {
  const changed = normalizeBossChange({
    serviceName: "移机", opResult: "1", serialNo: "increment-name", loid: "NETWORK-ONLY",
    recTime: "2026-09-10 12:30:00", username: "张三丰新", installationAddress: "厚街镇测试",
    oltIp: "192.0.2.10", onuIndex: "1/1/1:2"
  });
  await db.applyNmseBossIncrementalChanges({
    rows: [changed], watermark: "2026-09-10 13:00:00",
    windowStart: "2026-09-09 00:00:00", windowEnd: "2026-09-10 13:00:00", coverageThrough: "2026-09-09"
  });
  const source = await db.getMergedOnuNmseSource();
  assert.equal(source.find((row) => row.loid === "NETWORK-ONLY")?.username, "张三丰新");
  assert.equal((await db.getNmseBossSyncState()).nameHistoryCount, 2);
});
