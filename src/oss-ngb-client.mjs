import http from "node:http";
import https from "node:https";
import vm from "node:vm";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const DWR_METHODS = new Set([
  "TreePanelAction.loadData",
  "GridViewAction.getGridPageInfo",
  "GridViewAction.getGridData"
]);
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;

export function normalizeOssBaseUrl(value, label = "服务器地址") {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(`${label}无效。`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${label}必须是 http 或 https 基地址。`);
  }
  return url.toString().replace(/\/$/, "");
}

function encodeDwrString(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "%20");
}

export function buildDwrRequestBody({ page, scriptName, methodName, args = [], batchId = 0, httpSessionId = "", scriptSessionId } = {}) {
  if (!DWR_METHODS.has(`${scriptName}.${methodName}`)) throw new Error("OSS DWR 接口不在只读白名单内。");
  const lines = [
    "callCount=1",
    `page=${page}`,
    `httpSessionId=${encodeDwrString(httpSessionId || "")}`,
    `scriptSessionId=${scriptSessionId || randomBytes(18).toString("hex").toUpperCase()}`,
    `c0-scriptName=${scriptName}`,
    `c0-methodName=${methodName}`,
    "c0-id=0"
  ];
  const references = new WeakMap();
  let nextReference = 1;

  const serializeInline = (value) => {
    if (value === null || value === undefined) return "null:null";
    if (typeof value === "boolean") return `boolean:${value}`;
    if (typeof value === "number") return `number:${Number.isFinite(value) ? value : 0}`;
    if (typeof value === "string") return `string:${encodeDwrString(value)}`;
    if (value instanceof Date) return `Date:${value.getTime()}`;
    if (Array.isArray(value)) return `Array:[${value.map((item) => reference(item)).join(",")}]`;
    if (typeof value === "object") {
      const fields = Object.entries(value).map(([key, item]) => `${key}:${reference(item)}`);
      return `Object_Object:{${fields.join(", ")}}`;
    }
    throw new Error("OSS DWR 参数包含不支持的类型。");
  };

  const reference = (value) => {
    if (value && typeof value === "object" && references.has(value)) return `reference:c0-e${references.get(value)}`;
    const id = nextReference;
    nextReference += 1;
    if (value && typeof value === "object") references.set(value, id);
    const encoded = serializeInline(value);
    lines.push(`c0-e${id}=${encoded}`);
    return `reference:c0-e${id}`;
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    lines.push(`c0-param${index}=${value && typeof value === "object" ? serializeInline(value) : serializeInline(value)}`);
  }
  lines.push(`batchId=${Number(batchId) || 0}`);
  return `${lines.join("\n")}\n`;
}

export function parseDwrReply(text) {
  const source = String(text || "");
  const hasCallback = source.includes("_remoteHandleCallback");
  const hasException = source.includes("_remoteHandleException") || source.includes("_remoteHandleBatchException");
  if (!hasCallback && !hasException) {
    const normalized = source.replace(/^\uFEFF/, "").trimStart().toLowerCase();
    if (normalized.startsWith("<!doctype html") || normalized.startsWith("<html") || normalized.includes("/login")) {
      const error = new Error("网管二期会话未建立或已跳回登录页，请重新登录。");
      error.status = 401;
      throw error;
    }
    throw new Error("OSS DWR 返回了无效响应。");
  }
  let value;
  let remoteError;
  const sandbox = {
    dwr: {
      engine: {
        _remoteHandleCallback(_batchId, _callId, result) { value = result; },
        _remoteHandleException(_batchId, _callId, error) { remoteError = error || true; },
        _remoteHandleBatchException(error) { remoteError = error || true; }
      }
    }
  };
  const executable = source.replace(/^\s*throw\s+['"]allowScriptTagRemoting is false\.['"];?\s*/i, "");
  try {
    vm.runInNewContext(executable, sandbox, {
      timeout: 1_000,
      contextCodeGeneration: { strings: false, wasm: false }
    });
  } catch {
    throw new Error("OSS DWR 响应解析失败。");
  }
  if (remoteError) {
    const rawMessage = typeof remoteError === "object"
      ? remoteError.message || remoteError.javaClassName || remoteError.name
      : "";
    const safeMessage = safeUpstreamError(rawMessage, "");
    throw new Error(`OSS DWR 拒绝了只读查询${safeMessage ? `：${safeMessage}` : "。"}`);
  }
  try {
    const clone = (item, seen = new WeakMap()) => {
      if (item === null || typeof item !== "object") return item;
      if (seen.has(item)) return seen.get(item);
      if (Object.prototype.toString.call(item) === "[object Date]") return new Date(Number(item));
      const output = Array.isArray(item) ? [] : {};
      seen.set(item, output);
      for (const [key, child] of Object.entries(item)) output[key] = clone(child, seen);
      return output;
    };
    return clone(value);
  } catch {
    throw new Error("OSS DWR 响应包含不支持的数据。");
  }
}

function requestOnce(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let size = 0;
    const request = transport.request(target, {
      method: options.method || "GET",
      headers: {
        "user-agent": "OLT-Manager OSS read-only client",
        ...(options.headers || {})
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("OSS 响应超过安全上限。"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve({
        status: Number(response.statusCode || 0),
        headers: response.headers,
        text: Buffer.concat(chunks).toString("utf8"),
        url: target.toString()
      }));
    });
    request.setTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS, () => request.destroy(new Error("OSS 请求超时。")));
    request.once("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function responseRows(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.list) ? value.list : [];
}

function responseTotal(value, fallback = 0) {
  const candidate = value?.totalCount ?? value?.total ?? value?.count ?? value;
  const total = Number(candidate);
  return Number.isFinite(total) && total >= 0 ? total : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function projectTreeRequestNode(node = {}) {
  return {
    cuid: node.cuid ?? null,
    text: node.text ?? null,
    leaf: node.leaf ?? null,
    parentTreeNode: node.parentTreeNode ?? null,
    checked: node.checked ?? null,
    isRoot: node.isRoot ?? false,
    boName: node.boName ?? null,
    params: node.params ?? null,
    treeParams: node.treeParams ?? null,
    treeName: node.treeName ?? null,
    system: node.system ?? null,
    queryParams: node.queryParams ?? null
  };
}

function safeUpstreamError(value, fallback) {
  const message = cleanText(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[地址已隐藏]")
    .replace(/\b(access[-_]?token|token|uid|cookie|password|secret|jsessionid|authorization)\s*[=:]\s*\S+/gi, "$1=[已隐藏]")
    .slice(0, 180);
  return message || fallback;
}

function dwrResponseKind(text) {
  const normalized = String(text || "").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (!normalized) return "空响应";
  if (normalized.startsWith("<!doctype html") || normalized.startsWith("<html") || normalized.includes("/login")) return "登录页或 HTML";
  if (normalized.startsWith("{")) return "JSON 错误响应";
  if (normalized.startsWith("throw ")) return "DWR 异常响应";
  return "非 DWR 回调文本";
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeReportTime(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function coordinateFromRow(row) {
  for (const value of [row?.ONUDEVICEINDEX, row?.DEVNAME, row?.PON_NAME, row?.NAME]) {
    const match = cleanText(value).match(/(?:^|\s)(\d+)\/(\d+)\/(\d+):(\d+)(?:\s|$)/);
    if (match) return { chassis: match[1], board: match[2], pon: match[3], onuId: match[4] };
  }
  const board = cleanText(row?.OLTCARDIDX ?? row?.BOARDIDX);
  const pon = cleanText(row?.OLTPORTIDX ?? row?.PONIDX);
  const onuId = cleanText(row?.ONUIDX ?? row?.ONUINDEX);
  if (board && pon && onuId) return { chassis: "1", board, pon, onuId };
  return null;
}

function firstText(row, fields) {
  for (const field of fields) {
    const value = cleanText(row?.[field]);
    if (value) return value;
  }
  return "";
}

function deviceNumberFromRow(row) {
  const explicit = firstText(row, [
    "DEVICE_NO", "DEV_NO", "DEVNO", "DEVICE_NUMBER", "DEVICENUMBER", "DEVICEID", "DEVICE_ID",
    "DEVICE_CODE", "DEVICECODE", "DEV_CODE", "DEV_ID", "ONU_DEVICE_NO", "ONUDEVICE_NO",
    "ONUDEVICENO", "ONU_DEVICE_NUMBER", "ONU_NUMBER", "ONU_NO", "ONUNO", "STB_SN"
  ]);
  if (explicit) return explicit;
  for (const [key, value] of Object.entries(row || {})) {
    const normalized = key.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!/(?:DEVICE|DEV|ONU)(?:DEVICE)?(?:NUMBER|NO|ID|CODE)$/.test(normalized)) continue;
    if (/(?:CUID|FDN|INDEX|TYPE|NAME|STATUS)/.test(normalized)) continue;
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function diagnosticFieldName(value) {
  const field = cleanText(value);
  if (!field || /(?:password|passwd|secret|token|cookie|session|authorization|credential|cuid|fdn)/i.test(field)) return "";
  return field.slice(0, 80);
}

function onuListQueryData(oltCuid) {
  const preid = { alias: "D", key: "PREID", relation: "=", type: "string", value: cleanText(oltCuid) };
  return {
    boName: "OnuGridBO",
    exportBoName: "BoGridExportBO",
    cfgParams: { tplName: "res.logic.pon.olt.grid.OnuList" },
    urlParams: { preid },
    queryParams: { preid },
    extParams: {}
  };
}

export function normalizeOssOnuRow(row = {}) {
  const coordinate = coordinateFromRow(row);
  if (!coordinate) {
    const error = new Error("网管二期 ONU 列表包含无法解析的槽/板卡/PON/ID。");
    error.status = 502;
    throw error;
  }
  const onuIndex = `${coordinate.chassis}/${coordinate.board}/${coordinate.pon}:${coordinate.onuId}`;
  return {
    onuIndex,
    chassis: coordinate.chassis,
    board: coordinate.board,
    pon: coordinate.pon,
    onuId: coordinate.onuId,
    deviceName: firstText(row, ["DEVNAME", "NAME", "PON_NAME"]),
    deviceNumber: deviceNumberFromRow(row),
    loid: firstText(row, ["LOID"]),
    mac: firstText(row, ["ONUMACADDRESS", "MAC", "MACADDRESS"]),
    serial: firstText(row, ["SN", "SERIAL", "SERIALNUMBER", "ONT_SN"]),
    username: firstText(row, ["USER_NAME", "USERNAME", "CUSTOMER_NAME", "CUSTOMERNAME", "CUSTNAME", "FULL_NAME", "ONUNAME", "USER"]),
    userPhone: firstText(row, ["USER_PHONE", "PHONE", "TEL", "MOBILE"]),
    installationAddress: firstText(row, ["INSTALLATION_ADDRESS", "USER_ADDRESS", "ADDRESS", "WHLADDR"]),
    deviceType: firstText(row, ["DEVICE_TYPE", "TYPE"]),
    ponType: firstText(row, ["PON_TYPE"]),
    phase: firstText(row, ["PHASE", "STATUS", "STATE", "ONU_STATUS"]),
    rxPower: firstText(row, ["RX_POWER", "RX_OPTICAL", "RXOPTICAL"]),
    distance: firstText(row, ["DISTANCE", "ONU_DISTANCE"])
  };
}

function normalizeCoordinate(input = {}) {
  const coordinate = {
    chassis: cleanText(input.chassis || "1"),
    board: cleanText(input.board ?? input.slot),
    pon: cleanText(input.pon),
    onuId: cleanText(input.onuId)
  };
  if (Object.values(coordinate).some((value) => !/^\d+$/.test(value))) {
    const error = new Error("ONU 坐标必须是数字槽/板卡/PON/ID。");
    error.status = 400;
    throw error;
  }
  return coordinate;
}

function normalizeDate(value, label) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00`))) {
    const error = new Error(`${label}无效。`);
    error.status = 400;
    throw error;
  }
  return text;
}

export class OssNgbClient {
  constructor({ authBaseUrl, ngbBaseUrl, requestImpl = requestOnce } = {}) {
    this.authBaseUrl = normalizeOssBaseUrl(authBaseUrl, "OSS 认证地址");
    this.ngbBaseUrl = normalizeOssBaseUrl(ngbBaseUrl, "网管二期地址");
    this.requestImpl = requestImpl;
    this.cookies = new Map();
    this.batchId = 0;
    this.scriptSessionId = randomBytes(18).toString("hex").toUpperCase().slice(0, 35);
    this.ngbPageVersion = "";
  }

  cookieHeader(origin) {
    return [...(this.cookies.get(origin)?.values() || [])].join("; ");
  }

  captureCookies(origin, headers = {}) {
    const raw = headers["set-cookie"] || headers["Set-Cookie"] || [];
    const values = Array.isArray(raw) ? raw : [raw];
    if (!values.filter(Boolean).length) return;
    const jar = this.cookies.get(origin) || new Map();
    for (const value of values) {
      const pair = String(value).split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) jar.set(pair.slice(0, separator), pair);
    }
    this.cookies.set(origin, jar);
  }

  rememberNgbSessionUrl(url) {
    if (!url) return;
    try {
      const target = new URL(url);
      if (target.origin !== this.ngbBaseUrl) return;
      const match = target.pathname.match(/^\/ngb\/;jsessionid=([^/;?]+)/i);
      if (!match) return;
      const sessionId = decodeURIComponent(match[1]);
      const jar = this.cookies.get(target.origin) || new Map();
      jar.set("JSESSIONID", `JSESSIONID=${sessionId}`);
      this.cookies.set(target.origin, jar);
    } catch {
      // Ignore malformed redirect metadata; normal URL validation handles it.
    }
  }

  extractPageVersion(text) {
    const match = String(text || "").match(/(?:[?&]_version=|["']_version["']\s*[:=]\s*["']?)(\d{10,})/i);
    return match?.[1] || "";
  }

  async initializeDwr(page) {
    const response = await this.#requestUrl(`${this.ngbBaseUrl}/ngb/dwr/engine.js`, {
      headers: {
        accept: "text/javascript, */*; q=0.01",
        referer: `${this.ngbBaseUrl}${page}`
      }
    });
    if (response.status < 200 || response.status >= 300) throw new Error("网管二期 DWR 会话初始化失败。");
    const originalSession = String(response.text || "").match(/(?:_origScriptSessionId|_scriptSessionId)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (originalSession) this.scriptSessionId = `${originalSession}${Math.floor(Math.random() * 1000)}`;
  }

  async #requestUrl(url, options = {}) {
    let target = new URL(url);
    let method = options.method || "GET";
    let body = options.body;
    const redirectOrigin = target.origin;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const headers = { ...(options.headers || {}) };
      const cookie = this.cookieHeader(target.origin);
      if (cookie) headers.cookie = cookie;
      const response = await this.requestImpl(target, { ...options, method, body, headers });
      this.captureCookies(target.origin, response.headers);
      this.rememberNgbSessionUrl(response.url || target.toString());
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers?.location;
      if (!location) return response;
      const nextTarget = new URL(location, target);
      if (nextTarget.origin !== redirectOrigin) {
        const error = new Error("OSS/NGB 登录跳转必须保持在原认证服务器内。");
        error.status = 502;
        throw error;
      }
      this.rememberNgbSessionUrl(nextTarget.toString());
      target = nextTarget;
      if ([301, 302, 303].includes(response.status)) {
        method = "GET";
        body = undefined;
      }
    }
    throw new Error("OSS 登录跳转次数过多。");
  }

  async #jsonRequest(baseUrl, path, { method = "GET", body } = {}) {
    const response = await this.#requestUrl(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "access-app-code": "ids-order",
        ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload;
    try { payload = JSON.parse(response.text); } catch { throw new Error("OSS 认证服务返回了无效响应。"); }
    if (response.status < 200 || response.status >= 300 || Number(payload?.statusCode || 200) !== 200 || payload?.status === "error") {
      throw new Error(safeUpstreamError(payload?.message || payload?.error, "OSS 认证请求失败。"));
    }
    return payload?.data ?? {};
  }

  async dwrCall(scriptName, methodName, args, page) {
    if (!DWR_METHODS.has(`${scriptName}.${methodName}`)) throw new Error("OSS DWR 接口不在只读白名单内。");
    const requestBatchId = this.batchId;
    const queryText = cleanText(args?.[1]?.params?.q);
    const body = buildDwrRequestBody({
      page,
      scriptName,
      methodName,
      args,
      batchId: this.batchId,
      scriptSessionId: this.scriptSessionId
    });
    this.batchId += 1;
    const response = await this.#requestUrl(`${this.ngbBaseUrl}/ngb/dwr/call/plaincall/${scriptName}.${methodName}.dwr`, {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "content-length": String(Buffer.byteLength(body, "utf8")),
        accept: "text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        origin: this.ngbBaseUrl,
        referer: `${this.ngbBaseUrl}${page}`
      },
      body
    });
    if (response.status === 401 || response.status === 403) {
      const error = new Error("网管二期会话已失效，请重新登录。");
      error.status = 401;
      throw error;
    }
    if (response.status < 200 || response.status >= 300) throw new Error("网管二期只读接口请求失败。");
    try {
      return parseDwrReply(response.text);
    } catch (error) {
      if (error.status === 401) throw error;
      const detail = `阶段 ${scriptName}.${methodName}，batch ${requestBatchId}，q=${queryText || "空"}，状态码 ${response.status}，响应类型 ${dwrResponseKind(response.text)}，长度 ${Buffer.byteLength(response.text, "utf8")} 字节`;
      const diagnostic = new Error(`${error.message}（${detail}）`);
      diagnostic.status = error.status;
      throw diagnostic;
    }
  }

  async login({ username, password, organizationName, roomName } = {}) {
    const cleanUsername = cleanText(username);
    const cleanPassword = String(password || "");
    if (!cleanUsername || !cleanPassword) {
      const error = new Error("OSS 用户名和本次登录密码不能为空。");
      error.status = 400;
      throw error;
    }
    const verifyCodeId = randomUUID();
    const loginForm = {
      username: cleanUsername,
      password: createHash("md5").update(cleanPassword).digest("hex"),
      verifyCode: "",
      verifyCodeId
    };
    const check = await this.#jsonRequest(this.authBaseUrl, "/ids.admin.boot/api/admin/user/loginCheck", { method: "POST", body: loginForm });
    const candidates = check.orgList || check.dbList || [];
    let selected = candidates.length === 1 ? candidates[0] : candidates.find((item) => Object.values(item || {}).some((value) => cleanText(value) === cleanText(organizationName)));
    if (candidates.length > 1 && !selected) {
      const error = new Error("OSS 账号关联多个登录部门，当前配置无法唯一确定登录范围。");
      error.status = 409;
      throw error;
    }
    selected ||= {};
    const exts = {
      RELATED_ORG_CUID: selected.RELATED_ORG_CUID,
      N_RELATED_ORG_CUID: selected.N_RELATED_ORG_CUID,
      AREAID: selected.AREAID,
      N_AREAID: selected.N_AREAID,
      dbName: selected.DB_NAME,
      dbCuid: selected.DB_CUID
    };
    const auth = await this.#jsonRequest(this.authBaseUrl, "/ids.admin.boot/api/admin/user/login", {
      method: "POST",
      body: { ...loginForm, exts }
    });
    if (!auth.uid || !auth.token) throw new Error("OSS 登录成功但未返回有效会话。");
    const transfer = new URL(`${this.ngbBaseUrl}/ngb/home/transfer.do`);
    transfer.searchParams.set("uid", auth.uid);
    transfer.searchParams.set("token", auth.token);
    const transferred = await this.#requestUrl(transfer);
    if (transferred.status < 200 || transferred.status >= 400) throw new Error("网管二期会话建立失败。");
    if (transferred.url && !transferred.url.startsWith(`${this.ngbBaseUrl}/ngb/`)) {
      const error = new Error("网管二期认证跳转未建立会话，请检查认证地址和网管二期地址。");
      error.status = 401;
      throw error;
    }
    const pageVersion = String(Date.now());
    await this.#requestUrl(`${this.ngbBaseUrl}/ngb/FrameAction/index.do?_version=${pageVersion}`);
    const landing = await this.#requestUrl(`${this.ngbBaseUrl}/ngb/modules/res/dev/devconfig/devconfig.jsp?_version=${pageVersion}`);
    if (landing.url && !landing.url.startsWith(`${this.ngbBaseUrl}/ngb/`)) {
      const error = new Error("网管二期会话未建立或已跳回登录页，请重新登录。");
      error.status = 401;
      throw error;
    }
    let landingPageVersion = "";
    try {
      landingPageVersion = new URL(landing.url || "").searchParams.get("_version") || "";
    } catch {
      landingPageVersion = "";
    }
    this.ngbPageVersion = landingPageVersion || this.extractPageVersion(landing.text) || pageVersion;
    await this.initializeDwr(`/ngb/modules/res/dev/devconfig/devconfig.jsp?_version=${this.ngbPageVersion}`);
    const olts = await this.discoverOlts({ username: cleanUsername, organizationName, roomName });
    return { username: cleanUsername, organizationName: cleanText(organizationName), roomName: cleanText(roomName), olts };
  }

  async discoverOlts({ username, organizationName, roomName }) {
    const pageVersion = this.ngbPageVersion || String(Date.now());
    const page = `/ngb/modules/res/dev/devconfig/devconfig.jsp?_version=${pageVersion}`;
    const rootVariants = [
      {
        cuid: null,
        text: null,
        leaf: null,
        parentTreeNode: null,
        checked: null,
        isRoot: true,
        boName: "ResNavTopoTreeBO",
        params: { templateIds: "d_lv1" },
        treeParams: null,
        treeName: "res.devconfig.DevNavTree",
        system: null,
        queryParams: null
      },
      {
        cuid: "",
        text: "",
        leaf: false,
        parentTreeNode: null,
        checked: false,
        isRoot: true,
        boName: "ResNavTopoTreeBO",
        params: { templateIds: "d_lv1", q: null },
        treeParams: null,
        treeName: "res.devconfig.DevNavTree",
        system: null,
        queryParams: null
      },
      {
        cuid: null,
        text: null,
        parentTreeNode: null,
        boName: "ResNavTopoTreeBO",
        params: { templateIds: "d_lv1" },
        treeParams: null,
        treeName: "res.devconfig.DevNavTree",
        queryParams: null
      }
    ];
    const findTreeNode = async (targetText, startNode, { root = false } = {}) => {
      const queue = [startNode];
      const visited = new Set();
      const matches = [];
      let inspected = 0;
      let loadRoot = root;
      while (queue.length && inspected < 500) {
        const parent = queue.shift();
        const parentKey = `${cleanText(parent?.cuid)}\u0000${cleanText(parent?.text)}`;
        if (visited.has(parentKey)) continue;
        visited.add(parentKey);
        inspected += 1;
        let children;
        if (loadRoot) {
          loadRoot = false;
          let lastError;
          for (const rootNode of rootVariants) {
            try {
              children = responseRows(await this.dwrCall("TreePanelAction", "loadData", [false, rootNode], page));
              break;
            } catch (error) {
              lastError = error;
              if (error?.status === 401 || !/NullPointerException/i.test(error?.message || "")) throw error;
            }
          }
          if (!children) throw lastError || new Error("网管二期组织树根节点读取失败。");
        } else {
          children = responseRows(await this.dwrCall("TreePanelAction", "loadData", [false, projectTreeRequestNode(parent)], page));
        }
        matches.push(...children.filter((item) => cleanText(item?.text) === cleanText(targetText)));
        if (matches.length > 1) {
          const error = new Error(`网管二期组织树中“${cleanText(targetText)}”存在多个同名节点，请缩小配置范围。`);
          error.status = 409;
          throw error;
        }
        for (const child of children) {
          if (!child?.leaf && cleanText(child?.text)) queue.push(child);
        }
      }
      return matches[0] || null;
    };

    const targetOrg = await findTreeNode(organizationName, rootVariants[0], { root: true });
    if (!targetOrg?.cuid) throw new Error(`网管二期组织树中未找到“${cleanText(organizationName)}”。`);
    let targetRoom = null;
    if (cleanText(roomName)) {
      targetRoom = await findTreeNode(roomName, targetOrg);
      if (!targetRoom?.cuid) throw new Error(`网管二期组织树中未找到“${cleanText(roomName)}”。`);
    }

    const roomFilter = targetRoom?.cuid ? {
      key: "RELATED_ROOM_CUID",
      relation: "=",
      alias: "T0",
      value: cleanText(targetRoom.cuid),
      type: "string"
    } : null;
    const organizationFilter = roomFilter ? null : {
      key: "RELATED_ORG_CUID",
      type: "append",
      alias: "ROOM",
      value: `ROOM.RELATED_ORG_CUID LIKE '${targetOrg.cuid}%'`
    };
    const data = {
      cfgParams: {
        tplName: "res.logic.RES_DEV.OLT",
        createFormTplName: "res.logic.RES_DEV.OLT_cust-create",
        updateFormTplName: "res.logic.RES_DEV.OLT_cust-update",
        baseParams: roomFilter
          ? { RELATED_ROOM_CUID: cleanText(targetRoom.cuid) }
          : { RELATED_ORG_CUID: cleanText(targetOrg.cuid) }
      },
      boName: "XmlMvGridBO",
      urlParams: {
        PRV_DEPARTMENT: organizationFilter,
        RELATED_ROOM_CUID: roomFilter,
        CUSTOMER: null,
        SERVICE: null,
        CUSTOMER_GROUP: null,
        DOMAIN: null
      },
      queryParams: roomFilter ? { DOMAIN: roomFilter } : { PRV_DEPARTMENT: organizationFilter },
      extParams: {}
    };
    const rows = await this.readGridRows(page, data, {
      pageSize: 100,
      maxRows: 5_000,
      projectRow: (row) => ({
        resourceIp: cleanText(row?.IP),
        cuid: cleanText(row?.CUID),
        roomName: cleanText(targetRoom?.text || roomName)
      })
    });
    return rows.filter((row) => row.resourceIp && row.cuid && (!roomName || [cleanText(roomName), cleanText(targetRoom?.cuid), cleanText(targetRoom?.text)].includes(row.roomName)));
  }

  async readGridRows(page, data, { pageSize = 100, maxRows = 10_000, projectRow = (row) => row, stopWhen } = {}) {
    const firstPage = { count: true, start: 0, limit: pageSize, totalNum: pageSize };
    const info = await this.dwrCall("GridViewAction", "getGridPageInfo", [false, firstPage, data], page);
    const total = Math.min(maxRows, responseTotal(info, pageSize));
    const rows = [];
    for (let start = 0; start < Math.max(total, 1); start += pageSize) {
      const value = await this.dwrCall("GridViewAction", "getGridData", [false, { count: true, start, limit: pageSize, totalNum: pageSize }, data], page);
      for (const row of responseRows(value)) {
        const projected = projectRow(row);
        if (projected !== undefined) rows.push(projected);
        if (stopWhen?.(row, projected)) return rows;
      }
      if (!responseRows(value).length || rows.length >= total) break;
    }
    return rows;
  }

  async readOnuInventory(oltCuid, { maxRows = 10_000, pageSize = 500 } = {}) {
    const targetCuid = cleanText(oltCuid);
    if (!targetCuid) {
      const error = new Error("网管二期 ONU 全量读取缺少 OLT 标识。");
      error.status = 400;
      throw error;
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      const error = new Error("网管二期 ONU 分页大小必须是 1-500 的整数。");
      error.status = 400;
      throw error;
    }
    const page = "/ngb/ResDevAction/config.do";
    const detail = new URL(`${this.ngbBaseUrl}${page}`);
    detail.searchParams.set("CUID", targetCuid);
    await this.#requestUrl(detail);

    const rows = await this.readGridRows(page, onuListQueryData(targetCuid), {
      pageSize,
      maxRows,
      projectRow: normalizeOssOnuRow
    });
    const unique = new Map();
    for (const row of rows) {
      const existing = unique.get(row.onuIndex);
      if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
        const error = new Error(`网管二期 ONU 列表包含重复坐标：${row.onuIndex}。`);
        error.status = 502;
        throw error;
      }
      unique.set(row.onuIndex, row);
    }
    return [...unique.values()];
  }

  async inspectOnuFieldNames(oltCuid, { needle, maxRows = 10_000, pageSize = 500 } = {}) {
    const targetCuid = cleanText(oltCuid);
    const search = cleanText(needle);
    if (!targetCuid) {
      const error = new Error("网管二期 ONU 字段诊断缺少 OLT 标识。");
      error.status = 400;
      throw error;
    }
    if (!search) {
      const error = new Error("网管二期 ONU 字段诊断缺少搜索值。");
      error.status = 400;
      throw error;
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      const error = new Error("网管二期 ONU 分页大小必须是 1-500 的整数。");
      error.status = 400;
      throw error;
    }
    const page = "/ngb/ResDevAction/config.do";
    const detail = new URL(`${this.ngbBaseUrl}${page}`);
    detail.searchParams.set("CUID", targetCuid);
    await this.#requestUrl(detail);

    const fieldNames = new Set();
    const matches = [];
    await this.readGridRows(page, onuListQueryData(targetCuid), {
      pageSize,
      maxRows,
      projectRow: (row) => {
        for (const key of Object.keys(row || {})) {
          const safeKey = diagnosticFieldName(key);
          if (safeKey) fieldNames.add(safeKey);
        }
        const matchingFields = Object.entries(row || {})
          .filter(([, value]) => cleanText(value).includes(search))
          .map(([key]) => diagnosticFieldName(key))
          .filter(Boolean)
          .sort();
        if (matchingFields.length) {
          const coordinate = coordinateFromRow(row);
          matches.push({
            fields: [...new Set(matchingFields)],
            onuIndex: coordinate ? `${coordinate.chassis}/${coordinate.board}/${coordinate.pon}:${coordinate.onuId}` : ""
          });
        }
        return undefined;
      }
    });
    return {
      fieldNames: [...fieldNames].sort(),
      matches
    };
  }

  async findOnuCuid(oltCuid, coordinateInput) {
    const coordinate = normalizeCoordinate(coordinateInput);
    const page = "/ngb/ResDevAction/config.do";
    const detail = new URL(`${this.ngbBaseUrl}${page}`);
    detail.searchParams.set("CUID", oltCuid);
    await this.#requestUrl(detail);
    const data = onuListQueryData(oltCuid);
    let matched;
    await this.readGridRows(page, data, {
      pageSize: 500,
      maxRows: 10_000,
      projectRow: () => undefined,
      stopWhen: (row) => {
        const current = coordinateFromRow(row);
        const same = current && Object.keys(coordinate).every((key) => current[key] === coordinate[key]);
        if (same) matched = cleanText(row?.CUID || row?.ONU_CUID);
        return Boolean(matched);
      }
    });
    if (!matched) {
      const error = new Error("网管二期 ONU 列表中未找到该精确坐标。");
      error.status = 404;
      throw error;
    }
    return matched;
  }

  async readHistoricalOptical({ oltCuid, coordinate, startDate, endDate }) {
    const start = normalizeDate(startDate, "开始日期");
    const end = normalizeDate(endDate, "结束日期");
    if (Date.parse(`${start}T00:00:00`) > Date.parse(`${end}T23:59:59`)) {
      const error = new Error("开始日期不能晚于结束日期。");
      error.status = 400;
      throw error;
    }
    const onuCuid = await this.findOnuCuid(oltCuid, coordinate);
    const page = `/ngb/core/cmp_ext/mt/MvQueryGridPanel.jsp?code=res.logic.RES_DEV.ONU.OPTICAL_HIS&s_ONU.CUID=${encodeURIComponent(onuCuid)}`;
    await this.#requestUrl(`${this.ngbBaseUrl}${page}`);
    const onuFilter = { key: "CUID", alias: "ONU", relation: "=", type: "string", value: onuCuid };
    const data = {
      cfgParams: { tplName: "res.logic.RES_DEV.ONU.OPTICAL_HIS" },
      urlParams: { "ONU.CUID": onuFilter },
      boName: "XmlMvGridBO",
      queryParams: {
        REPORT_TIME: { key: "REPORT_TIME", relation: "between", value: `${start} 00:00:00,${end} 23:59:59`, type: "date", alias: "O" },
        "ONU.CUID": onuFilter
      },
      extParams: {}
    };
    const rows = await this.readGridRows(page, data, {
      pageSize: 100,
      maxRows: 2_000,
      projectRow: (row) => ({
        reportTime: normalizeReportTime(row?.REPORT_TIME),
        rxOptical: finiteNumber(row?.RX_OPTICAL),
        txOptical: finiteNumber(row?.TX_OPTICAL),
        oltRxOptical: finiteNumber(row?.OLT_RX_OPTICAL),
        lightDecay: finiteNumber(row?.LIGHTDECAY)
      })
    });
    return rows.filter((row) => row.reportTime).sort((left, right) => right.reportTime.localeCompare(left.reportTime));
  }
}
