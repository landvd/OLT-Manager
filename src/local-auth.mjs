import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

const scrypt = promisify(scryptCallback);
const AUTH_FILE = "auth.json";
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function cleanPassword(value) {
  return typeof value === "string" ? value : "";
}

function passwordError(password) {
  if (password.length < MIN_PASSWORD_LENGTH) return `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`;
  return "";
}

async function hashPassword(password, salt = randomBytes(16)) {
  const digest = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return { algorithm: "scrypt", salt: salt.toString("base64"), hash: Buffer.from(digest).toString("base64") };
}

async function verifyPassword(password, record) {
  if (!record || record.algorithm !== "scrypt") return false;
  try {
    const derived = await hashPassword(password, Buffer.from(record.salt, "base64"));
    const expected = Buffer.from(record.hash, "base64");
    const actual = Buffer.from(derived.hash, "base64");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function isNodeTestProcess() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes("--test");
}

export function createLocalAuth({ dataDir, password = process.env.OLT_MANAGER_AUTH_PASSWORD, sessionTtlMs = DEFAULT_SESSION_TTL_MS, testBypass = false } = {}) {
  const authPath = join(dataDir, AUTH_FILE);
  const sessions = new Map();
  let credential;
  let enabled = true;
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      credential = JSON.parse(await readFile(authPath, "utf8"));
      enabled = credential?.enabled !== false;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("本地登录配置无法读取。");
      if (cleanPassword(password)) await setPassword(password);
    }
  }

  async function setPassword(nextPassword) {
    const normalized = cleanPassword(nextPassword);
    const validationError = passwordError(normalized);
    if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });
    credential = { version: 1, enabled, ...(await hashPassword(normalized)), createdAt: new Date().toISOString() };
    await mkdir(dataDir, { recursive: true });
    await writeFile(authPath, `${JSON.stringify(credential)}\n`, { mode: 0o600 });
    try { await chmod(authPath, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  }

  function pruneSessions(now = Date.now()) {
    for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  }

  async function login(nextPassword) {
    await load();
    const normalized = cleanPassword(nextPassword);
    if (!credential) throw Object.assign(new Error("尚未设置本地登录密码，请先完成首次设置。"), { statusCode: 428, code: "AUTH_SETUP_REQUIRED" });
    if (!(await verifyPassword(normalized, credential))) throw Object.assign(new Error("密码错误。"), { statusCode: 401, code: "AUTH_INVALID_CREDENTIALS" });
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const session = { id: randomUUID(), createdAt: now, expiresAt: now + sessionTtlMs };
    sessions.set(token, session);
    return { token, expiresAt: new Date(session.expiresAt).toISOString(), sessionId: session.id };
  }

  async function setup(nextPassword) {
    await load();
    if (credential) throw Object.assign(new Error("本地登录密码已经设置。"), { statusCode: 409, code: "AUTH_ALREADY_CONFIGURED" });
    await setPassword(nextPassword);
    return login(nextPassword);
  }

  async function authenticate(request) {
    await load();
    if (testBypass) return { ok: true, mode: "test" };
    if (!enabled) return { ok: true, mode: "disabled" };
    pruneSessions();
    const match = /^Bearer\s+([^\s]+)$/i.exec(String(request.headers.authorization || ""));
    const session = match ? sessions.get(match[1]) : null;
    if (!session || session.expiresAt <= Date.now()) {
      if (match) sessions.delete(match[1]);
      return { ok: false, code: "AUTH_REQUIRED", status: 401 };
    }
    session.expiresAt = Date.now() + sessionTtlMs;
    return { ok: true, sessionId: session.id, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  async function logout(request) {
    const match = /^Bearer\s+([^\s]+)$/i.exec(String(request.headers.authorization || ""));
    if (match) sessions.delete(match[1]);
    return { ok: true };
  }

  async function setEnabled(nextEnabled) {
    await load();
    const next = nextEnabled !== false;
    if (next && !credential) {
      throw Object.assign(new Error("启用登录保护前必须先设置本地登录密码。"), { statusCode: 428, code: "AUTH_SETUP_REQUIRED" });
    }
    enabled = next;
    if (credential) {
      credential = { ...credential, enabled };
      await mkdir(dataDir, { recursive: true });
      await writeFile(authPath, `${JSON.stringify(credential)}\n`, { mode: 0o600 });
      try { await chmod(authPath, 0o600); } catch { /* Windows may not support POSIX modes. */ }
    }
    return enabled;
  }

  return {
    load,
    login,
    setup,
    logout,
    authenticate,
    isConfigured: async () => { await load(); return Boolean(credential); },
    isEnabled: async () => { await load(); return enabled; },
    setEnabled,
    isTestBypass: testBypass,
    minPasswordLength: MIN_PASSWORD_LENGTH
  };
}

export function shouldUseAuthBypass(options = {}) {
  if (options.testBypass === false) return false;
  if (options.testBypass === true) return true;
  return options.authRequired !== true && isNodeTestProcess();
}
