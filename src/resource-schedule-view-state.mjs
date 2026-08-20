export const RESOURCE_SYNC_OPERATIONS = Object.freeze([
  { value: "network", label: "网管二期同步" },
  { value: "nmse", label: "NMSE-PON同步" },
  { value: "merge", label: "手动合并" },
  { value: "full", label: "全量同步" }
]);

const RESOURCE_SYNC_OPERATION_LABELS = Object.freeze(
  Object.fromEntries(RESOURCE_SYNC_OPERATIONS.map((item) => [item.value, item.label]))
);

export function resourceScheduleOperationText(operation) {
  return RESOURCE_SYNC_OPERATION_LABELS[operation] || operation || "未知类型";
}

export function resourceScheduleStatusText(status) {
  return { pending: "待执行", running: "执行中", success: "已完成", failed: "失败", canceled: "已取消" }[status] || status || "未知";
}

export function resourceScheduleStatusType(status) {
  return { pending: "warning", running: "", success: "success", failed: "danger", canceled: "info" }[status] || "info";
}

export function resourceScheduleRepeatText(task = {}) {
  return Number(task.repeatDays || 0) > 0 ? `每 ${task.repeatDays} 天` : "仅一次";
}

export function resourceScheduleLastResult(task = {}) {
  const status = task.lastStatus || (task.status === "success" ? "success" : task.status === "failed" ? "failed" : "");
  const label = { success: "已完成", failed: "失败", running: "执行中" }[status] || (task.status === "canceled" ? "已取消" : "尚未执行");
  return task.error ? `${label}：${task.error}` : label;
}

export function resourceSchedulePayload({ operation = "full", runAt = "", repeatEnabled = false, repeatDays = 0 } = {}) {
  return { operation, runAt, repeatDays: repeatEnabled ? repeatDays : 0 };
}
