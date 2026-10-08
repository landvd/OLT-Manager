// 一期/二期网管、Bot AI 配置与 OLT IP 映射。
import { exec, query, resourceManagementSecretProvider, sqlQuote } from "./core.mjs";
import { getOlts } from "./olts.mjs";
import { createDatabaseBackup } from "./backup.mjs";

async function readResourceManagementRows() {
  const [config] = await query("SELECT server_url, username, password, updated_at FROM resource_management_config WHERE id = 1;");
  const [credential] = await query("SELECT format, backend, purpose, reference, envelope_json, updated_at FROM resource_management_credential WHERE id = 1;");
  return { config: config || {}, credential: credential || null };
}

function credentialError(message, status = 428, code = "RESOURCE_CREDENTIAL_UNLOCK_REQUIRED") {
  return Object.assign(new Error(message), { status, code });
}

export async function getResourceManagementConfig() {
  const { config, credential } = await readResourceManagementRows();
  let plainPassword = config.password || "";
  if (!plainPassword && credential?.envelope_json) {
    try {
      const envelope = JSON.parse(credential.envelope_json);
      plainPassword = await resourceManagementSecretProvider.open(envelope).catch(() => "");
    } catch {}
  }
  const credentialConfigured = Boolean(config.server_url && config.username && (plainPassword || credential?.envelope_json));
  return {
    serverUrl: config.server_url || "",
    username: config.username || "",
    password: plainPassword,
    configured: credentialConfigured,
    credentialConfigured,
    backend: credential?.backend || (plainPassword ? "local" : ""),
    needsMigration: false,
    updatedAt: config.updated_at || ""
  };
}

export async function getResourceManagementPassword({ masterPassword = "", provider = resourceManagementSecretProvider } = {}) {
  const { config, credential } = await readResourceManagementRows();
  if (!config.server_url || !config.username) throw credentialError("请先保存完整的资源管理配置。", 400, "RESOURCE_CONFIG_REQUIRED");
  if (masterPassword && credential?.envelope_json) {
    let envelope;
    try { envelope = JSON.parse(credential.envelope_json); } catch { throw credentialError("资源管理凭据封装已损坏，无法解锁。", 500, "RESOURCE_CREDENTIAL_INVALID"); }
    try {
      return await provider.open(envelope, { masterPassword });
    } catch (error) {
      throw credentialError("迁移主密码错误或资源管理凭据无法解锁。", 401, "RESOURCE_CREDENTIAL_INVALID_PASSWORD");
    }
  }
  if (config.password) return config.password;
  if (credential?.envelope_json) {
    let envelope;
    try { envelope = JSON.parse(credential.envelope_json); } catch { throw credentialError("资源管理凭据封装已损坏，无法解锁。", 500, "RESOURCE_CREDENTIAL_INVALID"); }
    try {
      return await provider.open(envelope, { masterPassword });
    } catch (error) {
      throw credentialError(masterPassword ? "迁移主密码错误或资源管理凭据无法解锁。" : "资源管理定时任务缺少解密材料，请先在桌面版解锁或登录一次。", masterPassword ? 401 : 428, masterPassword ? "RESOURCE_CREDENTIAL_INVALID_PASSWORD" : "RESOURCE_CREDENTIAL_UNLOCK_REQUIRED");
    }
  }
  throw credentialError("尚未配置资源管理密码。", 400, "RESOURCE_CREDENTIAL_REQUIRED");
}

export async function migrateResourceManagementCredential({ provider = resourceManagementSecretProvider, masterPassword = "", createBackup = true } = {}) {
  const { config, credential } = await readResourceManagementRows();
  if (credential?.envelope_json) return { migrated: false, ...await getResourceManagementConfig() };
  if (!config.password) return { migrated: false, ...await getResourceManagementConfig() };
  let envelope;
  try {
    envelope = await provider.seal(config.password, {
      mode: masterPassword ? "portable" : "auto",
      masterPassword,
      purpose: "nmse/login",
      reference: provider.randomReference("nmse")
    });
  } catch (error) {
    throw credentialError("旧版资源管理密码尚未迁移：请输入至少 8 位迁移主密码，或在桌面版启用系统加密存储。", 428, "RESOURCE_CREDENTIAL_MIGRATION_REQUIRED");
  }
  if (createBackup) await createDatabaseBackup({ reason: "resource-management-credential-migration" });
  const metadata = provider.metadata(envelope);
  await exec(`BEGIN;
INSERT INTO resource_management_credential (id, format, backend, purpose, reference, envelope_json, updated_at)
VALUES (1, ${sqlQuote(metadata.format)}, ${sqlQuote(metadata.backend)}, ${sqlQuote(metadata.purpose)}, ${sqlQuote(metadata.reference)}, ${sqlQuote(JSON.stringify(envelope))}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET format = excluded.format, backend = excluded.backend, purpose = excluded.purpose, reference = excluded.reference, envelope_json = excluded.envelope_json, updated_at = CURRENT_TIMESTAMP;
UPDATE resource_management_config SET password = '', updated_at = CURRENT_TIMESTAMP WHERE id = 1;
COMMIT;`);
  return { migrated: true, ...await getResourceManagementConfig() };
}

export async function saveResourceManagementConfig(input = {}) {
  const serverUrl = String(input.serverUrl || "").trim().replace(/\/$/, "");
  const username = String(input.username || "").trim();
  const password = String(input.password || "");
  const migrationMasterPassword = String(input.migrationMasterPassword || "");
  if (!serverUrl || !username) {
    const error = new Error("资源管理服务器地址和用户名不能为空。");
    error.status = 400;
    throw error;
  }
  const existing = await readResourceManagementRows();
  const effectivePassword = password !== "" ? password : existing.config.password;
  let envelope = null;

  if (effectivePassword) {
    if (migrationMasterPassword) {
      envelope = await resourceManagementSecretProvider.seal(effectivePassword, {
        mode: "portable",
        masterPassword: migrationMasterPassword,
        purpose: "nmse/login",
        reference: resourceManagementSecretProvider.randomReference("nmse")
      });
    } else if (resourceManagementSecretProvider.capabilities?.().osEncryption) {
      // If OS encryption is advertised but fails, fail closed instead of
      // silently downgrading the credential to plaintext.
      envelope = await resourceManagementSecretProvider.seal(effectivePassword, {
        mode: "os",
        purpose: "nmse/login",
        reference: resourceManagementSecretProvider.randomReference("nmse")
      });
    }
  } else if (existing.credential?.envelope_json) {
    envelope = JSON.parse(existing.credential.envelope_json);
  }

  if (!effectivePassword && !envelope) {
    throw credentialError("请填写资源管理登录密码。", 400, "RESOURCE_CREDENTIAL_REQUIRED");
  }

  if (envelope) {
    const metadata = resourceManagementSecretProvider.metadata(envelope);
    await exec(`INSERT INTO resource_management_config (id, server_url, username, password, updated_at)
VALUES (1, ${sqlQuote(serverUrl)}, ${sqlQuote(username)}, ${sqlQuote(effectivePassword)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, username = excluded.username, password = excluded.password, updated_at = CURRENT_TIMESTAMP;
INSERT INTO resource_management_credential (id, format, backend, purpose, reference, envelope_json, updated_at)
VALUES (1, ${sqlQuote(metadata.format)}, ${sqlQuote(metadata.backend)}, ${sqlQuote(metadata.purpose)}, ${sqlQuote(metadata.reference)}, ${sqlQuote(JSON.stringify(envelope))}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET format = excluded.format, backend = excluded.backend, purpose = excluded.purpose, reference = excluded.reference, envelope_json = excluded.envelope_json, updated_at = CURRENT_TIMESTAMP;
INSERT INTO admin_events (action, source, detail) VALUES ('save_resource_management_config', 'admin', ${sqlQuote(`configured_${metadata.backend}`)});`);
  } else {
    await exec(`INSERT INTO resource_management_config (id, server_url, username, password, updated_at)
VALUES (1, ${sqlQuote(serverUrl)}, ${sqlQuote(username)}, ${sqlQuote(effectivePassword)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, username = excluded.username, password = excluded.password, updated_at = CURRENT_TIMESTAMP;
DELETE FROM resource_management_credential WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('save_resource_management_config', 'admin', 'configured');`);
  }
  return getResourceManagementConfig();
}

function normalizeLocalBaseUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    const error = new Error(`${label}无效。`);
    error.status = 400;
    throw error;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    const error = new Error(`${label}必须是 http 或 https 基地址。`);
    error.status = 400;
    throw error;
  }
  return url.toString().replace(/\/$/, "");
}

export async function getOssResourceConfig() {
  const rows = await query(`SELECT auth_base_url, ngb_base_url, username, password, organization_name, room_name, updated_at
FROM oss_resource_config WHERE id = 1;`);
  const credentialRows = await query(`SELECT 1 AS configured FROM oss_resource_credential WHERE id = 1 AND ciphertext <> '' LIMIT 1;`);
  const row = rows[0] || {};
  const credentialConfigured = Boolean(credentialRows.length || row.password);
  return {
    authBaseUrl: row.auth_base_url || "",
    ngbBaseUrl: row.ngb_base_url || "",
    username: row.username || "",
    password: row.password || "",
    organizationName: row.organization_name || "",
    roomName: row.room_name || "",
    configured: Boolean(row.auth_base_url && row.ngb_base_url && row.username && row.organization_name && row.room_name),
    credentialConfigured,
    updatedAt: row.updated_at || ""
  };
}

export async function getOssResourcePassword() {
  const rows = await query(`SELECT password FROM oss_resource_config WHERE id = 1;`);
  return rows[0]?.password || "";
}

export async function getBotAiConfig() {
  const rows = await query(`SELECT feishu_enabled, feishu_app_id, feishu_app_secret,
    jev_provider_name, jev_endpoint, jev_model, jev_format, jev_api_key,
    pi_provider_name, pi_endpoint, pi_model, pi_format, pi_api_key,
    anysearch_api_key, anysearch_enabled,
    wecom_enabled, wecom_bot_id, wecom_secret, updated_at
  FROM bot_ai_config WHERE id = 1;`);
  const row = rows[0] || {};
  return {
    feishuEnabled: Boolean(row.feishu_enabled),
    feishuAppId: row.feishu_app_id || "",
    feishuAppSecret: row.feishu_app_secret || "",
    jevProviderName: row.jev_provider_name || "",
    jevEndpoint: row.jev_endpoint || "",
    jevModel: row.jev_model || "",
    jevFormat: row.jev_format || "responses",
    jevApiKey: row.jev_api_key || "",
    piProviderName: row.pi_provider_name || "",
    piEndpoint: row.pi_endpoint || "",
    piModel: row.pi_model || "",
    piFormat: row.pi_format || "chat-completions",
    piApiKey: row.pi_api_key || "",
    anysearchApiKey: row.anysearch_api_key || "",
    anysearchEnabled: row.anysearch_enabled !== 0 && row.anysearch_enabled !== false,
    wecomEnabled: Boolean(row.wecom_enabled),
    wecomBotId: row.wecom_bot_id || "",
    wecomSecret: row.wecom_secret || "",
    updatedAt: row.updated_at || ""
  };
}

export async function saveBotAiConfig(patch = {}) {
  const current = await getBotAiConfig();
  const next = {
    feishuEnabled: patch.feishuEnabled !== undefined ? (patch.feishuEnabled ? 1 : 0) : (current.feishuEnabled ? 1 : 0),
    feishuAppId: patch.feishuAppId !== undefined ? String(patch.feishuAppId).trim() : current.feishuAppId,
    feishuAppSecret: patch.feishuAppSecret !== undefined ? String(patch.feishuAppSecret).trim() : current.feishuAppSecret,
    jevProviderName: patch.jevProviderName !== undefined ? String(patch.jevProviderName).trim() : current.jevProviderName,
    jevEndpoint: patch.jevEndpoint !== undefined ? String(patch.jevEndpoint).trim() : current.jevEndpoint,
    jevModel: patch.jevModel !== undefined ? String(patch.jevModel).trim() : current.jevModel,
    jevFormat: patch.jevFormat !== undefined ? String(patch.jevFormat).trim() : current.jevFormat,
    jevApiKey: patch.jevApiKey !== undefined ? String(patch.jevApiKey).trim() : current.jevApiKey,
    piProviderName: patch.piProviderName !== undefined ? String(patch.piProviderName).trim() : current.piProviderName,
    piEndpoint: patch.piEndpoint !== undefined ? String(patch.piEndpoint).trim() : current.piEndpoint,
    piModel: patch.piModel !== undefined ? String(patch.piModel).trim() : current.piModel,
    piFormat: patch.piFormat !== undefined ? String(patch.piFormat).trim() : current.piFormat,
    piApiKey: patch.piApiKey !== undefined ? String(patch.piApiKey).trim() : current.piApiKey,
    anysearchApiKey: patch.anysearchApiKey !== undefined ? String(patch.anysearchApiKey).trim() : current.anysearchApiKey,
    anysearchEnabled: patch.anysearchEnabled !== undefined ? (patch.anysearchEnabled ? 1 : 0) : (current.anysearchEnabled ? 1 : 0),
    wecomEnabled: patch.wecomEnabled !== undefined ? (patch.wecomEnabled ? 1 : 0) : (current.wecomEnabled ? 1 : 0),
    wecomBotId: patch.wecomBotId !== undefined ? String(patch.wecomBotId).trim() : current.wecomBotId,
    wecomSecret: patch.wecomSecret !== undefined ? String(patch.wecomSecret).trim() : current.wecomSecret
  };

  await exec(`INSERT INTO bot_ai_config (
    id, feishu_enabled, feishu_app_id, feishu_app_secret,
    jev_provider_name, jev_endpoint, jev_model, jev_format, jev_api_key,
    pi_provider_name, pi_endpoint, pi_model, pi_format, pi_api_key,
    anysearch_api_key, anysearch_enabled,
    wecom_enabled, wecom_bot_id, wecom_secret, updated_at
  ) VALUES (
    1, ${next.feishuEnabled}, ${sqlQuote(next.feishuAppId)}, ${sqlQuote(next.feishuAppSecret)},
    ${sqlQuote(next.jevProviderName)}, ${sqlQuote(next.jevEndpoint)}, ${sqlQuote(next.jevModel)}, ${sqlQuote(next.jevFormat)}, ${sqlQuote(next.jevApiKey)},
    ${sqlQuote(next.piProviderName)}, ${sqlQuote(next.piEndpoint)}, ${sqlQuote(next.piModel)}, ${sqlQuote(next.piFormat)}, ${sqlQuote(next.piApiKey)},
    ${sqlQuote(next.anysearchApiKey)}, ${next.anysearchEnabled},
    ${next.wecomEnabled}, ${sqlQuote(next.wecomBotId)}, ${sqlQuote(next.wecomSecret)}, CURRENT_TIMESTAMP
  )
  ON CONFLICT(id) DO UPDATE SET
    feishu_enabled = excluded.feishu_enabled,
    feishu_app_id = excluded.feishu_app_id,
    feishu_app_secret = excluded.feishu_app_secret,
    jev_provider_name = excluded.jev_provider_name,
    jev_endpoint = excluded.jev_endpoint,
    jev_model = excluded.jev_model,
    jev_format = excluded.jev_format,
    jev_api_key = excluded.jev_api_key,
    pi_provider_name = excluded.pi_provider_name,
    pi_endpoint = excluded.pi_endpoint,
    pi_model = excluded.pi_model,
    pi_format = excluded.pi_format,
    pi_api_key = excluded.pi_api_key,
    anysearch_api_key = excluded.anysearch_api_key,
    anysearch_enabled = excluded.anysearch_enabled,
    wecom_enabled = excluded.wecom_enabled,
    wecom_bot_id = excluded.wecom_bot_id,
    wecom_secret = excluded.wecom_secret,
    updated_at = CURRENT_TIMESTAMP;`);

  return getBotAiConfig();
}

export async function getOssResourceCredential() {
  const rows = await query(`SELECT format_version, algorithm, kdf, kdf_n, kdf_r, kdf_p, salt, iv, auth_tag, ciphertext
FROM oss_resource_credential WHERE id = 1 LIMIT 1;`);
  const row = rows[0];
  if (!row) return null;
  return {
    version: Number(row.format_version),
    algorithm: row.algorithm,
    kdf: row.kdf,
    kdfN: Number(row.kdf_n),
    kdfR: Number(row.kdf_r),
    kdfP: Number(row.kdf_p),
    salt: row.salt,
    iv: row.iv,
    authTag: row.auth_tag,
    ciphertext: row.ciphertext
  };
}

export async function saveOssResourceCredential(credential = {}) {
  const required = ["version", "algorithm", "kdf", "kdfN", "kdfR", "kdfP", "salt", "iv", "authTag", "ciphertext"];
  if (required.some((key) => credential[key] === undefined || credential[key] === null || credential[key] === "")) {
    const error = new Error("网管二期密码密文不完整。");
    error.status = 400;
    throw error;
  }
  await exec(`INSERT INTO oss_resource_credential (id, format_version, algorithm, kdf, kdf_n, kdf_r, kdf_p, salt, iv, auth_tag, ciphertext, updated_at)
VALUES (1, ${Number(credential.version)}, ${sqlQuote(credential.algorithm)}, ${sqlQuote(credential.kdf)}, ${Number(credential.kdfN)}, ${Number(credential.kdfR)}, ${Number(credential.kdfP)}, ${sqlQuote(credential.salt)}, ${sqlQuote(credential.iv)}, ${sqlQuote(credential.authTag)}, ${sqlQuote(credential.ciphertext)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET format_version = excluded.format_version, algorithm = excluded.algorithm, kdf = excluded.kdf,
kdf_n = excluded.kdf_n, kdf_r = excluded.kdf_r, kdf_p = excluded.kdf_p, salt = excluded.salt, iv = excluded.iv,
auth_tag = excluded.auth_tag, ciphertext = excluded.ciphertext, updated_at = CURRENT_TIMESTAMP;
INSERT INTO admin_events (action, source, detail) VALUES ('save_oss_resource_credential', 'admin', 'encrypted_password_saved');`);
}

export async function saveOssResourceConfig(input = {}) {
  const authBaseUrl = normalizeLocalBaseUrl(input.authBaseUrl, "OSS 认证地址");
  const ngbBaseUrl = normalizeLocalBaseUrl(input.ngbBaseUrl, "网管二期地址");
  const username = String(input.username || "").trim();
  const organizationName = String(input.organizationName || "").trim();
  const roomName = String(input.roomName || "").trim();
  if (!username || !organizationName || !roomName) {
    const error = new Error("OSS 用户名、组织名称和机房名称不能为空。");
    error.status = 400;
    throw error;
  }
  const existingPassword = (await query(`SELECT password FROM oss_resource_config WHERE id = 1;`))[0]?.password || "";
  const effectivePassword = input.password !== undefined ? String(input.password) : existingPassword;
  await exec(`INSERT INTO oss_resource_config (id, auth_base_url, ngb_base_url, username, password, organization_name, room_name, updated_at)
VALUES (1, ${sqlQuote(authBaseUrl)}, ${sqlQuote(ngbBaseUrl)}, ${sqlQuote(username)}, ${sqlQuote(effectivePassword)}, ${sqlQuote(organizationName)}, ${sqlQuote(roomName)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET auth_base_url = excluded.auth_base_url, ngb_base_url = excluded.ngb_base_url,
username = excluded.username, password = excluded.password, organization_name = excluded.organization_name, room_name = excluded.room_name, updated_at = CURRENT_TIMESTAMP;
INSERT INTO admin_events (action, source, detail) VALUES ('save_oss_resource_config', 'admin', ${sqlQuote(effectivePassword ? "configured_with_password" : "configured_without_password")});`);
  return getOssResourceConfig();
}

function normalizeIpv4(value, label) {
  const ip = String(value || "").trim();
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
    throw new Error(`${label}格式无效。`);
  }
  return parts.map(Number).join(".");
}

export function normalizeResourceOltIpMappings(mappings = []) {
  const resourceIps = new Set();
  const oltIps = new Set();
  return mappings.map((mapping) => {
    const resourceIp = normalizeIpv4(mapping.resourceIp || mapping.resource_ip, "网管二期 IP");
    const oltIp = normalizeIpv4(mapping.oltIp || mapping.olt_ip, "OLT IP");
    if (resourceIps.has(resourceIp)) throw new Error(`网管二期 IP 重复：${resourceIp}`);
    if (oltIps.has(oltIp)) throw new Error(`OLT IP 重复：${oltIp}`);
    resourceIps.add(resourceIp);
    oltIps.add(oltIp);
    return { resourceIp, oltIp };
  });
}

export async function getResourceOltIpMappings() {
  const rows = await query("SELECT resource_ip, olt_ip, source, synced_at FROM resource_olt_ip_mappings ORDER BY resource_ip;");
  return rows.map((row) => ({
    resourceIp: row.resource_ip,
    oltIp: row.olt_ip,
    source: row.source,
    syncedAt: row.synced_at
  }));
}

export async function replaceResourceOltIpMappings(mappings = [], source = "oss-ngb") {
  const rows = normalizeResourceOltIpMappings(mappings);
  const knownOlts = new Set((await getOlts()).map((olt) => olt.host));
  const unknown = rows.filter((row) => !knownOlts.has(row.oltIp)).map((row) => row.oltIp);
  if (unknown.length) throw new Error(`OLT Manager 中不存在对应 OLT：${unknown.join(", ")}`);
  await exec(`BEGIN;
DELETE FROM resource_olt_ip_mappings;
${rows.map((row) => `INSERT INTO resource_olt_ip_mappings (resource_ip, olt_ip, source, synced_at)
VALUES (${sqlQuote(row.resourceIp)}, ${sqlQuote(row.oltIp)}, ${sqlQuote(source)}, CURRENT_TIMESTAMP);`).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_olt_ip_mappings', ${sqlQuote(source)}, ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return getResourceOltIpMappings();
}
