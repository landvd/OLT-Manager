const REQUIRED_PATHS = new Set([
  "/proxy/api/login",
  "/grid/getGridNode",
  "/resource/getOltList",
  "/onu/getOnuListByGridRank",
  "/olt/getOltSvlanRelationList",
  "/olt/getOltCvlanRelation",
  "/config/ConfigurationManagement"
]);
const ONU_PAGE_SIZE = 20;

function cleanBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("资源管理服务器地址无效。");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("资源管理服务器地址必须是 http 或 https 基地址。");
  }
  return url.toString().replace(/\/$/, "");
}

function apiError(payload, fallback) {
  const header = payload?.header || {};
  if (String(header.opCode || "1") !== "1") return new Error(header.opDesc || header.message || fallback);
  return null;
}

export function parseNmsePonText(value) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return []; }
  }
  if (!source || typeof source !== "object") return [];
  const rows = [];
  for (const [slotKey, slotValue] of Object.entries(source)) {
    const board = String(slotKey).match(/^slot(\d+)$/i)?.[1];
    const ports = Array.isArray(slotValue) ? slotValue[0] : slotValue;
    if (!board || !ports || typeof ports !== "object") continue;
    for (const [pon, svlan] of Object.entries(ports)) {
      const clean = String(svlan ?? "").trim();
      if (/^\d{1,4}$/.test(clean)) rows.push({ board, pon: String(pon), svlan: clean });
    }
  }
  return rows.sort((left, right) => Number(left.board) - Number(right.board) || Number(left.pon) - Number(right.pon));
}

export class NmseClient {
  constructor({ serverUrl, fetchImpl = globalThis.fetch, requestTimeoutMs = 45000, retryDelayMs = 500 } = {}) {
    this.baseUrl = cleanBaseUrl(serverUrl);
    this.fetch = fetchImpl;
    this.cookie = "";
    this.requestTimeoutMs = requestTimeoutMs;
    this.retryDelayMs = retryDelayMs;
  }

  async fetchWithTimeout(url, options, timeoutMessage, timeoutMs = this.requestTimeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(timeoutMessage);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async request(path, { params = {}, body, timeoutMs } = {}) {
    if (!REQUIRED_PATHS.has(path)) throw new Error("资源管理接口不在白名单内。");
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = { accept: "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
    let response;
    try {
      response = await this.fetchWithTimeout(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }, "资源管理服务器请求超时，请稍后重试。", timeoutMs);
    } catch (error) {
      if (/超时/.test(error.message || "")) throw error;
      throw new Error("资源管理服务器连接失败。");
    }
    const cookie = response.headers?.get?.("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    let payload;
    try { payload = await response.json(); } catch { throw new Error("资源管理服务器返回了无效响应。"); }
    if (!response.ok) throw new Error("资源管理服务器请求失败。");
    const error = apiError(payload, `资源管理接口 ${path} 拒绝请求。`);
    if (error) throw error;
    return payload?.body?.data ?? {};
  }

  async requestWithRetry(path, options, { retries = 0, onAttempt } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      onAttempt?.({ attempt, maxAttempts: retries + 1 });
      try {
        return await this.request(path, options);
      } catch (error) {
        lastError = error;
        if (attempt > retries || !/(超时|连接失败)/.test(error.message || "")) throw error;
        if (this.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }
    throw lastError;
  }

  async login(username, password) {
    const loginUrl = new URL(`${this.baseUrl}/proxy/api/login`);
    let response;
    try {
      response = await this.fetchWithTimeout(loginUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ loginname: username, password, client: 1, state: "0", did: "" }) }, "资源管理服务器登录超时，请稍后重试。");
    } catch (error) {
      if (/超时/.test(error.message || "")) throw error;
      throw new Error("资源管理服务器连接失败。");
    }
    const cookie = response.headers?.get?.("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    let payload;
    try { payload = await response.json(); } catch { throw new Error("资源管理服务器返回了无效响应。"); }
    if (!response.ok) throw new Error("资源管理服务器请求失败。");
    const error = apiError(payload, "登录失败：请检查用户名、密码或账号权限。");
    if (error) throw error;
    const token = payload?.header?.token;
    if (!token) throw new Error("登录失败：资源管理服务器未返回会话令牌。");
    const user = payload?.body?.data || {};
    const userType = typeof user.type === "boolean" ? (user.type ? "True" : "False") : (user.type ?? "");
    return { token, phone: user.loginname || username, userId: user.id ?? "", userType };
  }

  sessionParams(auth) {
    return { phone: auth.phone, local: "zh", accessToken: auth.token, userId: auth.userId, userType: auth.userType };
  }

  async discoverOlts(auth) {
    const roots = await this.request("/grid/getGridNode", { params: { locale: "zh", client: 1, did: "", state: "0", loginname: auth.phone, accessToken: auth.token, userId: auth.userId, userType: auth.userType } });
    const olts = [];
    for (const root of roots.gridList || []) {
      const data = await this.request("/resource/getOltList", { params: { ...this.sessionParams(auth), gridRank: root.rank, page: 0, pageSize: 1000, queryStr: "" } });
      for (const olt of data.list || []) if (olt.ip && olt.gridRank) olts.push({ host: String(olt.ip), gridRank: String(olt.gridRank) });
    }
    return olts;
  }

  async prepare(auth) {
    const url = new URL(`${this.baseUrl}/config/ConfigurationManagement`);
    for (const [key, value] of Object.entries(this.sessionParams(auth))) url.searchParams.set(key, String(value));
    try {
      const response = await this.fetchWithTimeout(url, { headers: this.cookie ? { cookie: this.cookie } : {} }, "资源管理会话初始化超时，请稍后重试。");
      const cookie = response.headers?.get?.("set-cookie");
      if (cookie) this.cookie = cookie.split(";")[0];
      if (!response.ok) throw new Error("资源管理会话初始化失败。");
    } catch (error) {
      if (/初始化失败|超时/.test(error.message || "")) throw error;
      throw new Error("资源管理服务器连接失败。");
    }
  }

  async getUsers(auth, gridRank, { onProgress, maxPages } = {}) {
    await this.prepare(auth);
    const first = await this.requestWithRetry(
      "/onu/getOnuListByGridRank",
      { params: { ...this.sessionParams(auth), gridRank, page: 0, pageSize: ONU_PAGE_SIZE, queryStr: "" }, timeoutMs: 120000 },
      {
        retries: 2,
        onAttempt: ({ attempt, maxAttempts }) => onProgress?.({ phase: "fetching-total", total: 0, pages: 0, completedPages: 0, received: 0, workers: 0, attempt, maxAttempts })
      }
    );
    const total = Number(first.TotalCount ?? first.total ?? 0);
    const pages = Math.max(1, Math.ceil(total / ONU_PAGE_SIZE));
    const pageLimit = maxPages ? Math.min(pages, Math.max(1, Number(maxPages))) : pages;
    const pageRows = new Array(pageLimit);
    pageRows[0] = first.list || [];
    const workerCount = Math.min(8, Math.max(1, pageLimit - 1));
    let completedPages = 1;
    let received = pageRows[0].length;
    onProgress?.({ phase: "syncing-pages", total, pages, completedPages, received, workers: workerCount });
    if (pageLimit === 1) return pageRows[0];

    let nextPage = 1;
    const worker = async () => {
      // Keep each concurrent request chain in an independent CookieJar/session.
      const client = new NmseClient({ serverUrl: this.baseUrl, fetchImpl: this.fetch, requestTimeoutMs: this.requestTimeoutMs, retryDelayMs: this.retryDelayMs });
      await client.prepare(auth);
      while (nextPage < pageLimit) {
        const page = nextPage;
        nextPage += 1;
        const data = await client.requestWithRetry(
          "/onu/getOnuListByGridRank",
          { params: { ...client.sessionParams(auth), gridRank, page, pageSize: ONU_PAGE_SIZE, queryStr: "" } },
          { retries: 1 }
        );
        const list = data.list || [];
        pageRows[page] = list;
        completedPages += 1;
        received += list.length;
        onProgress?.({ phase: "syncing-pages", total, pages, completedPages, received, workers: workerCount });
      }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    return pageRows.flat();
  }

  async getVlans(auth, gridRank) {
    await this.prepare(auth);
    const params = { ...this.sessionParams(auth), gridRank, useType: 1 };
    const [outer, inner] = await Promise.all([
      this.request("/olt/getOltSvlanRelationList", { params: { ...params, classification: 2 } }),
      this.request("/olt/getOltCvlanRelation", { params })
    ]);
    return {
      ponVlans: parseNmsePonText(outer.ponText),
      cvlan: { begin: String(inner.beginCVlan || ""), end: String(inner.endCVlan || ""), distributionType: String(inner.distributionType || "") }
    };
  }
}
