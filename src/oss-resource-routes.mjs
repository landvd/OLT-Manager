export async function handleOssResourceRoutes(req, res, url, {
  getOssResourceConfig,
  ossAutoLoginStore,
  remoteSessionState,
  json,
  readBody,
  activeOssNgbSession,
  mergedOnuService,
  getOlts,
  getResourceOltIpMappings,
  saveOssResourceConfig,
  loginOssNgbSession,
  closeOssNgbHistorySession = async () => {},
  invalidateOssNgbHistorySession = async () => {},
  publicOssOlts,
  resourceTargetOlt,
  readHistoricalOpticalForTarget,
  olts = []
} = {}) {
  if (req.method === "GET" && url.pathname === "/api/admin/oss-resource/config") {
    await json(res, 200, {
      ...(await getOssResourceConfig()),
      autoLoginAvailable: ossAutoLoginStore.isAvailable(),
      autoLoginConfigured: await ossAutoLoginStore.configured(),
      loggedIn: Boolean(remoteSessionState.getOssNgbSession())
    });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/oss-resource/diagnose-fields") {
    try {
      const needle = String(url.searchParams.get("needle") || "").trim();
      if (!needle || needle.length > 200) {
        await json(res, 400, { ok: false, error: "字段诊断搜索值必须是 1-200 个字符。" });
        return true;
      }
      const session = activeOssNgbSession();
      const targets = mergedOnuService.selectMergedOnuTargets(await getOlts(), await getResourceOltIpMappings());
      const rows = [];
      const fieldNames = new Set();
      for (const { target, mapping } of targets) {
        const remote = session.olts.find((item) => item.resourceIp === mapping.resourceIp);
        if (!remote?.cuid) continue;
        const result = await session.client.inspectOnuFieldNames(remote.cuid, { needle });
        for (const field of result.fieldNames) fieldNames.add(field);
        for (const match of result.matches) rows.push({ oltIp: target.host, oltId: target.id, ...match });
      }
      await json(res, 200, { ok: true, fieldNames: [...fieldNames].sort(), matches: rows });
    } catch (error) {
      if (error.status === 401) remoteSessionState.clearOssNgbSession();
      await json(res, error.status || 502, { ok: false, error: error.message || "网管二期字段诊断失败。" });
    }
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/oss-resource/config") {
    try {
      const config = await saveOssResourceConfig(await readBody(req));
      await closeOssNgbHistorySession();
      remoteSessionState.clearOssNgbSession();
      await json(res, 200, {
        ok: true,
        ...config,
        autoLoginAvailable: ossAutoLoginStore.isAvailable(),
        autoLoginConfigured: await ossAutoLoginStore.configured(),
        loggedIn: false
      });
    } catch (error) {
      await json(res, error.status || 400, { ok: false, error: error.message || "网管二期配置保存失败。" });
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/oss-resource/login") {
    try {
      const body = await readBody(req);
      await closeOssNgbHistorySession();
      const session = await loginOssNgbSession({
        password: body.password,
        migrationMasterPassword: body.migrationMasterPassword,
        rememberPassword: body.rememberPassword === true,
        autoLogin: body.autoLogin === true
      });
      await json(res, 200, {
        ok: true,
        credentialConfigured: true,
        oltCount: session.olts.length,
        olts: publicOssOlts(session.olts)
      });
    } catch (error) {
      remoteSessionState.clearOssNgbSession();
      await json(res, error.status || 502, { ok: false, error: error.message || "网管二期登录失败。" });
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/oss-resource/logout") {
    await closeOssNgbHistorySession();
    remoteSessionState.clearOssNgbSession();
    await json(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/onus/historical-optical") {
    try {
      const body = await readBody(req);
      const target = resourceTargetOlt(olts, body.oltId);
      const coordinate = {
        chassis: body.chassis,
        board: body.board ?? body.slot,
        pon: body.pon,
        onuId: body.onuId
      };
      const rows = await readHistoricalOpticalForTarget({ target, coordinate, startDate: body.startDate, endDate: body.endDate });
      await json(res, 200, {
        ok: true,
        source: "oss-ngb",
        olt: { id: target.id, name: target.name },
        coordinate,
        startDate: body.startDate,
        endDate: body.endDate,
        rows
      });
    } catch (error) {
      if (error.status === 401) {
        await invalidateOssNgbHistorySession();
        remoteSessionState.clearOssNgbSession();
      }
      await json(res, error.status || 502, { ok: false, error: error.message || "历史光功率读取失败。" });
    }
    return true;
  }
  return false;
}
