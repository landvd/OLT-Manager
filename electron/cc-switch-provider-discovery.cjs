const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SAFE_ENDPOINT_KEYS = new Set([
  "base_url", "baseurl", "api_base", "apibase", "endpoint", "api_endpoint", "apiendpoint", "url"
]);
const SAFE_MODEL_KEYS = new Set(["model", "default_model", "defaultmodel", "model_name", "modelname"]);
const SAFE_FORMAT_KEYS = new Set([
  "wire_api", "wireapi", "format", "upstream_format", "upstreamformat", "api_format", "apiformat"
]);
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|credential|auth|private[_-]?key)/i;

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[\s-]/g, "_");
}

function formatValue(value) {
  const valueText = String(value ?? "").trim().toLowerCase();
  if (valueText.includes("response")) return "responses";
  if (valueText.includes("chat") || valueText.includes("completion")) return "chat-completions";
  return "";
}

function safeEndpoint(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol !== "https:" && !localHttp) ||
        url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeProviderFormat({ name = "", endpoint = "", model = "", format = "" } = {}) {
  const normalizedFormat = format || "chat-completions";
  let host = "";
  try { host = new URL(String(endpoint || "http://invalid.local")).hostname; } catch { /* fall through */ }
  const identity = `${name} ${host} ${model}`.toLowerCase();
  if (identity.includes("minimax") || identity.includes("minimaxi.com")) return "chat-completions";
  return normalizedFormat;
}

function safeProviderConfig(value, result = {}) {
  if (typeof value === "string") {
    for (const line of value.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z][\w-]*)\s*=\s*["']?([^"'#!]+)["']?\s*(?:#.*)?$/);
      if (!match || SECRET_KEY_PATTERN.test(match[1])) continue;
      const key = normalizeKey(match[1]);
      const text = match[2].trim();
      if (SAFE_ENDPOINT_KEYS.has(key)) result.endpoint ||= safeEndpoint(text);
      if (SAFE_MODEL_KEYS.has(key)) result.model ||= text;
      if (SAFE_FORMAT_KEYS.has(key)) result.format ||= formatValue(text);
    }
    try { return safeProviderConfig(JSON.parse(value), result); } catch { return result; }
  }
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) safeProviderConfig(item, result);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    const normalized = normalizeKey(key);
    if (typeof child === "string") {
      if (SAFE_ENDPOINT_KEYS.has(normalized)) result.endpoint ||= safeEndpoint(child);
      if (SAFE_MODEL_KEYS.has(normalized)) result.model ||= child.trim();
      if (SAFE_FORMAT_KEYS.has(normalized)) result.format ||= formatValue(child);
    }
    safeProviderConfig(child, result);
  }
  return result;
}

function runSqlite(sqliteBinary, databasePath, query) {
  try {
    const output = execFileSync(sqliteBinary, ["-json", databasePath, query], {
      encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"]
    });
    return JSON.parse(output || "[]");
  } catch {
    return [];
  }
}

function candidateDatabasePaths(homeDirectory) {
  return [
    path.join(homeDirectory, ".cc-switch", "cc-switch.db"),
    path.join(homeDirectory, "Library", "Application Support", "com.ccswitch.desktop", "cc-switch.db")
  ];
}

function discoverCCSwitchProviders({
  homeDirectory = os.homedir(),
  databasePath = candidateDatabasePaths(homeDirectory).find((candidate) => fs.existsSync(candidate)),
  sqliteBinary = process.platform === "win32" ? (process.env.OLT_MANAGER_SQLITE_BIN || "sqlite3.exe") : "sqlite3",
  queryRunner = runSqlite
} = {}) {
  if (!databasePath || !fs.existsSync(databasePath)) return [];
  const rows = queryRunner(sqliteBinary, databasePath,
    "SELECT id, app_type, name, website_url, category, provider_type, settings_config FROM providers;");
  const endpoints = queryRunner(sqliteBinary, databasePath,
    "SELECT provider_id, app_type, url FROM provider_endpoints;");
  const endpointMap = new Map(endpoints.map((row) => [`${row.provider_id}:${row.app_type}`, safeEndpoint(row.url)]));
  const providers = [];
  for (const row of rows) {
    const config = safeProviderConfig(row.settings_config);
    const endpoint = endpointMap.get(`${row.id}:${row.app_type}`) || config.endpoint || "";
    const model = config.model || "";
    if (!endpoint && !model) continue;
    providers.push({
      id: String(row.id || ""),
      appType: String(row.app_type || ""),
      name: String(row.name || row.id || "CC Switch provider"),
      endpoint,
      model,
      format: normalizeProviderFormat({
        name: row.name || row.id,
        endpoint,
        model,
        format: config.format
      }),
      source: "CC Switch"
    });
  }
  return providers;
}

module.exports = { discoverCCSwitchProviders, safeProviderConfig, safeEndpoint, normalizeProviderFormat };
