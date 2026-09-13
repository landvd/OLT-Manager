import { initDb, getNmseBossSyncState, getMergedOnuSourceStatus, getMergedOnuDatasetStatus, getMergedOnuConflicts } from "../src/db.mjs";
import {
  runMergedOnuSourceSync,
  runMergedOnuManualMerge,
  publicMergedOnuSyncState
} from "../src/server.mjs";

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return min > 0 ? `${min}m ${remSec}s` : `${remSec}s`;
}

async function main() {
  console.log("================================================================================");
  console.log("             OLT Manager 全量与增量同步工作流 (Phase 2 NGB + Phase 1 BOSS)       ");
  console.log("================================================================================\n");

  await initDb();

  const startAll = Date.now();

  // ---------------------------------------------------------------------------
  // STEP 1: 网管二期全量同步
  // ---------------------------------------------------------------------------
  console.log("▶ [步骤 1/4] 开始执行：网管二期 (Phase 2 NGB) 全量存量同步...");
  const t1 = Date.now();
  let progressTimer = setInterval(() => {
    const s = publicMergedOnuSyncState();
    if (s.running) {
      console.log(`   [进度] 阶段: ${s.phase} | 已处理 OLT: ${s.completedOlts}/${s.totalOlts} | 已读取 ONU 行数: ${s.networkRows}`);
    }
  }, 3000);

  let networkResult;
  try {
    networkResult = await runMergedOnuSourceSync("network", { idempotencyKey: `cli-network-${Date.now()}` });
  } finally {
    clearInterval(progressTimer);
  }

  console.log(`✔ [步骤 1/4 完成] 网管二期全量同步耗时: ${formatDuration(Date.now() - t1)}`);
  console.log(`   - 采集有效 ONU 记录数: ${networkResult.count}`);
  console.log(`   - 源版本 (Revision): ${networkResult.source?.revision || networkResult.revision}`);
  console.log(`   - 自动备份文件: ${networkResult.backup?.path || "无"} (${networkResult.backup?.bytes || 0} bytes)`);
  if (networkResult.duplicateCount) {
    console.log(`   - 重复物理坐标择优合并行数: ${networkResult.duplicateCount}`);
  }

  // ---------------------------------------------------------------------------
  // STEP 2: 一期 BOSS 历史姓名全量初始化
  // ---------------------------------------------------------------------------
  let bossState = await getNmseBossSyncState();
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ [步骤 2/4] 检查一期 BOSS 历史姓名状态...");
  console.log(`   - 当前历史完成状态: ${bossState.nameHistoryCompletedAt ? `已于 ${bossState.nameHistoryCompletedAt} 完成` : "未完成 (需执行历史全量)"}`);
  console.log(`   - 当前历史姓名总数: ${bossState.nameHistoryCount}`);
  console.log(`   - 当前增量同步水位: ${bossState.watermark || "未设置"}`);

  if (!bossState.nameHistoryCompletedAt) {
    console.log("\n▶ 开始执行：一期 BOSS 全量历史姓名初始化 (2019-08-23 至今按月分批拉取)...");
    const t2 = Date.now();
    let lastChunk = 0;
    progressTimer = setInterval(() => {
      const s = publicMergedOnuSyncState();
      if (s.running) {
        if (s.nmseChunkIndex && s.nmseChunkIndex !== lastChunk) {
          lastChunk = s.nmseChunkIndex;
          console.log(`   [历史批次] 分块 ${s.nmseChunkIndex}/${s.nmseChunkCount} | 累计唯一 LOID 姓名: ${s.nmseRows} | 累计工单事件: ${s.nmseTotal} | 跳过: ${s.nmseHistorySkipped || 0}`);
        } else {
          console.log(`   [进度] 阶段: ${s.phase} | 当前分块: ${s.nmseChunkIndex || 0}/${s.nmseChunkCount || 0} | 累计姓名: ${s.nmseRows} (工单总数: ${s.nmseTotal})`);
        }
      }
    }, 4000);

    let historyResult;
    try {
      historyResult = await runMergedOnuSourceSync("nmse", { idempotencyKey: `cli-nmse-history-${Date.now()}` });
    } finally {
      clearInterval(progressTimer);
    }

    bossState = await getNmseBossSyncState();
    console.log(`✔ [步骤 2/4 完成] BOSS 历史姓名初始化耗时: ${formatDuration(Date.now() - t2)}`);
    console.log(`   - 历史姓名累计总数: ${bossState.nameHistoryCount}`);
    console.log(`   - 历史覆盖区间: ${bossState.nameHistoryStart} ~ ${bossState.nameHistoryEnd}`);
    console.log(`   - 历史冲突数: ${bossState.nameHistoryConflictCount} | 忽略空姓名数: ${bossState.nameHistorySkippedCount}`);
    console.log(`   - 历史完成标记时间: ${bossState.nameHistoryCompletedAt}`);
  } else {
    console.log("   一期 BOSS 历史姓名已存在且已完成初始化，跳过重新分批拉取。");
  }

  // ---------------------------------------------------------------------------
  // STEP 3: 一期 BOSS 增量工单同步
  // ---------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ [步骤 3/4] 开始执行：一期 BOSS 增量同步 (基于最新历史或上次水位推进)...");
  const t3 = Date.now();
  progressTimer = setInterval(() => {
    const s = publicMergedOnuSyncState();
    if (s.running) {
      console.log(`   [增量进度] 阶段: ${s.phase} | 工单工单数: ${s.nmseTotal} | 页数: ${s.nmseCompletedPages}/${s.nmsePages} | 已接收详情: ${s.nmseRows}`);
    }
  }, 3000);

  let nmseIncrResult;
  try {
    nmseIncrResult = await runMergedOnuSourceSync("nmse", { idempotencyKey: `cli-nmse-incr-${Date.now()}` });
  } finally {
    clearInterval(progressTimer);
  }

  bossState = await getNmseBossSyncState();
  console.log(`✔ [步骤 3/4 完成] 一期 BOSS 增量同步耗时: ${formatDuration(Date.now() - t3)}`);
  console.log(`   - 本次增量变更条数: ${nmseIncrResult.count}`);
  console.log(`   - 最新增量水位 (Watermark): ${bossState.watermark}`);
  console.log(`   - 覆盖截止日期: ${bossState.coverageThrough}`);
  console.log(`   - NMSE 源当前快照记录数: ${(await getMergedOnuSourceStatus()).nmse?.count || 0}`);

  // ---------------------------------------------------------------------------
  // STEP 4: 全量统一合并 (Manual Merge)
  // ---------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ [步骤 4/4] 开始执行：二期网管与一期 BOSS 全量合并...");
  const t4 = Date.now();
  const mergeResult = await runMergedOnuManualMerge({ idempotencyKey: `cli-merge-${Date.now()}` });

  console.log(`✔ [步骤 4/4 完成] 全量合并耗时: ${formatDuration(Date.now() - t4)}`);
  console.log(`   - 合并后总 ONU 数: ${mergeResult.mergedCount}`);
  console.log(`   - 网管二期参与合并行数: ${mergeResult.networkCount}`);
  console.log(`   - 一期 BOSS 参与合并行数: ${mergeResult.nmseCount}`);
  console.log(`   - 冲突项数量: ${mergeResult.conflictCount}`);
  console.log(`   - 最终统一数据集版本: ${mergeResult.revision}`);

  // ---------------------------------------------------------------------------
  // 汇总审计输出
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("                              全流程同步审计报告                                 ");
  console.log("================================================================================");
  console.log(`总耗时: ${formatDuration(Date.now() - startAll)}`);

  const datasetStatus = await getMergedOnuDatasetStatus();
  const sourceStatus = await getMergedOnuSourceStatus();
  const conflicts = await getMergedOnuConflicts({ runId: mergeResult.runId });

  console.log("\n【源快照状态】");
  console.log(`- 网管二期 (Network): ${sourceStatus.network?.count} 行 (更新于: ${sourceStatus.network?.updatedAt})`);
  console.log(`- NMSE 快照 (NMSE): ${sourceStatus.nmse?.count} 行 (更新于: ${sourceStatus.nmse?.updatedAt})`);
  console.log(`- BOSS 历史姓名库: ${bossState.nameHistoryCount} 条唯一 LOID 姓名映射`);

  console.log("\n【统一合并快照】");
  console.log(`- 统一数据集记录数: ${datasetStatus.snapshotCount}`);
  console.log(`- 冲突总数: ${datasetStatus.lastConflictCount}`);
  console.log(`- 数据集版本: ${datasetStatus.revision}`);

  if (conflicts.length > 0) {
    const conflictTypeCounts = {};
    for (const c of conflicts) {
      const type = c.conflict_type || c.conflictType || "unknown";
      conflictTypeCounts[type] = (conflictTypeCounts[type] || 0) + 1;
    }
    console.log("\n【冲突类型分布】");
    for (const [t, cnt] of Object.entries(conflictTypeCounts)) {
      console.log(`  - ${t}: ${cnt} 条`);
    }
  }

  console.log("\n================================================================================");
  console.log("                     二期网管全量 + 一期BOSS全量增量同步成功完成                 ");
  console.log("================================================================================\n");
}

main().catch((error) => {
  console.error("\n❌ 同步工作流执行失败:", error);
  process.exit(1);
});
