export async function handleResourceManagementRoutes(req, res, url, {
  getResourceUsers,
  cleanResourceInstallationAddresses,
  getResourceVlanSnapshot,
  replaceResourceVlans,
  resourceTargetOlt,
  activeNmseSession,
  resourceGridRank,
  resourceUserSync,
  readBody,
  json,
  olts = [],
  clearNmseSession
} = {}) {
  if (req.method === "GET" && url.pathname === "/api/admin/resource-management/users") {
    const oltId = url.searchParams.get("oltId");
    const target = oltId ? resourceTargetOlt(olts, oltId) : null;
    await json(res, 200, { rows: await getResourceUsers({ oltIp: target?.host, q: url.searchParams.get("q") || "" }) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-management/clean-addresses") {
    const result = await cleanResourceInstallationAddresses();
    await json(res, 200, { ok: true, ...result });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/resource-management/sync-users/progress") {
    const target = resourceTargetOlt(olts, url.searchParams.get("oltId"));
    await json(res, 200, resourceUserSync.progressFor(target.id));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-management/sync-users") {
    try {
      const body = await readBody(req);
      const target = resourceTargetOlt(olts, body.oltId);
      const session = activeNmseSession();
      const gridRank = resourceGridRank(session, target);
      const result = await resourceUserSync.syncComplete({ oltId: target.id, oltIp: target.host, gridRank, session });
      await json(res, 200, { ok: true, ...result });
      return true;
    } catch (error) {
      if (error.status === 401) clearNmseSession();
      await json(res, error.status || 502, { ok: false, error: error.message || "用户信息同步失败。" });
      return true;
    }
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-management/sync-users/checkpoint") {
    try {
      const body = await readBody(req);
      const target = resourceTargetOlt(olts, body.oltId);
      const session = activeNmseSession();
      const gridRank = resourceGridRank(session, target);
      const maxPages = Math.min(50, Math.max(1, Number(body.pages) || 1));
      const result = await resourceUserSync.saveCheckpoint({ oltId: target.id, oltIp: target.host, gridRank, session, maxPages });
      await json(res, 200, { ok: true, ...result });
      return true;
    } catch (error) {
      if (error.status === 401) clearNmseSession();
      await json(res, error.status || 502, { ok: false, error: error.message || "用户检查点保存失败。" });
      return true;
    }
  }
  if (req.method === "GET" && url.pathname === "/api/admin/resource-management/vlans") {
    const target = resourceTargetOlt(olts, url.searchParams.get("oltId"));
    await json(res, 200, await getResourceVlanSnapshot(target.host));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-management/sync-vlans") {
    try {
      const body = await readBody(req);
      const target = resourceTargetOlt(olts, body.oltId);
      const session = activeNmseSession();
      const gridRank = resourceGridRank(session, target);
      const vlans = await session.client.getVlans(session.auth, gridRank);
      const result = await replaceResourceVlans({ oltIp: target.host, gridRank, ...vlans });
      await json(res, 200, { ok: true, ...result, snapshot: await getResourceVlanSnapshot(target.host) });
      return true;
    } catch (error) {
      if (error.status === 401) clearNmseSession();
      await json(res, error.status || 502, { ok: false, error: error.message || "VLAN 同步失败。" });
      return true;
    }
  }
  return false;
}
