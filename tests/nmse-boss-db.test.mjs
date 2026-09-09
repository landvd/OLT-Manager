import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-nmse-boss-db-"));
const db = await import("../src/db.mjs");
const { normalizeBossChange } = await import("../src/nmse-boss-sync.mjs");

const change = (input) => normalizeBossChange({ processStatus: "成功", installationAddress: "厚街镇测试地址", ...input });

test("BOSS DB writer uses its own fail-fast immediate transaction boundary", async () => {
  const source = await readFile(new URL("../src/db.mjs", import.meta.url), "utf8");
  const bossStart = source.indexOf("export async function applyNmseBossIncrementalChanges");
  const bossEnd = source.indexOf("export async function recordMergedOnuSourceSyncSuccess", bossStart);
  const bossWriter = source.slice(bossStart, bossEnd);
  assert.match(bossWriter, /await exec\(`\.bail on\nBEGIN IMMEDIATE;/);
  const oltStart = source.indexOf("export async function replaceOlts");
  const oltEnd = source.indexOf("export async function getPonPorts", oltStart);
  assert.match(source.slice(oltStart, oltEnd), /await exec\(`BEGIN;/);
});

test("BOSS DB projection is atomic, idempotent, stale-safe, and accepts unregistered OLT moves", async () => {
  await db.initDb();
  await db.initializeNmseBossSyncState({ watermark: "2026-09-07 00:00:00" });
  assert.equal((await db.getNmseBossSyncState()).coverageThrough, "2026-09-06");

  await db.replaceResourceUsers({
    oltIp: "192.0.2.10", gridRank: "old-grid",
    rows: [{ onuIndexName: "1/1/1:1", loid: "  move-loid ", mac: "OLD-MAC", ponNo: "OLD-PON", ponType: "OLD-GPON", deviceType: "OLD-ONT", username: "旧用户", usertel: "13800000000", installationAddress: "旧地址" }]
  });
  const moved = change({ operation: "移机", workOrder: "move-1", LOID: "move-loid", receivedAt: "2026-09-07 01:00:00", oltIp: "198.51.100.20", onuIndex: "1/2/3:4", mac: "", pon: "", ponType: "", deviceType: "", username: "", userPhone: "", installationAddress: "" });
  await db.applyNmseBossIncrementalChanges({ rows: [moved], watermark: "2026-09-08 00:00:00", windowStart: "2026-09-07 00:00:00", windowEnd: "2026-09-08 00:00:00", coverageThrough: "2026-09-07", manifestContext: {
    runId: "run-unregistered-move", idempotencyKey: "idem-unregistered-move", startedAt: "2026-09-09T01:00:00.000Z", completedAt: "2026-09-09T01:02:03.000Z", windowStart: "2026-09-06T16:00:00.000Z", windowEnd: "2026-09-07T16:00:00.000Z", targetOltIds: ["olt-target-1"]
  } });
  let rows = await db.getResourceUsers({});
  assert.equal(rows.filter((row) => row.loid === "MOVE-LOID").length, 1);
  const movedRow = rows.find((row) => row.loid === "MOVE-LOID");
  assert.equal(movedRow.oltIp, "198.51.100.20");
  assert.equal(movedRow.onuIndex, "1/2/3:4");
  assert.equal(movedRow.username, "旧用户");
  assert.equal(movedRow.mac, "OLD-MAC");
  assert.equal(movedRow.pon, "OLD-PON");
  assert.equal(movedRow.ponType, "OLD-GPON");
  assert.equal(movedRow.deviceType, "OLD-ONT");
  assert.equal(movedRow.userPhone, "13800000000");
  assert.equal(movedRow.installationAddress, "旧地址");
  const mergedRow = (await db.getMergedOnuNmseSource()).find((row) => row.loid === "MOVE-LOID");
  assert.equal(mergedRow.mac, "OLD-MAC");
  assert.equal(mergedRow.pon, "OLD-PON");
  assert.equal(mergedRow.username, "旧用户");
  const manifest = await db.getLatestMergedOnuSourceManifest("nmse");
  assert.equal(manifest.runId, "run-unregistered-move");
  assert.equal(manifest.collectionCompletedAt, "2026-09-09T01:02:03.000Z");
  assert.equal(manifest.rowCount, 1);
  assert.deepEqual(manifest.targetOltIds, ["olt-target-1"]);
  assert.equal((await db.getNmseBossSyncState()).coverageThrough, "2026-09-07");

  const replaced = change({ operation: "更换Onu", workOrder: "replace-1", LOID: " MOVE-LOID ", receivedAt: "2026-09-07 02:00:00", oltIp: "198.51.100.20", onuIndex: "1/2/3:5", mac: "", pon: "", ponType: "", deviceType: "", username: "", userPhone: "", installationAddress: "" });
  await db.applyNmseBossIncrementalChanges({ rows: [replaced], watermark: "2026-09-08 00:00:00", windowStart: "2026-09-07 00:00:00", windowEnd: "2026-09-08 00:00:00" });
  const sequential = (await db.getResourceUsers({})).find((row) => row.loid === "MOVE-LOID");
  assert.equal(sequential.onuIndex, "1/2/3:5");
  assert.equal(sequential.mac, "OLD-MAC");
  assert.equal((await db.getMergedOnuNmseSource()).find((row) => row.loid === "MOVE-LOID").installationAddress, "旧地址");

  // Replaying the same event does not duplicate or mutate the snapshot.
  await db.applyNmseBossIncrementalChanges({ rows: [moved], watermark: "2026-09-08 00:00:00", windowStart: "2026-09-07 00:00:00", windowEnd: "2026-09-08 00:00:00" });
  rows = await db.getResourceUsers({});
  assert.equal(rows.filter((row) => row.loid === "MOVE-LOID").length, 1);

  // A stale cancellation is recorded but must not delete a newer move.
  const staleCancel = change({ operation: "销户", workOrder: "cancel-old", LOID: "  move-loid ", receivedAt: "2026-09-07 00:30:00" });
  await db.applyNmseBossIncrementalChanges({ rows: [staleCancel], watermark: "2026-09-08 00:00:00", windowStart: "2026-09-07 00:00:00", windowEnd: "2026-09-08 00:00:00" });
  assert.equal((await db.getResourceUsers({})).find((row) => row.loid === "MOVE-LOID")?.onuIndex, "1/2/3:5");

  // Conflicts are rejected before BEGIN, leaving both the snapshot and waterline intact.
  const conflicting = [
    change({ operation: "报装", workOrder: "conflict-1", LOID: "CONFLICT-A", receivedAt: "2026-09-08 01:00:00", oltIp: "198.51.100.30", onuIndex: "1/1/1:1" }),
    change({ operation: "报装", workOrder: "conflict-2", LOID: "CONFLICT-B", receivedAt: "2026-09-08 01:00:01", oltIp: "198.51.100.30", onuIndex: "1/1/1:1" })
  ];
  await assert.rejects(db.applyNmseBossIncrementalChanges({ rows: conflicting, watermark: "2026-09-09 00:00:00", windowStart: "2026-09-08 00:00:00", windowEnd: "2026-09-09 00:00:00" }), /同一坐标分配给多个 LOID/);
  assert.equal((await db.getNmseBossSyncState()).watermark, "2026-09-08 00:00:00");
  assert.equal((await db.getResourceUsers({})).some((row) => row.loid === "CONFLICT-A"), false);

  const cancel = change({ operation: "销户", workOrder: "cancel-current", LOID: " move-loid ", receivedAt: "2026-09-08 02:00:00", installationAddress: "" });
  await db.applyNmseBossIncrementalChanges({ rows: [cancel], watermark: "2026-09-09 00:00:00", windowStart: "2026-09-08 00:00:00", windowEnd: "2026-09-09 00:00:00", coverageThrough: "2026-09-08" });
  assert.equal((await db.getResourceUsers({})).some((row) => row.loid === "MOVE-LOID"), false);
  assert.equal((await db.getMergedOnuNmseSource()).some((row) => row.loid === "MOVE-LOID"), false);
});

test("BOSS DB fails closed when an existing LOID is duplicated across coordinates", async () => {
  await db.replaceResourceUsersBatch({ datasets: [{ oltIp: "192.0.2.40", gridRank: "g", rows: [
    { onuIndexName: "1/1/1:1", loid: "DUP-LOID" }, { onuIndexName: "1/1/1:2", loid: "DUP-LOID" }
  ] }] });
  const row = change({ operation: "移机", workOrder: "dup-move", LOID: "DUP-LOID", receivedAt: "2026-09-09 03:00:00", oltIp: "198.51.100.40", onuIndex: "1/2/3:4" });
  await assert.rejects(db.applyNmseBossIncrementalChanges({ rows: [row], watermark: "2026-09-10 00:00:00", windowStart: "2026-09-09 00:00:00", windowEnd: "2026-09-10 00:00:00" }), /多个旧快照/);
});

test("BOSS DB checks merged NMSE coordinates before assigning another LOID", async () => {
  await db.replaceMergedOnuNmseSource({ rows: [{
    oltIp: "198.51.100.60", onuIndexDisplay: "1/1/1:1", loid: "EXISTING-LOID"
  }] });
  const row = change({ operation: "报装", workOrder: "nmse-coordinate-conflict", LOID: "NEW-LOID", receivedAt: "2026-09-09 03:00:00", oltIp: "198.51.100.60", onuIndex: "1/1/1:1" });
  await assert.rejects(db.applyNmseBossIncrementalChanges({ rows: [row], watermark: "2026-09-10 00:00:00", windowStart: "2026-09-09 00:00:00", windowEnd: "2026-09-10 00:00:00" }), /另一 LOID 的现有坐标/);
});

test("BOSS DB returns the persisted source manifest row count", async () => {
  await db.replaceMergedOnuNmseSource({ rows: [
    { oltIp: "198.51.100.70", onuIndexDisplay: "1/1/1:1", loid: "SEED-1" },
    { oltIp: "198.51.100.70", onuIndexDisplay: "1/1/1:2", loid: "SEED-2" }
  ] });
  const row = change({ operation: "报装", workOrder: "manifest-count", LOID: "SEED-3", receivedAt: "2026-09-09 04:00:00", oltIp: "198.51.100.70", onuIndex: "1/1/1:3" });
  const result = await db.applyNmseBossIncrementalChanges({ rows: [row], watermark: "2026-09-10 00:00:00", windowStart: "2026-09-09 00:00:00", windowEnd: "2026-09-10 00:00:00", coverageThrough: "2026-09-09", manifestContext: {
    runId: "run-manifest-count", startedAt: "2026-09-10T01:00:00.000Z", completedAt: "2026-09-10T01:01:00.000Z", windowStart: "2026-09-08T16:00:00.000Z", windowEnd: "2026-09-09T16:00:00.000Z", targetOltIds: ["olt-1"]
  } });
  assert.equal(result.count, 1);
  assert.equal(result.manifest.rowCount, 3);
  assert.equal(result.manifest.rowCount, (await db.getMergedOnuNmseSource()).length);
});

test("BOSS DB projects overlapping moves before checking final coordinate ownership", async () => {
  await db.replaceResourceUsers({
    oltIp: "198.51.100.80", gridRank: "g",
    rows: [{ onuIndexName: "1/1/1:1", loid: "MOVE-A" }]
  });
  const rows = [
    change({ operation: "移机", workOrder: "overlap-old", LOID: "MOVE-A", receivedAt: "2026-09-10 01:00:00", oltIp: "198.51.100.80", onuIndex: "1/1/1:1" }),
    change({ operation: "移机", workOrder: "overlap-new", LOID: "MOVE-A", receivedAt: "2026-09-10 02:00:00", oltIp: "198.51.100.80", onuIndex: "1/1/1:2" }),
    change({ operation: "报装", workOrder: "overlap-claim", LOID: "MOVE-B", receivedAt: "2026-09-10 03:00:00", oltIp: "198.51.100.80", onuIndex: "1/1/1:1" })
  ];
  await db.applyNmseBossIncrementalChanges({ rows, watermark: "2026-09-11 00:00:00", windowStart: "2026-09-10 00:00:00", windowEnd: "2026-09-11 00:00:00" });
  const snapshot = await db.getResourceUsers({});
  assert.equal(snapshot.find((row) => row.loid === "MOVE-A")?.onuIndex, "1/1/1:2");
  assert.equal(snapshot.find((row) => row.loid === "MOVE-B")?.onuIndex, "1/1/1:1");
});
