import { ponLedgerRevision } from "./pon-ledger-revision.mjs";

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
    // 带了打开台账时的指纹，就先比对：台账在此期间被别处改过（例如飞书审批改了一级地址）时拒绝整表覆盖。
    if (typeof body.baseRevision === "string" && body.baseRevision) {
      const current = ponLedgerRevision(await getPonPorts());
      if (current !== body.baseRevision) {
        await json(res, 409, { ok: false, code: "PON_LEDGER_CHANGED", error: "台账在你打开之后被别处改过（例如飞书资料修改审批），直接保存会把那些修改覆盖掉。" });
        return true;
      }
    }
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
