const RESOURCE_SYNC_OPERATIONS = new Set(["network", "nmse", "merge", "full"]);

export async function handleResourceSyncRoutes(req, res, url, {
  getResourceSyncTasks,
  createResourceSyncTask,
  updateResourceSyncTask,
  deleteResourceSyncTask,
  resourceSyncScheduler,
  readBody,
  json,
  createTaskId
} = {}) {
  if (req.method === "GET" && url.pathname === "/api/admin/resource-sync-tasks") {
    await json(res, 200, { rows: await getResourceSyncTasks() });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-sync-tasks") {
    try {
      const body = await readBody(req);
      if (body && typeof body === "object" && Object.hasOwn(body, "oltId")) {
        const error = new Error("新的定时同步不需要选择 OLT，请改用同步类型。");
        error.status = 400;
        throw error;
      }
      const operation = String(body?.operation || "").trim();
      if (!RESOURCE_SYNC_OPERATIONS.has(operation)) {
        const error = new Error("同步类型无效，请选择网管二期同步、NMSE-PON同步、手动合并或全量同步。");
        error.status = 400;
        throw error;
      }
      const runAt = new Date(body.runAt);
      if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= Date.now()) {
        await json(res, 400, { ok: false, error: "执行时间必须晚于当前时间。" });
        return true;
      }
      const repeatDays = body.repeatDays === undefined || body.repeatDays === null || body.repeatDays === ""
        ? 0
        : Number(body.repeatDays);
      if (!Number.isInteger(repeatDays) || repeatDays < 0 || repeatDays > 365) {
        return json(res, 400, { ok: false, error: "重复间隔必须是 0-365 的整数天数。" });
      }
      const task = await createResourceSyncTask({ id: createTaskId(), operation, runAt: runAt.toISOString(), repeatDays });
      resourceSyncScheduler.schedule(task);
      await json(res, 200, { ok: true, task });
      return true;
    } catch (error) {
      await json(res, error.status || 400, { ok: false, error: error.message || "定时任务创建失败。" });
      return true;
    }
  }
  const resourceSyncTaskMatch = url.pathname.match(/^\/api\/admin\/resource-sync-tasks\/([^/]+)$/);
  const resourceSyncTaskDeleteMatch = url.pathname.match(/^\/api\/admin\/resource-sync-tasks\/([^/]+)\/delete$/);
  if (req.method === "DELETE" && resourceSyncTaskDeleteMatch) {
    const taskId = decodeURIComponent(resourceSyncTaskDeleteMatch[1]);
    const task = (await getResourceSyncTasks()).find((item) => item.id === taskId);
    if (!task) {
      await json(res, 404, { ok: false, error: "定时任务不存在。" });
      return true;
    }
    if (task.status === "running") {
      await json(res, 409, { ok: false, error: "任务正在执行，暂不能删除。" });
      return true;
    }
    resourceSyncScheduler.clear(taskId);
    await deleteResourceSyncTask(taskId);
    await json(res, 200, { ok: true, id: taskId });
    return true;
  }
  if (req.method === "DELETE" && resourceSyncTaskMatch) {
    const taskId = decodeURIComponent(resourceSyncTaskMatch[1]);
    const task = (await getResourceSyncTasks()).find((item) => item.id === taskId);
    if (!task) {
      await json(res, 404, { ok: false, error: "定时任务不存在。" });
      return true;
    }
    if (task.status !== "pending") {
      await json(res, 409, { ok: false, error: "该任务已开始或已结束，不能取消。" });
      return true;
    }
    resourceSyncScheduler.clear(taskId);
    await json(res, 200, { ok: true, task: await updateResourceSyncTask(taskId, { status: "canceled", error: "", resultCount: 0 }) });
    return true;
  }
  return false;
}
