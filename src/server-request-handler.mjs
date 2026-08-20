function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`server request handler requires ${name}`);
  return value;
}

export function createServerRequestHandler({ auth, handleAuthRoutes, handleApi, serveStatic, json }) {
  const authRoutes = requireFunction(handleAuthRoutes, "handleAuthRoutes");
  const apiRoutes = requireFunction(handleApi, "handleApi");
  const staticFiles = requireFunction(serveStatic, "serveStatic");
  const sendJson = requireFunction(json, "json");
  if (!auth || typeof auth.authenticate !== "function") throw new TypeError("server request handler requires auth");

  return async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/api/auth/")) {
        return await authRoutes(req, res, url);
      }
      if (url.pathname.startsWith("/api/")) {
        const session = await auth.authenticate(req);
        if (!session.ok) {
          res.setHeader("www-authenticate", "Bearer");
          return sendJson(res, 401, { ok: false, code: session.code, error: "请先登录本地管理系统。" });
        }
        return await apiRoutes(req, res, url);
      }
      return await staticFiles(req, res, url);
    } catch (error) {
      return sendJson(res, Number(error.statusCode) || 500, { error: error.message });
    }
  };
}
