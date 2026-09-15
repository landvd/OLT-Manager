import {
  initDb,
  backupDatabaseBeforeSync,
  getMergedOnuNetworkSource,
  replaceMergedOnuNetworkSource,
  getOlts,
  getMergedOnuDatasetStatus,
  getMergedOnuSourceStatus,
  getLatestMergedOnuSourceManifest
} from "../src/db.mjs";
import { normalizeMergedCoordinate } from "../src/merged-onu-sync.mjs";
import { runMergedOnuManualMerge } from "../src/server.mjs";

async function main() {
  console.log("================================================================================");
  console.log("              华为 OLT 机框坐标纠偏与重新合并工具 (Chassis 1 -> 0)                ");
  console.log("================================================================================\n");

  await initDb();

  // 1. 备份数据库
  console.log("▶ [步骤 1/3] 正在安全备份当前 SQLite 数据库...");
  const backup = await backupDatabaseBeforeSync("before-huawei-chassis-repair");
  console.log(`✔ 数据库备份已生成: ${backup.path} (${backup.bytes} bytes)`);

  // 2. 获取所有华为 OLT 列表
  const olts = await getOlts();
  const huaweiHosts = new Set(
    olts.filter((o) => String(o.vendor || "").toLowerCase() === "huawei").map((o) => o.host)
  );
  console.log(`\n▶ [步骤 2/3] 检索华为 OLT 列表: 共 ${huaweiHosts.size} 台 (${[...huaweiHosts].join(", ") || "无"})`);

  const networkRows = await getMergedOnuNetworkSource();
  console.log(`   - 网管二期当前快照总条数: ${networkRows.length}`);

  let repairedCount = 0;
  const nextRows = networkRows.map((row) => {
    if (!huaweiHosts.has(row.oltIp)) return row;

    const parsed = normalizeMergedCoordinate(row.deviceName);

    if (parsed && parsed.chassis !== row.chassis) {
      repairedCount += 1;
      return {
        ...row,
        chassis: parsed.chassis,
        board: parsed.board,
        pon: parsed.pon,
        onuId: parsed.onuId,
        onuIndexDisplay: parsed.key
      };
    }
    return row;
  });

  console.log(`   - 发现并纠正华为机框错误记录数: ${repairedCount}`);

  const sourceStatus = await getMergedOnuSourceStatus();
  const latestManifest = await getLatestMergedOnuSourceManifest("network");
  const nmseManifest = await getLatestMergedOnuSourceManifest("nmse");
  const expectedOltIds = nmseManifest?.targetOltIds?.length ? nmseManifest.targetOltIds : olts.map((o) => o.id);

  const targetIdsMatch = JSON.stringify(latestManifest?.targetOltIds || []) === JSON.stringify(expectedOltIds);
  const needManifestRefresh = repairedCount > 0 || (latestManifest?.sourceRevision !== sourceStatus.network.revision) || !targetIdsMatch;

  if (needManifestRefresh) {
    console.log("   - 正在将网管快照与 Manifest 状态对齐写回数据库...");
    const runId = `repair-huawei-${Date.now()}`;
    await replaceMergedOnuNetworkSource({
      rows: nextRows,
      manifestContext: {
        runId,
        idempotencyKey: runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        targetOltIds: expectedOltIds
      }
    });
    console.log("✔ 网管二期快照与 Manifest 状态对齐成功！");
  } else {
    console.log("   - 网管二期快照与 Manifest 状态已一致，跳过快照重写。");
  }

  // 3. 执行重新合并
  console.log("\n▶ [步骤 3/3] 正在执行全量重新合并 (Manual Merge)，重新匹配 BOSS 资料...");
  const mergeResult = await runMergedOnuManualMerge({ idempotencyKey: `repair-huawei-${Date.now()}` });
  console.log("✔ 全量合并成功完成！");
  console.log(`   - 合并后总记录数: ${mergeResult.mergedCount}`);
  console.log(`   - 网管二期参与行数: ${mergeResult.networkCount}`);
  console.log(`   - BOSS 参与行数: ${mergeResult.nmseCount}`);
  console.log(`   - 冲突项数: ${mergeResult.conflictCount}`);
  console.log(`   - 最新数据集版本: ${mergeResult.revision}`);

  console.log("\n================================================================================");
  console.log("                           华为机框纠偏完成！                                   ");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("纠偏执行失败:", err);
  process.exit(1);
});
