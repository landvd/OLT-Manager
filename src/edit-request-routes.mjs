// 飞书资料修改申请的桌面管理接口（ADR-089）：指定审批人、查看申请记录。只读写本地 SQLite。
export async function handleEditRequestRoutes(req, res, url, {
  getEditApprover,
  saveEditApprover,
  getFeishuKnownUsers,
  getEditRequests,
  readBody,
  json
} = {}) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/feishu/edit-")) return false;
  try {
    if (req.method === "GET" && pathname === "/api/feishu/edit-approver") {
      const [approver, users] = await Promise.all([getEditApprover(), getFeishuKnownUsers({ limit: 100 })]);
      await json(res, 200, { ok: true, approver, users });
    } else if (req.method === "PUT" && pathname === "/api/feishu/edit-approver") {
      const body = await readBody(req);
      const openId = String(body?.openId || "").trim();
      if (openId) {
        const known = (await getFeishuKnownUsers({ limit: 500 })).find((user) => user.openId === openId);
        if (!known) return json(res, 400, { ok: false, error: "只能从和机器人说过话的飞书用户中选择审批人。" }).then(() => true);
        await json(res, 200, { ok: true, approver: await saveEditApprover({ openId, name: known.name || String(body?.name || "") }) });
      } else {
        await json(res, 200, { ok: true, approver: await saveEditApprover({ openId: "" }) });
      }
    } else if (req.method === "GET" && pathname === "/api/feishu/edit-requests") {
      const status = url.searchParams.get("status") || "";
      await json(res, 200, { ok: true, requests: await getEditRequests({ status, limit: Number(url.searchParams.get("limit")) || 100 }) });
    } else {
      return false;
    }
  } catch (error) {
    await json(res, error?.status || 400, { ok: false, error: error?.message || "资料修改申请接口失败" });
  }
  return true;
}
