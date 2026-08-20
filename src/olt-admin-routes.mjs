export async function handleOltAdminRoutes(req, res, url, {
  getOlts,
  replaceOlts,
  publicOlt,
  getPonPorts,
  replacePonPorts,
  refreshPonVlans,
  readBody,
  json,
  olts = []
} = {}) {
  if (req.method === "GET" && url.pathname === "/api/admin/olts") {
    await json(res, 200, (await getOlts({ includeSecrets: true })).map(publicOlt));
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/olts") {
    const body = await readBody(req);
    await replaceOlts(body.olts || body, "admin");
    const safeOlts = (await getOlts({ includeSecrets: true })).map(publicOlt);
    await json(res, 200, { ok: true, olts: safeOlts, adminOlts: safeOlts });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/pon-ports") {
    await json(res, 200, await getPonPorts());
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/import-pon-ports") {
    const body = await readBody(req);
    await replacePonPorts(body.rows || [], "admin");
    await json(res, 200, { ok: true, count: (body.rows || []).length });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/refresh-pon-vlans") {
    const body = await readBody(req);
    await json(res, 200, await refreshPonVlans(body, olts));
    return true;
  }
  return false;
}
