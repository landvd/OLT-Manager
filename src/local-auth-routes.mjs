function requireDependency(value, name) {
  if (typeof value !== "function") throw new TypeError(`local auth routes requires ${name}`);
  return value;
}

export async function handleLocalAuthRoutes(req, res, url, { auth, readBody, json }) {
  if (!url.pathname.startsWith("/api/auth/")) return false;
  const read = requireDependency(readBody, "readBody");
  const send = requireDependency(json, "json");

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    const session = await auth.authenticate(req);
    return send(res, 200, {
      ok: session.ok,
      authenticated: session.ok,
      configured: await auth.isConfigured(),
      required: await auth.isEnabled(),
      expiresAt: session.expiresAt || null,
      testMode: auth.isTestBypass
    });
  }
  if (req.method === "GET" && url.pathname === "/api/auth/settings") {
    return send(res, 200, { ok: true, configured: await auth.isConfigured(), required: await auth.isEnabled() });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/settings") {
    const currentRequired = await auth.isEnabled();
    if (currentRequired) {
      const session = await auth.authenticate(req);
      if (!session.ok) {
        res.setHeader("www-authenticate", "Bearer");
        return send(res, 401, { ok: false, code: session.code, error: "请先登录本地管理系统。" });
      }
    }
    try {
      const result = await auth.setEnabled((await read(req)).enabled);
      return send(res, 200, { ok: true, required: result });
    } catch (error) {
      return send(res, Number(error.statusCode) || 400, { ok: false, code: error.code || "AUTH_SETTINGS_FAILED", error: error.message });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    try {
      const result = await auth.setup((await read(req)).password);
      return send(res, 200, { ok: true, token: result.token, expiresAt: result.expiresAt });
    } catch (error) {
      return send(res, Number(error.statusCode) || 400, { ok: false, code: error.code || "AUTH_SETUP_FAILED", error: error.message });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const result = await auth.login((await read(req)).password);
      return send(res, 200, { ok: true, token: result.token, expiresAt: result.expiresAt });
    } catch (error) {
      return send(res, Number(error.statusCode) || 401, { ok: false, code: error.code || "AUTH_LOGIN_FAILED", error: error.message });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    return send(res, 200, await auth.logout(req));
  }
  return send(res, 404, { error: "API not found" });
}
