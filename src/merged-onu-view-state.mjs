export function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "";
}

export function mergedOnuSyncPhaseText(phase) {
  return {
    idle: "尚未开始",
    "backing-up": "正在备份本机数据库",
    "fetching-network": "正在读取网管二期全量 ONU",
    "fetching-nmse": "正在读取 NMSE-PON 用户姓名",
    "reading-sources": "正在读取本机源快照",
    merging: "正在合并统一数据集",
    complete: "同步完成",
    failed: "同步失败"
  }[phase] || "等待同步状态";
}

export function mergedOnuSourceStatusText(source = {}) {
  if (!source.synced) return "尚未同步";
  return `${source.count || 0} 条 · ${formatDate(source.updatedAt) || "已同步"}`;
}

export function mergedOnuSyncStatusText(progress = {}) {
  if (progress.status === "success") return "已完成";
  if (progress.status === "failed") return "失败";
  if (progress.running || progress.status === "running") return "执行中";
  return "尚未运行";
}

export function mergedOnuSyncPercent(progress = {}) {
  const total = Number(progress.totalOlts || 0);
  if (!total) return progress.status === "success" ? 100 : 0;
  if (progress.phase === "fetching-network") return Math.min(80, Math.round((Number(progress.completedOlts || 0) / total) * 80));
  if (progress.phase === "fetching-nmse") {
    const pages = Number(progress.nmsePages || 0);
    if (!pages) return 80;
    return Math.min(99, 80 + Math.round((Number(progress.nmseCompletedPages || 0) / pages) * 19));
  }
  if (progress.phase === "merging" || progress.phase === "complete") return 100;
  return 0;
}
