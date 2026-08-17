import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-merged-onu-"));

const db = await import("../src/db.mjs");
const { resolveTool } = await import("../src/runtime-paths.mjs");
const {
  mergeOnuDatasets,
  normalizeMergedCoordinate,
  normalizeMergedLoid,
  syncMergedOnuDataset
} = await import("../src/merged-onu-sync.mjs");

test("normalizes LOID and both ONU coordinate display formats", () => {
  assert.equal(normalizeMergedLoid(" loid-a 01 "), "LOID-A01");
  assert.deepEqual(normalizeMergedCoordinate("1/3/12:8"), {
    chassis: "1", board: "3", pon: "12", onuId: "8", key: "1/3/12:8", display: "1/3/12:8"
  });
  assert.deepEqual(normalizeMergedCoordinate("1/3/12/8"), {
    chassis: "1", board: "3", pon: "12", onuId: "8", key: "1/3/12:8", display: "1/3/12/8"
  });
});

test("uses LOID to move the NMSE name across migrated OLT coordinates", () => {
  const result = mergeOnuDatasets([
    {
      oltIp: "172.19.104.101",
      deviceName: "ZTE-GPON 1/3/6:7",
      loid: "loid-moved",
      username: "黄"
    }
  ], [
    {
      oltIp: "172.19.10.98",
      onuIndex: "1/8/4:56",
      loid: " LOID-MOVED ",
      username: "黄雁"
    }
  ]);

  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.rows[0], {
    oltIp: "172.19.104.101",
    chassis: "1",
    board: "3",
    pon: "6",
    onuId: "7",
    onuIndexDisplay: "ZTE-GPON 1/3/6:7",
    deviceName: "ZTE-GPON 1/3/6:7",
    deviceNumber: "",
    loid: "LOID-MOVED",
    loidDisplay: "loid-moved",
    mac: "",
    serial: "",
    username: "黄雁",
    userPhone: "",
    installationAddress: "",
    deviceType: "",
    ponType: "",
    phase: "",
    rxPower: "",
    distance: "",
    persistable: true,
    usernameSource: "nmse",
    nmseOltIp: "172.19.10.98",
    nmseOnuIndex: "1/8/4:56"
  });
});

test("NMSE only supplies the username and coordinate fallback is strict", () => {
  const result = mergeOnuDatasets([
    {
      oltIp: "192.0.2.10",
      onuIndex: "1/3/12:8",
      loid: "",
      username: "残缺",
      mac: "AA:BB",
      userPhone: "13800000000",
      installationAddress: "网管地址"
    }
  ], [
    {
      oltIp: "192.0.2.10",
      onuIndex: "1/3/12/8",
      loid: "NMSE-ONLY",
      username: "完整姓名",
      mac: "NMSE-MUST-NOT-WIN",
      userPhone: "NMSE-PHONE-MUST-NOT-WIN"
    }
  ]);

  assert.equal(result.rows[0].username, "完整姓名");
  assert.equal(result.rows[0].usernameSource, "nmse");
  assert.equal(result.rows[0].loid, "NMSE-ONLY");
  assert.equal(result.rows[0].mac, "AA:BB");
  assert.equal(result.rows[0].userPhone, "NMSE-PHONE-MUST-NOT-WIN");
  assert.equal(result.rows[0].installationAddress, "网管地址");
  assert.equal(result.rows[0].nmseOltIp, "192.0.2.10");
});

test("keeps network contact fields when NMSE has no matching user", () => {
  const result = mergeOnuDatasets([
    {
      oltIp: "192.0.2.11",
      onuIndex: "1/1/1:1",
      username: "网管姓名",
      userPhone: "13800000000",
      installationAddress: "网管装机地址"
    }
  ], []);
  assert.equal(result.rows[0].username, "网管姓名");
  assert.equal(result.rows[0].userPhone, "13800000000");
  assert.equal(result.rows[0].installationAddress, "网管装机地址");
});

test("keeps normal network rows while reporting missing and duplicate LOID conflicts", () => {
  const result = mergeOnuDatasets([
    { oltIp: "192.0.2.20", onuIndex: "1/1/1:1", loid: "GOOD", username: "网管用户" },
    { oltIp: "192.0.2.20", onuIndex: "not-a-coordinate", loid: "MISSING-COORD", username: "保留" }
  ], [
    { oltIp: "192.0.2.20", onuIndex: "1/1/1:1", loid: "GOOD", username: "NMSE用户" },
    { oltIp: "192.0.2.21", onuIndex: "1/2/1:2", loid: "DUP", username: "甲" },
    { oltIp: "192.0.2.22", onuIndex: "1/2/1:3", loid: "DUP", username: "乙" },
    { oltIp: "192.0.2.20", username: "无法归属" }
  ]);

  assert.equal(result.rows[0].username, "NMSE用户");
  assert.equal(result.rows[1].username, "保留");
  assert.equal(result.rows[1].persistable, false);
  assert.ok(result.conflicts.some((item) => item.reason === "network_coordinate_unparseable"));
  assert.ok(result.conflicts.some((item) => item.reason === "nmse_loid_duplicate"));
  assert.ok(result.conflicts.some((item) => item.reason === "nmse_unassignable"));
});

test("duplicate network primary keys fail safely", () => {
  assert.throws(() => mergeOnuDatasets([
    { oltIp: "192.0.2.30", onuIndex: "1/1/1:1", username: "a" },
    { oltIp: "192.0.2.30", onuIndex: "1/1/1/1", username: "b" }
  ], []), /网管二期 ONU 主键重复/);
});

test("sync backs up the complete old database before replacing merged snapshots", async () => {
  await db.initDb();
  await db.replaceResourceUsers({
    oltIp: "192.0.2.40",
    gridRank: "synthetic-grid",
    rows: [{ onuIndexName: "1/1/1:1", username: "旧表用户", loid: "OLD-TABLE" }]
  });

  const result = await syncMergedOnuDataset({
    backupReason: "merged-onu-test",
    networkRows: [{
      oltIp: "192.0.2.40",
      deviceName: "ZTE-GPON 1/1/1:1",
      loid: "LOID-40",
      username: "网管"
    }],
    nmseRows: [{
      oltIp: "192.0.2.41",
      onuIndex: "1/9/9:9",
      loid: "LOID-40",
      username: "合并用户"
    }]
  });

  assert.match(result.backup.path, /backups\/olt-manager-merged-onu-test-/);
  await access(result.backup.path);
  const backupBytes = await readFile(result.backup.path);
  assert.equal(backupBytes.byteLength, result.backup.bytes);
  assert.equal(createHash("sha256").update(backupBytes).digest("hex"), result.backup.sha256);
  assert.ok(backupBytes.includes(Buffer.from("resource_user_snapshots")));
  assert.ok(backupBytes.includes(Buffer.from("merged_onu_snapshots")));

  const snapshots = await db.getMergedOnuSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].username, "合并用户");
  assert.equal(snapshots[0].nmseOltIp, "192.0.2.41");
  assert.equal(snapshots[0].nmseOnuIndex, "1/9/9:9");
  const runs = await db.getMergedOnuSyncRuns();
  assert.equal(runs[0].status, "success");
  assert.equal(runs[0].backupSha256, result.backup.sha256);
  assert.match((await db.getMergedOnuDatasetRevision()).revision, /^dataset:[a-f0-9]{32}$/);
  assert.equal((await db.getResourceUsers({ oltIp: "192.0.2.40" }))[0].username, "旧表用户");
});

test("restoring a pre-merge SQLite backup recreates merged tables without using old user snapshots", async () => {
  const fullBackup = await db.exportDatabaseBackup();
  const oldBackupPath = join(process.env.OLT_MANAGER_DATA_DIR, "synthetic-old-backup.sqlite");
  await writeFile(oldBackupPath, fullBackup);
  await new Promise((resolve, reject) => {
    const child = spawn(resolveTool("sqlite3"), ["-batch", oldBackupPath]);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `sqlite3 exited ${code}`)));
    child.stdin.end("DROP TABLE merged_onu_conflicts; DROP TABLE merged_onu_sync_runs; DROP TABLE merged_onu_snapshots; DROP TABLE merged_onu_dataset_state;\n");
  });
  await db.restoreDatabaseBackup(await readFile(oldBackupPath));
  assert.deepEqual(await db.getMergedOnuSnapshots(), []);
  assert.equal((await db.getMergedOnuDatasetStatus()).synced, false);
  assert.equal((await db.getResourceUsers({ oltIp: "192.0.2.40" }))[0].username, "旧表用户");
});
