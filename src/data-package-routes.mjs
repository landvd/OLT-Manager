// 资料包接口（ADR-088）：导出 / 预览 / 导入内勤维护的资料。只读写本地 SQLite，不触发任何 OLT 命令。
export async function handleDataPackageRoutes(req, res, url, {
  exportDataPackage,
  inspectDataPackage,
  importDataPackage,
  appVersion = "",
  readBody,
  json
} = {}) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/data-package")) return false;
  const fail = (error, fallback) => json(res, error?.status || 400, { ok: false, error: error?.message || fallback });
  try {
    if (req.method === "GET" && pathname === "/api/data-package/export") {
      const categories = url.searchParams.get("categories") || undefined;
      await json(res, 200, await exportDataPackage({ categories: categories ? categories.split(",") : undefined, appVersion }));
    } else if (req.method === "POST" && pathname === "/api/data-package/inspect") {
      await json(res, 200, { ok: true, ...(await inspectDataPackage(await readBody(req))) });
    } else if (req.method === "POST" && pathname === "/api/data-package/import") {
      const body = await readBody(req);
      await json(res, 200, await importDataPackage(body.package, { categories: body.categories, confirmed: body.confirmed === true }));
    } else {
      return false;
    }
  } catch (error) {
    await fail(error, "资料包操作失败。");
  }
  return true;
}
