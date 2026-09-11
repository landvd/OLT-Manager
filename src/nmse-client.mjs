import http from "node:http";
import https from "node:https";
import { normalizeBossOperation } from "./nmse-boss-sync.mjs";

const REQUIRED_PATHS = new Set([
  "/proxy/api/login",
  "/grid/getGridNode",
  "/resource/getOltList",
  "/onu/getOnuListByGridRank",
  "/boss/getBossOperation",
  "/onu/getOnuAuthorizePercentByIdentity",
  "/olt/getOltSvlanRelationList",
  "/olt/getOltCvlanRelation",
  "/config/ConfigurationManagement"
]);
// HTML entry pages are kept separate from the JSON API allowlist. The BOSS
// screen establishes the same server-side session state as the real UI.
const REQUIRED_PAGE_PATHS = new Set(["/BOSS/BOSSInstruction"]);
// The现场 NMSE-PON deployment accepts the legacy 20-row page contract. Keep
// the value overridable for synthetic fixtures, but use the known-compatible
// default in production instead of sending a larger request that can hang.
const DEFAULT_ONU_PAGE_SIZE = 20;
const BOSS_TIME_ZONE = "Asia/Shanghai";

function bossCalendarParts(value) {
  if (typeof value === "string") {
    // NMSE's ConversionDate receives a local wall-clock value. Preserve the
    // supplied calendar fields instead of letting Node parse them in the
    // machine timezone.
    const local = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(value.trim());
    if (local) return {
      year: Number(local[1]), month: Number(local[2]), day: Number(local[3]),
      hour: Number(local[4] || 0), minute: Number(local[5] || 0), second: Number(local[6] || 0)
    };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("BOSS 时间无效。");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOSS_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

/** Format the exact non-padded wall-clock value expected by BOSS ConversionDate. */
export function formatBossConversionDate(value) {
  const { year, month, day, hour, minute, second } = bossCalendarParts(value);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

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
  if (String(header.opCode || "1") !== "1") {
    const error = new Error(header.opDesc || header.message || fallback);
    if (/(登录|会话|令牌|token|token|unauthori|forbidden|401|403)/i.test(error.message)) error.status = 401;
    return error;
  }
  return null;
}

function connectionError(message, error) {
  const code = String(error?.cause?.code || error?.code || "").trim();
  return new Error(`${message}${code ? `（${code}）` : ""}。`);
}

function bossTotal(data, page) {
  const raw = data?.TotalCount ?? data?.total ?? data?.totalCount;
  const total = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isInteger(total) || total < 0) throw new Error(`BOSS 第 ${page + 1} 页返回的总数无效。`);
  return total;
}

function bossList(data, page) {
  const list = data?.list ?? data?.rows;
  if (!Array.isArray(list)) throw new Error(`BOSS 第 ${page + 1} 页返回的列表无效。`);
  return list;
}

function bossField(row, names) {
  for (const name of names) {
    const value = String(row?.[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function bossIdempotencyKey(row) {
  const workOrder = bossField(row, ["workOrder", "workOrderNo", "orderNo", "serialNo", "工单号", "工单编号"]);
  const loid = bossField(row, ["loid", "LOID", "loginName", "账号", "逻辑ID", "sn", "serialNumber", "macId", "mac"]).replace(/\s+/g, "").toUpperCase();
  const receivedAt = bossField(row, ["receivedAt", "receiveTime", "acceptTime", "recTime", "createTime", "接收时间", "受理时间"]);
  if (!workOrder || !loid || !receivedAt) throw new Error("BOSS 工单缺少完整幂等字段，已拒绝提交。");
  return `${workOrder}|${loid}|${receivedAt}`;
}

function validateBossDetail(detail, index, operation = "unknown", { namesOnly = false } = {}) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail) || !Object.keys(detail).length) throw new Error(`BOSS 第 ${index + 1} 条详情为空，已拒绝提交。`);
  if (namesOnly) return;
  // A successful cancellation is intentionally allowed to have no ONU
  // coordinates or customer fields: the list row's work-order, LOID and
  // receive time are the stable identity used for the idempotent deletion.
  if (operation === "cancel") return;
  const coordinates = [
    ["ipAddress", "oltIp", "oltIP"], ["shelfNo", "chassis"], ["slotNo", "board"], ["ponNo", "pon"], ["onuNo", "onuId"]
  ];
  if (coordinates.some((names) => !bossField(detail, names))) throw new Error(`BOSS 第 ${index + 1} 条详情缺少完整 ONU 坐标，已拒绝提交。`);
  if (!["username", "userName", "customerName", "usertel", "userPhone", "useraddr", "installationAddress"].some((name) => bossField(detail, [name]))) {
    throw new Error(`BOSS 第 ${index + 1} 条详情缺少用户字段，已拒绝提交。`);
  }
}

function discoveryError(stage, error) {
  const wrapped = new Error(`${stage}失败：${error?.message || "资源管理接口请求失败。"}`);
  if (error?.status) wrapped.status = error.status;
  return wrapped;
}

// Electron 22 embeds Node 16, which does not provide a global fetch.
export function legacyNodeFetch(input, options = {}) {
  const url = input instanceof URL ? input : new URL(input);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    let request;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", abort);
      callback(value);
    };
    const abort = () => request?.destroy(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    request = transport.request(url, { method: options.method || "GET", headers: options.headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", (error) => finish(reject, error));
      response.once("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        finish(resolve, {
          ok: Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 300,
          status: Number(response.statusCode || 0),
          url: url.toString(),
          redirected: false,
          headers: {
            get(name) {
              const value = response.headers[String(name).toLowerCase()];
              return Array.isArray(value) ? value.join(", ") : (value || null);
            }
          },
          json: async () => JSON.parse(text)
        });
      });
    });
    request.once("error", (error) => finish(reject, error));
    if (signal?.aborted) abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
    request.end(options.body);
  });
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
  constructor({ serverUrl, fetchImpl, requestTimeoutMs = 45000, retryDelayMs = 500 } = {}) {
    this.baseUrl = cleanBaseUrl(serverUrl);
    this.fetch = typeof fetchImpl === "function" ? fetchImpl : (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : legacyNodeFetch);
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
      throw connectionError(`资源管理接口 ${path} 连接失败`, error);
    }
    const cookie = response.headers?.get?.("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    if (!response.ok) {
      const error = new Error(`资源管理服务器请求失败（HTTP ${response.status || 0}）。`);
      if ([401, 403].includes(Number(response.status))) error.status = 401;
      if (Number(response.status) === 429 || Number(response.status) >= 500) error.retryable = true;
      if (error.status === 401) this.cookie = "";
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      const error = new Error("资源管理服务器返回了无效响应。");
      const contentType = String(response.headers?.get?.("content-type") || "");
      if (response.redirected === true || /text\/html/i.test(contentType)) {
        error.status = 401;
        this.cookie = "";
      } else {
        error.retryable = true;
      }
      throw error;
    }
    const error = apiError(payload, `资源管理接口 ${path} 拒绝请求。`);
    if (error) { if (error.status === 401) this.cookie = ""; throw error; }
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
        if (attempt > retries || (!error.retryable && !/(超时|连接失败)/.test(error.message || ""))) throw error;
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
      throw connectionError("资源管理服务器登录连接失败", error);
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
    let roots;
    try {
      roots = await this.request("/grid/getGridNode", { params: { locale: "zh", client: 1, did: "", state: "0", loginname: auth.phone, accessToken: auth.token, userId: auth.userId, userType: auth.userType } });
    } catch (error) {
      throw discoveryError("读取资源系统组织树", error);
    }
    const olts = [];
    for (const root of roots.gridList || []) {
      let data;
      try {
        data = await this.request("/resource/getOltList", { params: { ...this.sessionParams(auth), gridRank: root.rank, page: 0, pageSize: 1000, queryStr: "" } });
      } catch (error) {
        throw discoveryError("读取资源系统 OLT 列表", error);
      }
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
      throw connectionError("资源管理会话初始化连接失败", error);
    }
  }

  async prepareBossPage(auth) {
    const path = "/BOSS/BOSSInstruction";
    if (!REQUIRED_PAGE_PATHS.has(path)) throw new Error("资源管理只读页面不在白名单内。");
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries({ accessToken: auth.token, phone: auth.phone, type: auth.userType, id: auth.userId })) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    try {
      const response = await this.fetchWithTimeout(url, { method: "GET", headers: { accept: "text/html", ...(this.cookie ? { cookie: this.cookie } : {}) } }, "资源管理 BOSS 页面初始化超时，请稍后重试。");
      const cookie = response.headers?.get?.("set-cookie");
      if (cookie) this.cookie = cookie.split(";")[0];
      if (!response.ok) {
        const error = new Error("资源管理 BOSS 页面初始化失败。");
        if ([401, 403].includes(Number(response.status))) { this.cookie = ""; error.status = 401; }
        throw error;
      }
    } catch (error) {
      if (/初始化失败|超时/.test(error.message || "")) throw error;
      throw connectionError("资源管理 BOSS 页面初始化连接失败", error);
    }
  }

  async getUsers(auth, gridRank, { onProgress, maxPages, pageSize = DEFAULT_ONU_PAGE_SIZE, maxConcurrentPages = 8 } = {}) {
    const requestedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(500, pageSize) : DEFAULT_ONU_PAGE_SIZE;
    await this.prepare(auth);
    const first = await this.requestWithRetry(
      "/onu/getOnuListByGridRank",
      { params: { ...this.sessionParams(auth), gridRank, page: 0, pageSize: requestedPageSize, queryStr: "" }, timeoutMs: 120000 },
      {
        retries: 2,
        onAttempt: ({ attempt, maxAttempts }) => onProgress?.({ phase: "fetching-total", total: 0, pages: 0, completedPages: 0, received: 0, workers: 0, attempt, maxAttempts })
      }
    );
    const total = Number(first.TotalCount ?? first.total ?? 0);
    const firstList = Array.isArray(first.list) ? first.list : [];
    const pages = Math.max(1, Math.ceil(total / requestedPageSize));
    const pageLimit = maxPages ? Math.min(pages, Math.max(1, Number(maxPages))) : pages;
    const pageRows = new Array(pageLimit);
    pageRows[0] = firstList;
    const workerLimit = Number.isInteger(maxConcurrentPages) && maxConcurrentPages > 0
      ? Math.min(8, maxConcurrentPages)
      : 8;
    const workerCount = Math.min(workerLimit, Math.max(1, pageLimit - 1));
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
          { params: { ...client.sessionParams(auth), gridRank, page, pageSize: requestedPageSize, queryStr: "" } },
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

  async getBossOperations(auth, { windowStart, windowEnd, onProgress, pageSize = DEFAULT_ONU_PAGE_SIZE, projection = "changes" } = {}) {
    await this.prepareBossPage(auth);
    const namesOnly = projection === "names";
    if (!namesOnly && projection !== "changes") throw new TypeError("BOSS 读取投影类型无效。");
    const requestedPageSize = Math.max(1, Math.min(20, Number(pageSize) || DEFAULT_ONU_PAGE_SIZE));
    const params = {
      locale: "zh", phone: auth.phone, sTime: formatBossConversionDate(windowStart), eTime: formatBossConversionDate(windowEnd),
      opResult: "1", serviceID: "0", page: 0, pageSize: requestedPageSize, queryStr: "厚街镇", sortColumn: "recTime", order: "asc"
    };
    const first = await this.requestWithRetry("/boss/getBossOperation", { params }, { retries: 2 });
    const total = bossTotal(first, 0);
    const firstList = bossList(first, 0);
    const pages = Math.max(1, Math.ceil(total / requestedPageSize));
    const pageRows = new Array(pages);
    const validatePage = (data, page) => {
      const pageTotal = bossTotal(data, page);
      if (pageTotal !== total) throw new Error("BOSS 分页总数发生变化，已拒绝提交。");
      const list = bossList(data, page);
      const expected = page === pages - 1 ? total - page * requestedPageSize : requestedPageSize;
      if (list.length !== expected) throw new Error(`BOSS 第 ${page + 1} 页条数不完整，已拒绝提交。`);
      return list;
    };
    pageRows[0] = validatePage(first, 0);
    let received = pageRows[0].length;
    onProgress?.({ phase: "boss-pages", total, pages, completedPages: 1, received, details: 0, workers: Math.min(4, Math.max(1, pages - 1)) });
    let nextPage = 1;
    const worker = async () => {
      while (nextPage < pages) {
        const page = nextPage;
        nextPage += 1;
        const data = await this.requestWithRetry("/boss/getBossOperation", { params: { ...params, page } }, { retries: 2 });
        pageRows[page] = validatePage(data, page);
        received += pageRows[page].length;
        onProgress?.({ phase: "boss-pages", total, pages, completedPages: pageRows.filter(Boolean).length, received, details: 0, workers: Math.min(4, Math.max(1, pages - 1)) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, pages - 1)) }, worker));
    if (received !== total) throw new Error("BOSS 分页最终条数与总数不一致，已拒绝提交。");
    const all = pageRows.flat();
    const keys = new Set();
    for (const row of all) {
      const status = bossField(row, ["opResult", "processStatus", "handleStatus", "处理状态"]);
      const operation = bossField(row, ["serviceName", "operation", "operationType", "bossServiceName", "操作类型", "业务类型"]);
      if (!status || (!namesOnly && !operation)) {
        throw new Error("BOSS 工单缺少业务类型或处理状态，已拒绝提交。");
      }
      try {
        const key = bossIdempotencyKey(row);
        if (keys.has(key)) throw new Error("BOSS 分页包含重复幂等记录，已拒绝提交。");
        keys.add(key);
      } catch (error) {
        if (!namesOnly) throw error;
      }
    }
    const detailed = new Array(all.length);
    let nextDetail = 0;
    let completedDetails = 0;
    const detailWorker = async () => {
      while (nextDetail < all.length) {
        const index = nextDetail;
        nextDetail += 1;
        const row = all[index];
        const authType = String(row.authType ?? row.AUTH_TYPE ?? "").toLowerCase();
        const identity = authType.includes("mac") ? (row.macId ?? row.mac ?? row.MAC)
          : authType.includes("sn") || authType.includes("serial") ? (row.sn ?? row.serialNo ?? row.SN)
            : (row.loid ?? row.LOIDs ?? row.LOId ?? row.loginName);
        if (identity === undefined || identity === null || String(identity).trim() === "") {
          if (!namesOnly) throw new Error("BOSS工单缺少可查询的身份标识，已拒绝提交。");
          detailed[index] = row;
          completedDetails += 1;
          onProgress?.({ phase: "boss-details", total, pages, completedPages: pages, received: all.length, details: completedDetails, workers: Math.min(4, Math.max(1, all.length)) });
          continue;
        }
        const detail = await this.requestWithRetry("/onu/getOnuAuthorizePercentByIdentity", { params: {
          locale: "zh", phone: auth.phone, identity: String(identity), serialNo: String(row.serialNo ?? row.sn ?? "")
        } }, { retries: 2 });
        const operation = normalizeBossOperation(bossField(row, ["serviceName", "operation", "operationType", "bossServiceName", "操作类型", "业务类型"]));
        validateBossDetail(detail, index, operation, { namesOnly });
        // The detail endpoint contains a semicolon-separated progress history
        // in `recTime`; it is not the operation's list timestamp. Keep the
        // list's idempotency and operation fields authoritative while adding
        // the coordinate/customer fields returned by the detail request.
        const merged = { ...detail, ...row };
        for (const [canonical, names] of [
          ["serialNo", ["serialNo", "workOrder", "workOrderNo", "orderNo", "工单号", "工单编号"]],
          ["serviceName", ["serviceName", "operation", "operationType", "bossServiceName", "操作类型", "业务类型"]],
          ["opResult", ["opResult", "processStatus", "handleStatus", "处理状态"]],
          ["authType", ["authType", "认证类型"]],
          ["recTime", ["recTime", "receivedAt", "receiveTime", "acceptTime", "createTime", "接收时间", "受理时间"]],
          ["loid", ["loid", "LOID", "loginName", "账号", "逻辑ID"]]
        ]) {
          if (!bossField(row, names) && bossField(detail, names)) merged[canonical] = bossField(detail, names);
        }
        detailed[index] = merged;
        completedDetails += 1;
        onProgress?.({ phase: "boss-details", total, pages, completedPages: pages, received: all.length, details: completedDetails, workers: Math.min(4, Math.max(1, all.length)) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, all.length)) }, detailWorker));
    const finalKeys = new Set();
    for (const [index, row] of detailed.entries()) {
      const workOrder = bossField(row, ["workOrder", "workOrderNo", "orderNo", "serialNo", "工单号", "工单编号"]);
      const loid = bossField(row, ["loid", "LOID", "loginName", "账号", "逻辑ID"])
        .replace(/\s+/g, "").toUpperCase();
      const receivedAt = bossField(row, ["receivedAt", "receiveTime", "acceptTime", "recTime", "createTime", "接收时间", "受理时间"]);
      // Name-history projection records incomplete rows as skipped so the
      // operator can see that the upstream result was not fully keyable.
      if (namesOnly && (!workOrder || !loid || !receivedAt)) continue;
      if (!workOrder || !loid || !receivedAt) throw new Error(`BOSS 第 ${index + 1} 条详情缺少最终幂等字段，已拒绝提交。`);
      const key = `${workOrder}|${loid}|${receivedAt}`;
      if (finalKeys.has(key)) throw new Error("BOSS 详情合并后包含重复最终幂等记录，已拒绝提交。");
      finalKeys.add(key);
    }
    return detailed;
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
