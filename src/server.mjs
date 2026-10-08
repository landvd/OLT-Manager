import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import * as database from "./db.mjs";
import { createServerDataAccess } from "./server-data-access.mjs";
import { queryZteOnuReadOnly } from "./zte-telnet.mjs";
import { queryHuaweiOnuReadOnly } from "./huawei-telnet.mjs";
import { loginAndRunReadOnlyCommands } from "./telnet-client.mjs";
import { sanitizeCliOutput } from "./pi-agent/agent-tools.mjs";
import { openTerminalLogin } from "./terminal-login.mjs";
import { snmpGetViaUdp, snmpWalkViaUdp } from "./snmp-client.mjs";
import { createOltDataGateway } from "./olt-data-gateway.mjs";
import {
  buildConfigPlanFromTemplate,
  configTemplates,
  extractMduOttVlans,
  huaweiSnAuthSerial,
  suggestHuaweiOntId,
  suggestNextOnuId
} from "./config-plan.mjs";
import { renderConfigPlan, SUPPORTED_TEMPLATE_VARIABLES } from "./config-plan-engine.mjs";
import { profileById, supportsConfigPlan } from "./device-profiles.mjs";
import { defaultChassisForVendor, normalizePonCoordinate, onuCoordinateLabel, ponCoordinateKey } from "./pon-coordinate.mjs";
import { appRoot, dataRoot, missingToolMessage, resolveTool, staticRoot } from "./runtime-paths.mjs";
import {
  decodeHexSerial,
  decodeDistance,
  decodeHuaweiRxPower,
  decodeRawHexString,
  decodeSnmpDisplayString,
  decodeSnmpDateAndTime,
  decodeZteOfflineCause,
  decodeZteC600RxPower,
  ZTE_C600_RX_OPTICAL_POWER_OID,
  encodeZtePonIfIndex,
  decodeZteRxPower,
  encodeZtePonIndex,
  encodeZteC600PonIndex,
  encodeZteVportIndex,
  filterHuaweiUnregisteredSerialRows,
  huaweiRunStatus,
  huaweiUnconfiguredStatus,
  indexRows,
  collectHuaweiOntIndexes,
  oidSuffix,
  parseDateTimeText,
  parseHuaweiIfNameRows,
  parseHuaweiOntIndex,
  parseHuaweiOuterVlanRows,
  parseZteC600Index,
  parseZteIndex,
  parseZteOuterVlanRows,
  parseZteUnconfiguredIndex,
  phaseLabel,
  requestCoordinate,
  cleanSnmpValue,
  ztePonGroupKey,
  HUAWEI_SRV_FLOW_FRAME_OID as huaweiSrvFlowFrame,
  HUAWEI_SRV_FLOW_SLOT_OID as huaweiSrvFlowSlot,
  HUAWEI_SRV_FLOW_PON_OID as huaweiSrvFlowPon,
  HUAWEI_SRV_FLOW_PARAM_TYPE_OID as huaweiSrvFlowParaType,
  HUAWEI_SRV_FLOW_VLAN_ID_OID as huaweiSrvFlowVlanId,
  ZTE_VLAN_IF_CONF_VLAN_OID as zteVlanIfConfVlan
} from "./snmp-oid-codecs.mjs";
import { snmpGet, snmpWalk } from "./server/snmp-access.mjs";
import { oidProfiles, publicOidProfiles } from "./server/oid-profiles.mjs";
import { createOnuQueryService } from "./server/onu-query-service.mjs";
export { shouldUseInternalSnmp, buildSnmpStatusDiagnostics } from "./server/snmp-access.mjs";

export { parseZteOuterVlanRows } from "./snmp-oid-codecs.mjs";
import { NmseClient } from "./nmse-client.mjs";
import { OssNgbClient } from "./oss-ngb-client.mjs";
import { createResourceUserSync } from "./resource-user-sync.mjs";
import { createResourceSyncScheduler } from "./resource-sync-scheduler.mjs";
import { syncMergedOnuDataset } from "./merged-onu-sync.mjs";
import { createMergedOnuService } from "./merged-onu-service.mjs";
import { decryptOssNgbPassword, encryptOssNgbPassword, migrationMasterPasswordIsValid } from "./oss-credential-crypto.mjs";
import { createOssAutoLoginStore } from "./oss-auto-login-store.mjs";
import { createLocalAuth, shouldUseAuthBypass } from "./local-auth.mjs";
import { createSecretProvider } from "./secret-provider.mjs";
import { createEncryptedBackupContainer, decryptEncryptedBackupContainer } from "./database-backup-container.mjs";
import { createMergedOnuSyncRuntime } from "./merged-onu-sync-runtime.mjs";
import { handleProjectRoutes } from "./project-routes.mjs";
import { createRemoteSessionState } from "./remote-session-state.mjs";
import { createRemoteAccessRuntime } from "./remote-access-runtime.mjs";
import { createRemoteHistorySession } from "./remote-history-session.mjs";
import { handleResourceSyncRoutes } from "./resource-sync-routes.mjs";
import { handleBackupRoutes } from "./backup-routes.mjs";
import { handleSnmpAdminRoutes } from "./snmp-admin-routes.mjs";
import { handleResourceManagementRoutes } from "./resource-management-routes.mjs";
import { handleMergedOnuRoutes } from "./merged-onu-routes.mjs";
import { handleOltAdminRoutes } from "./olt-admin-routes.mjs";
import { handleOssResourceRoutes } from "./oss-resource-routes.mjs";
import { createNmseBossIncrementalRuntime } from "./nmse-boss-runtime.mjs";
import { createOnuDataEnrichment } from "./onu-data-enrichment.mjs";
import { createDashboardRemediationService } from "./dashboard-remediation-service.mjs";
import { createBackupCleanupRuntime } from "./backup-cleanup-runtime.mjs";
import { handleLocalAuthRoutes } from "./local-auth-routes.mjs";
import { createServerRequestHandler } from "./server-request-handler.mjs";
import { createPiAgentEngine } from "./pi-agent/pi-agent-engine.mjs";
import { handlePiAgentRoutes } from "./pi-agent/routes.mjs";
import {
  ENCRYPTED_BACKUP_PASSWORD_HEADER,
  json,
  readBody,
  readBinaryBody,
  encryptedBackupError,
  readEncryptedBackupPasswordBody,
  readEncryptedBackupContainer
} from "./http-protocol.mjs";

const root = appRoot;
const publicDir = join(root, "public");
const distDir = join(root, "dist");
const staticDir = staticRoot || (existsSync(join(distDir, "index.html")) ? distDir : publicDir);
const dataDir = dataRoot;
const {
  addProjectOnu,
  cleanResourceInstallationAddresses,
  cleanupDuplicateSnapshotCoordinates,
  addSnmpProbe,
  backupDatabaseBeforeSync,
  createProject,
  deleteProjectOnu,
  deleteProject,
  getAdminEvents,
  exportDatabaseBackup,
  getOlts,
  getOssResourceConfig,
  getOssResourceCredential,
  getOssResourcePassword,
  getPonPorts,
  getResourceOltIpMappings,
  getResourceManagementConfig,
  getResourceManagementPassword,
  getNmseBossSyncState,
  initializeNmseBossSyncState,
  applyNmseBossIncrementalChanges,
  replaceNmseBossNameHistory,
  resetNmseBossNameHistory,
  getResourceSyncTasks,
  getResourceUsers,
  getMergedOnuConflicts,
  getMergedOnuDatasetStatus,
  getMergedOnuNetworkSource,
  getMergedOnuNmseSource,
  getMergedOnuSourceStatus,
  getMergedOnuSnapshots,
  getMergedOnuSyncRuns,
  beginMergedOnuSyncRun,
  claimMergedOnuSyncLease,
  renewMergedOnuSyncLease,
  getLatestMergedOnuSourceManifest,
  listRecoverableMergedOnuSyncRuns,
  persistMergedOnuManifest,
  recordMergedOnuSyncFailure,
  recordMergedOnuSourceSyncSuccess,
  replaceMergedOnuNetworkSource,
  replaceMergedOnuNmseSource,
  getResourceVlanSnapshot,
  getProject,
  getProjectOnus,
  getProjectOnuAssignments,
  getProjects,
  getSnmpHistory,
  getOnuStatusHistory,
  initDb,
  replaceOlts,
  replacePonPorts,
  replaceResourceUserCheckpoint,
  replaceResourceUsers,
  replaceResourceUsersBatch,
  replaceResourceVlans,
  recordOnuStatusHistory,
  restoreDatabaseBackup,
  validateDatabaseBackup,
  saveResourceManagementConfig,
  configureResourceManagementSecretProvider,
  saveOssResourceConfig,
  saveOssResourceCredential,
  createResourceSyncTask,
  deleteResourceSyncTask,
  planDatabaseBackupCleanup,
  executeDatabaseBackupCleanup,
  updateResourceSyncTask,
  updateMergedOnuSyncRuntime,
  updateProjectOnuNote,
  updateProject,
  updatePonPortVlans,
  getBotAiConfig,
  saveBotAiConfig,
  getOnuDigitalTwin,
  getPortExperience,
  listConfigTemplates,
  getConfigTemplate,
  saveConfigTemplate,
  deleteConfigTemplate,
  resetBuiltinConfigTemplate,
  seedConfigTemplates
} = createServerDataAccess(database);
const nodeRequire = createRequire(import.meta.url);
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const appVersion = packageJson.version;
function desktopSafeStorage() {
  if (!process.versions.electron) return null;
  try { return nodeRequire("electron").safeStorage; } catch { return null; }
}
const ossAutoLoginStore = createOssAutoLoginStore({ dataDirectory: dataDir, safeStorage: desktopSafeStorage() });
const resourceManagementSecretProvider = createSecretProvider({ safeStorage: desktopSafeStorage() });
configureResourceManagementSecretProvider(resourceManagementSecretProvider);
const remoteSessionState = createRemoteSessionState();
const remoteAccessRuntime = createRemoteAccessRuntime({
  sessionState: remoteSessionState,
  NmseClient,
  OssNgbClient,
  getResourceManagementConfig,
  getResourceManagementPassword,
  resourceManagementSecretProvider,
  getOssResourceConfig,
  getOssResourceCredential,
  getOssResourcePassword,
  saveOssResourceConfig,
  saveOssResourceCredential,
  encryptOssNgbPassword,
  decryptOssNgbPassword,
  migrationMasterPasswordIsValid,
  ossAutoLoginStore
});
const {
  activeNmseSession,
  resourceGridRank,
  loginNmseSession,
  ensureNmseSession,
  activeOssNgbSession,
  ensureOssNgbSession,
  loginOssNgbSession
} = remoteAccessRuntime;
const remoteHistorySession = createRemoteHistorySession({
  getSession: () => remoteSessionState.getOssNgbSession(),
  login: ({ autoLogin }) => loginOssNgbSession({ autoLogin }),
  clearSession: async (expectedSession) => {
    if (remoteSessionState.getOssNgbSession() === expectedSession) {
      remoteSessionState.clearOssNgbSession();
    }
  }
});
const mergedOnuWorkerId = `server-${process.pid}-${randomUUID().slice(0, 12)}`;
const MERGED_ONU_SYNC_LEASE_MS = 30 * 60 * 1000;
const mergedOnuSyncState = {
  running: false,
  operation: "",
  status: "idle",
  phase: "idle",
  totalOlts: 0,
  completedOlts: 0,
  networkRows: 0,
  nmseRows: 0,
  nmseTotal: 0,
  nmsePages: 0,
  nmseCompletedPages: 0,
  nmseWorkers: 0,
  nmseAttempt: 0,
  mergedRows: 0,
  conflicts: 0,
  error: "",
  startedAt: "",
  completedAt: "",
  revision: ""
};
const mergedOnuRecoveryState = {
  inspectedAt: "",
  runs: []
};
const resourceUserSync = createResourceUserSync({
  remote: {
    getUsers: ({ session, gridRank, maxPages, pageSize, maxConcurrentPages, onProgress }) => session.client.getUsers(session.auth, gridRank, { maxPages, pageSize, maxConcurrentPages, onProgress })
  },
  snapshots: {
    replaceComplete: replaceResourceUsers,
    replaceCheckpoint: replaceResourceUserCheckpoint
  }
});
const mergedOnuService = createMergedOnuService({
  readLocalUsers: ({ oltIp }) => getResourceUsers({ oltIp })
});
const onuQueryService = createOnuQueryService({
  getOnuStatusHistory,
  getPonPorts,
  getProject,
  listConfigTemplates,
  recordOnuStatusHistory,
  telnetReadOnlyOptionsForOlt,
  updatePonPortVlans,
  getOnuDataEnrichment: () => onuDataEnrichment
});
const {
  buildProjectConfigTemplates,
  buildStatus,
  buildUnregisteredConfigPlan,
  getOnuConfig,
  listAllUnregisteredOnus,
  listOnus,
  listRecentOnus,
  listUnregisteredOnus,
  refreshPonVlans
} = onuQueryService;

const onuDataEnrichment = createOnuDataEnrichment({
  getMergedOnuSnapshots,
  getResourceUsers,
  getProjectOnuAssignments,
  getProjectOnus,
  listOnus
});
const backupCleanupRuntime = createBackupCleanupRuntime({
  planCleanup: ({ now } = {}) => planDatabaseBackupCleanup({ now }),
  executeCleanup: ({ plan, confirmed } = {}) => executeDatabaseBackupCleanup({ plan, confirmed }),
  intervalMs: Number(process.env.OLT_BACKUP_CLEANUP_INTERVAL_MS) || undefined
});
const nmseBossRuntime = createNmseBossIncrementalRuntime({
  getState: getNmseBossSyncState,
  getSession: ensureNmseSession,
  applyChanges: applyNmseBossIncrementalChanges,
  replaceNameHistory: replaceNmseBossNameHistory,
  relogin: () => loginNmseSession(),
  clearSession: () => remoteSessionState.clearNmseSession()
});

function resourceTargetOlt(olts, oltId) {
  const target = olts.find((item) => item.id === String(oltId || ""));
  if (!target) {
    const error = new Error("OLT 不存在。");
    error.status = 404;
    throw error;
  }
  return target;
}

const resourceSyncScheduler = createResourceSyncScheduler({
  getTasks: getResourceSyncTasks,
  updateTask: updateResourceSyncTask,
  getTargetOlt: async (oltId) => resourceTargetOlt(await getOlts(), oltId),
  getNmseSession: ensureNmseSession,
  getGridRank: resourceGridRank,
  resourceUserSync,
  operations: {
    network: ({ idempotencyKey }) => runMergedOnuSourceSync("network", { idempotencyKey }),
    nmse: ({ idempotencyKey }) => runMergedOnuSourceSync("nmse", { idempotencyKey }),
    merge: ({ idempotencyKey }) => runMergedOnuManualMerge({ idempotencyKey }),
    full: ({ idempotencyKey }) => runMergedOnuSync({ idempotencyKey })
  },
  invalidateNmseSession: () => remoteSessionState.clearNmseSession(),
  invalidateOssSession: () => remoteSessionState.clearOssNgbSession()
});

function publicOssOlts(olts = []) {
  return olts.map((olt) => {
    const item = {
      resourceIp: olt.resourceIp,
      roomName: olt.roomName
    };
    if (olt.locationIp) item.locationIp = olt.locationIp;
    if (olt.name) item.name = olt.name;
    if (olt.vendor) item.vendor = olt.vendor;
    if (olt.model) item.model = olt.model;
    return item;
  });
}

function publicOlt(olt = {}) {
  const { readCommunity, telnetUsername, telnetPassword, ...safe } = olt;
  return safe;
}

async function readHistoricalOpticalForTarget({ target, coordinate, startDate, endDate } = {}) {
  const mapping = (await getResourceOltIpMappings()).find((item) => item.oltIp === target.host);
  if (!mapping) {
    const error = new Error("当前 OLT 尚未建立网管二期 IP 映射。");
    error.status = 404;
    throw error;
  }
  const session = await remoteHistorySession.ensure();
  const remote = session.olts.find((item) => item.resourceIp === mapping.resourceIp);
  if (!remote) {
    const error = new Error("当前网管二期会话未发现该 OLT，请核对组织、机房和 IP 映射。");
    error.status = 404;
    throw error;
  }
  try {
    return await session.client.readHistoricalOptical({
      oltCuid: remote.cuid,
      coordinate,
      startDate,
      endDate
    });
  } catch (error) {
    if (error?.status === 401) await remoteHistorySession.invalidate(session);
    throw error;
  }
}

const mergedOnuSyncRuntime = createMergedOnuSyncRuntime({
  state: mergedOnuSyncState,
  recoveryState: mergedOnuRecoveryState,
  workerId: mergedOnuWorkerId,
  leaseMs: MERGED_ONU_SYNC_LEASE_MS,
  remoteSessionState,
  mergedOnuService,
  resourceUserSync,
  getOlts,
  getResourceOltIpMappings,
  activeOssNgbSession,
  ensureOssNgbSession,
  loginNmseSession,
  resourceGridRank,
  runNmseBossIncremental: (options) => nmseBossRuntime.run(options),
  getNmseBossSyncState,
  backupDatabaseBeforeSync,
  replaceResourceUsersBatch,
  listRecoverableMergedOnuSyncRuns,
  beginMergedOnuSyncRun,
  claimMergedOnuSyncLease,
  renewMergedOnuSyncLease,
  updateMergedOnuSyncRuntime,
  getLatestMergedOnuSourceManifest,
  getMergedOnuDatasetStatus,
  getMergedOnuSyncRuns,
  getMergedOnuSourceStatus,
  getMergedOnuNetworkSource,
  getMergedOnuNmseSource,
  replaceMergedOnuNetworkSource,
  replaceMergedOnuNmseSource,
  persistMergedOnuManifest,
  recordMergedOnuSourceSyncSuccess,
  recordMergedOnuSyncFailure,
  syncMergedOnuDataset,
  cleanupDuplicateSnapshots: cleanupDuplicateSnapshotCoordinates
});
export const {
  publicSyncState: publicMergedOnuSyncState,
  refreshRecoveryState: refreshMergedOnuRecoveryState,
  runSourceSync: runMergedOnuSourceSync,
  runManualMerge: runMergedOnuManualMerge,
  runFullSync: runMergedOnuSync,
  syncError: mergedSyncError,
  syncErrorMessage: mergedSyncErrorMessage
} = mergedOnuSyncRuntime;

export {
  mergedOnuSyncRuntime,
  nmseBossRuntime,
  loginOssNgbSession,
  loginNmseSession,
  ensureOssNgbSession,
  ensureNmseSession
};

let customLanguageConfigProvider = null;
export function setPiAgentLanguageConfigProvider(provider) {
  customLanguageConfigProvider = provider;
}

export const piAgentEngine = createPiAgentEngine({
  getLanguageConfig: async () => {
    if (typeof customLanguageConfigProvider === "function") {
      return customLanguageConfigProvider();
    }
    if (process.env.OLT_LLM_ENDPOINT && process.env.OLT_LLM_MODEL && process.env.OLT_LLM_API_KEY) {
      return {
        endpoint: process.env.OLT_LLM_ENDPOINT,
        model: process.env.OLT_LLM_MODEL,
        apiKey: process.env.OLT_LLM_API_KEY
      };
    }
    return null;
  },
  getOlts: async () => getOlts({ includeSecrets: true }),
  getMergedOnuRecords: async () => getMergedOnuSnapshots(),
  getResourceUserRecords: async () => getResourceUsers(),
  getPonPorts: async () => getPonPorts(),
  getOnuList: async ({ oltId, board, pon, chassis, q }) => {
    const allOlts = await getOlts({ includeSecrets: true });
    const target = allOlts.find((o) => o.id === oltId) || allOlts[0];
    if (!target) return { rows: [] };
    const rows = await listOnus(target, { board, pon, chassis, search: q }, { includeResourceUsers: true, includeOfflineDetails: true, includeLastOnlineTime: true });
    return { rows };
  },
  getUnregisteredOnus: async ({ oltId }) => {
    const allOlts = await getOlts({ includeSecrets: true });
    const target = allOlts.find((o) => o.id === oltId) || allOlts[0];
    if (!target) return { rows: [] };
    return listUnregisteredOnus(target);
  },
  getOnuDetail: async ({ oltId, board, pon, onuId }) => {
    const allOlts = await getOlts({ includeSecrets: true });
    const target = allOlts.find((o) => o.id === oltId) || allOlts[0];
    if (!target) return null;
    const detail = await getOnuConfig(target, { board, pon, onuId });
    return detail.ok ? detail : null;
  },
  getOnuConfig: async (olt, query) => getOnuConfig(olt, query),
  getOnuStatusHistory: async ({ oltId, chassis, board, pon, onuId, days, limit }) => {
    return getOnuStatusHistory({ oltId, chassis, board, pon, onuId, days, limit });
  },
  getOnuDigitalTwin: async (query) => getOnuDigitalTwin(query),
  getPortExperience: async (query) => getPortExperience(query),
  runReadOnlyCliCommand: async ({ olt, command }) => {
    const creds = telnetReadOnlyOptionsForOlt(olt);
    const host = olt?.host;
    if (!host || !creds.username || !creds.password) {
      return {
        status: "credentials_missing",
        error: "目标 OLT 未配置 Telnet 访问凭据，无法执行 CLI 原生诊断。",
        oltId: olt?.id || ""
      };
    }
    try {
      const runResult = await loginAndRunReadOnlyCommands(
        {
          host,
          telnetPort: creds.port,
          telnetUsername: creds.username,
          telnetPassword: creds.password,
          vendor: olt.vendor
        },
        [command],
        {
          commandTimeoutMs: 12000,
          loginTimeoutMs: 15000,
          connectTimeoutMs: 8000
        }
      );
      const rawOutput = runResult.outputs?.[0] || "";
      return {
        status: "success",
        oltId: olt.id,
        vendor: olt.vendor,
        command,
        output: sanitizeCliOutput(rawOutput)
      };
    } catch (err) {
      return {
        status: "execution_error",
        error: err.message || "设备 CLI 只读查询超时或失败",
        command
      };
    }
  }
});

async function loadLocalTelnetEnv() {
  try {
    const text = await readFile(join(root, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(OLT_TELNET_USER|OLT_TELNET_PASSWORD|OLT_TELNET_PORT)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function telnetReadOnlyOptionsForOlt(olt = {}) {
  return {
    port: Number(process.env.OLT_TELNET_PORT || olt.telnetPort || 23),
    username: process.env.OLT_TELNET_USER || olt.telnetUsername || "",
    password: process.env.OLT_TELNET_PASSWORD || olt.telnetPassword || ""
  };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function openLocalTerminal() {
  if (process.platform !== "darwin") {
    return { ok: false, status: 501, error: "当前仅支持在 macOS 上打开 Terminal。" };
  }
  return new Promise((resolve) => {
    execFile("open", ["-a", "Terminal"], { timeout: 3000 }, (error) => {
      resolve({
        ok: !error,
        status: error ? 500 : 200,
        error: error?.message || ""
      });
    });
  });
}

async function handleApi(req, res, url) {
  const olts = await getOlts({ includeSecrets: true });
  const olt = olts.find((item) => item.id === (url.searchParams.get("oltId") || olts[0]?.id));

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const ponPorts = await getPonPorts();
    return json(res, 200, { version: appVersion, olts: olts.map(publicOlt), oidProfiles, ponPorts });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/dashboard/remediation-workdesk") {
    try {
      const roomName = String(url.searchParams.get("roomName") || "").trim();
      const service = createDashboardRemediationService({
        getOssResourceConfig,
        getOlts: async () => olts,
        getPonPorts,
        getMergedOnuSnapshots,
        getMergedOnuConflicts
      });
      const data = await service.getRemediationWorkdesk({ roomName });
      return json(res, 200, data);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || "加载排障工作台数据失败" });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, await buildStatus(olt));
  }
  if (req.method === "POST" && url.pathname === "/api/open-terminal") {
    const result = await openLocalTerminal();
    return json(res, result.status, result.ok ? { ok: true } : { ok: false, error: result.error });
  }
  if (req.method === "POST" && url.pathname === "/api/open-terminal-login") {
    const body = await readBody(req);
    const secretOlts = await getOlts({ includeSecrets: true });
    const requestedOltId = body.oltId || url.searchParams.get("oltId") || secretOlts[0]?.id;
    const targetOlt = secretOlts.find((item) => item.id === requestedOltId);
    const result = await openTerminalLogin(targetOlt);
    return json(res, result.status, result.ok ? { ok: true } : { ok: false, error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/onus") {
    if (!olt) return json(res, 404, { error: "OLT 不存在。" });
    const rows = await listOnus(olt, Object.fromEntries(url.searchParams), {
      includeResourceUsers: true,
      includeLastOnlineTime: true,
      includeOfflineDetails: true
    });
    try {
      await recordOnuStatusHistory({ oltId: olt.id, oltIp: olt.host, rows });
    } catch {
      // History is best-effort; it must not block the current read-only query.
    }
    return json(res, 200, rows);
  }
  if (req.method === "GET" && url.pathname === "/api/onu-config") {
    const secretOlts = await getOlts({ includeSecrets: true });
    const requestedOltId = url.searchParams.get("oltId") || olt?.id || secretOlts[0]?.id;
    const targetOlt = secretOlts.find((item) => item.id === requestedOltId) || olt;
    const result = await getOnuConfig(targetOlt, Object.fromEntries(url.searchParams));
    if (!result.ok) return json(res, result.status || 500, { error: result.error || "ONU 配置读取失败" });
    return json(res, 200, result);
  }
  if (req.method === "GET" && url.pathname === "/api/unregistered-onus") {
    const requestedOltId = url.searchParams.get("oltId");
    if (requestedOltId) {
      const targetOlt = olts.find((item) => item.id === requestedOltId) || olt;
      return json(res, 200, await listUnregisteredOnus(targetOlt));
    }
    return json(res, 200, await listAllUnregisteredOnus(olts));
  }
  if (req.method === "GET" && url.pathname === "/api/config-template-variables") {
    return json(res, 200, { rows: SUPPORTED_TEMPLATE_VARIABLES });
  }
  if (req.method === "GET" && url.pathname === "/api/config-templates") {
    const projects = await getProjects();
    const dbTemplates = await listConfigTemplates(Object.fromEntries(url.searchParams));
    return json(res, 200, { rows: [...dbTemplates, ...buildProjectConfigTemplates(projects)] });
  }
  if (req.method === "POST" && url.pathname === "/api/config-templates") {
    const body = await readBody(req);
    try {
      const saved = await saveConfigTemplate(body);
      return json(res, 200, { ok: true, template: saved });
    } catch (err) {
      return json(res, err.status || 400, { error: err.message });
    }
  }
  const configTemplateResetMatch = url.pathname.match(/^\/api\/config-templates\/([^/]+)\/reset$/);
  if (req.method === "POST" && configTemplateResetMatch) {
    try {
      const reset = await resetBuiltinConfigTemplate(decodeURIComponent(configTemplateResetMatch[1]));
      return json(res, 200, { ok: true, template: reset });
    } catch (err) {
      return json(res, err.status || 400, { error: err.message });
    }
  }
  const configTemplateIdMatch = url.pathname.match(/^\/api\/config-templates\/([^/]+)$/);
  if (configTemplateIdMatch) {
    const tplId = decodeURIComponent(configTemplateIdMatch[1]);
    if (req.method === "GET") {
      const tpl = await getConfigTemplate(tplId);
      if (!tpl) return json(res, 404, { error: "方案模板不存在。" });
      return json(res, 200, tpl);
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      try {
        const saved = await saveConfigTemplate({ ...body, id: tplId });
        return json(res, 200, { ok: true, template: saved });
      } catch (err) {
        return json(res, err.status || 400, { error: err.message });
      }
    }
    if (req.method === "DELETE") {
      try {
        const result = await deleteConfigTemplate(tplId);
        return json(res, 200, result);
      } catch (err) {
        return json(res, err.status || 400, { error: err.message });
      }
    }
  }
  if (req.method === "POST" && url.pathname === "/api/config-templates/import-docx") {
    return json(res, 501, {
      ok: false,
      error: "DOCX 模板导入尚未实现。请使用系统内置或自定义方案编辑器。"
    });
  }
  const configPlanMatch = url.pathname.match(/^\/api\/unregistered-onus\/([^/]+)\/config-plan$/);
  if (req.method === "POST" && configPlanMatch) {
    const body = await readBody(req);
    const requestedOltId = body.oltId || url.searchParams.get("oltId");
    const targetOlt = olts.find((item) => item.id === requestedOltId) || olt;
    const result = await buildUnregisteredConfigPlan(targetOlt, { ...body, id: decodeURIComponent(configPlanMatch[1]) });
    if (!result.ok) return json(res, result.status || 500, { error: result.error || "配置方案生成失败" });
    return json(res, 200, result);
  }
  if (req.method === "GET" && url.pathname === "/api/recent-onus") {
    return json(res, 200, await listRecentOnus(olt, Object.fromEntries(url.searchParams)));
  }
  if (await handleOltAdminRoutes(req, res, url, {
    getOlts,
    replaceOlts,
    publicOlt,
    getPonPorts,
    replacePonPorts,
    refreshPonVlans,
    readBody,
    json,
    olts
  })) {
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/resource-management/config") {
    return json(res, 200, { ...(await getResourceManagementConfig()), loggedIn: Boolean(remoteSessionState.getNmseSession()) });
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/resource-management/config") {
    const body = await readBody(req);
    try {
      const config = await saveResourceManagementConfig(body);
      if (typeof body.migrationMasterPassword === "string" && body.migrationMasterPassword) {
        remoteSessionState.setNmseMigrationMasterPassword(body.migrationMasterPassword);
      }
      remoteSessionState.clearNmseSession();
      return json(res, 200, { ok: true, ...config, loggedIn: false });
    } catch (error) {
      return json(res, error.status || 500, { ok: false, error: error.message });
    }
  }
  if (await handleOssResourceRoutes(req, res, url, {
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
    closeOssNgbHistorySession: () => remoteHistorySession.close(),
    invalidateOssNgbHistorySession: (session) => remoteHistorySession.invalidate(session),
    publicOssOlts,
    resourceTargetOlt,
    readHistoricalOpticalForTarget,
    olts,
    getOssResourcePassword
  })) {
    return;
  }
  if (await handleResourceSyncRoutes(req, res, url, {
    getResourceSyncTasks,
    createResourceSyncTask,
    updateResourceSyncTask,
    deleteResourceSyncTask,
    resourceSyncScheduler,
    readBody,
    json,
    createTaskId: randomUUID
  })) {
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-management/login") {
    try {
      const body = await readBody(req);
      const session = await loginNmseSession({ password: body.password, migrationMasterPassword: body.migrationMasterPassword });
      return json(res, 200, { ok: true, oltCount: session.olts.length });
    } catch (error) {
      remoteSessionState.clearNmseSession();
      return json(res, error.status || 502, { ok: false, error: error.message || "资源管理登录失败。" });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/admin/resource-management/logout") {
    remoteSessionState.clearNmseSession();
    remoteSessionState.clearNmseMigrationMasterPassword();
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/bot-ai/config") {
    try {
      const config = await getBotAiConfig();
      return json(res, 200, { ok: true, ...config });
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message });
    }
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/bot-ai/config") {
    try {
      const body = await readBody(req);
      const config = await saveBotAiConfig(body);
      return json(res, 200, { ok: true, ...config });
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/admin/wizard/defaults") {
    try {
      const realOlts = await getOlts({ includeSecrets: true });
      const sample = realOlts.find((o) => o.readCommunity && o.readCommunity !== "public") || realOlts[0];
      return json(res, 200, {
        ok: true,
        defaultCommunity: sample?.readCommunity || "bdw0256",
        defaultTelnetUser: sample?.telnetUsername || "HouJie",
        olts: realOlts.map((o) => ({
          ...publicOlt(o),
          readCommunity: o.readCommunity || "",
          telnetUsername: o.telnetUsername || ""
        }))
      });
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message });
    }
  }
  if (await handleMergedOnuRoutes(req, res, url, {
    publicMergedOnuSyncState,
    getMergedOnuSyncRuns,
    getMergedOnuConflicts,
    getMergedOnuDatasetStatus,
    getMergedOnuSnapshots,
    getNmseBossSyncState,
    initializeNmseBossSyncState,
    resetNmseBossNameHistory,
    backupDatabaseBeforeSync,
    runMergedOnuSourceSync,
    runMergedOnuManualMerge,
    runMergedOnuSync,
    cleanupDuplicateSnapshots: cleanupDuplicateSnapshotCoordinates,
    resourceTargetOlt,
    mergedSyncError,
    mergedSyncErrorMessage,
    readBody,
    json,
    olts
  })) {
    return;
  }
  if (await handleResourceManagementRoutes(req, res, url, {
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
    olts,
    clearNmseSession: () => remoteSessionState.clearNmseSession()
  })) {
    return;
  }
  if (await handleBackupRoutes(req, res, url, {
    exportDatabaseBackup,
    restoreDatabaseBackup,
    validateDatabaseBackup,
    createEncryptedBackupContainer,
    decryptEncryptedBackupContainer,
    readEncryptedBackupPasswordBody,
    readEncryptedBackupContainer,
    readBinaryBody,
    encryptedBackupError,
    encryptedBackupPasswordHeader: ENCRYPTED_BACKUP_PASSWORD_HEADER,
    backupCleanupRuntime,
    readBody,
    json,
    clearRemoteSessions: () => {
      remoteSessionState.clearNmseSession();
      remoteSessionState.clearOssNgbSession();
      return remoteHistorySession.close();
    }
  })) {
    return;
  }
  if (await handleProjectRoutes(req, res, url, {
    getProjects,
    createProject,
    updateProject,
    deleteProject,
    listProjectOnus: onuDataEnrichment.listProjectOnus,
    addProjectOnu,
    updateProjectOnuNote,
    deleteProjectOnu,
    readBody,
    json,
    olts
  })) {
    return;
  }
  if (await handleSnmpAdminRoutes(req, res, url, {
    readBody,
    json,
    olts,
    defaultOlt: olt,
    publicOidProfiles,
    snmpGet,
    snmpWalk,
    addSnmpProbe,
    getSnmpHistory,
    getAdminEvents
  })) {
    return;
  }
  if (await handlePiAgentRoutes(req, res, url, { piAgentEngine, saveBotAiConfig })) {
    return;
  }
  return json(res, 404, { error: "API not found" });
}

async function serveStatic(req, res, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(staticDir, rawPath));
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const type = mime[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(filePath).on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end("Static file read failed");
  }).pipe(res);
}

await loadLocalTelnetEnv();

export async function startServer(options = {}) {
  const listenHost = options.host || process.env.HOST || "127.0.0.1";
  const listenPort = Number(options.port ?? process.env.PORT ?? 8787);
  const auth = createLocalAuth({
    dataDir: options.authDataDir || dataDir,
    password: options.authPassword,
    sessionTtlMs: options.authSessionTtlMs,
    testBypass: shouldUseAuthBypass(options)
  });
  await auth.load();
  const loopbackHost = new Set(["127.0.0.1", "::1", "localhost"]).has(listenHost.toLowerCase());
  if (!loopbackHost && !auth.isTestBypass) {
    if (options.authRequired === false) {
      throw new Error("非回环地址禁止关闭本地登录认证。");
    }
    if (!(await auth.isEnabled())) {
      throw new Error("非回环地址禁止使用免登录调试模式。");
    }
    if (!(await auth.isConfigured())) {
      throw new Error("非回环地址启动前必须先配置本地登录密码。");
    }
  }
  const gateway = await createLocalOltDataGateway();
  backupCleanupRuntime.start();
  await refreshMergedOnuRecoveryState();
  await resourceSyncScheduler.initialize();
  const serverRequestHandler = createServerRequestHandler({
    auth,
    handleAuthRoutes: (req, res, url) => handleLocalAuthRoutes(req, res, url, { auth, readBody, json }),
    handleApi,
    serveStatic,
    json
  });
  const server = http.createServer(serverRequestHandler);
  server.once("close", () => {
    backupCleanupRuntime.stop();
    void remoteHistorySession.close().catch(() => {});
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : listenPort;
      resolve({ server, host: listenHost, port: actualPort, url: `http://${listenHost}:${actualPort}`, gateway, auth });
    });
  });
}

export async function createLocalOltDataGateway() {
  await initDb();
  return createOltDataGateway({
    getOlts,
    getUsers: getMergedOnuSnapshots,
    getPonPorts,
    getDatasetRevision: async () => {
      const status = await getMergedOnuDatasetStatus();
      return status.revision || "dataset:merged-unsynced";
    },
    listOnus,
    getOnuStatusHistory,
    readHistoricalOptical: async ({ oltId, coordinate, startDate, endDate }) => {
      const target = resourceTargetOlt(await getOlts({ includeSecrets: true }), oltId);
      return readHistoricalOpticalForTarget({ target, coordinate, startDate, endDate });
    }
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const started = await startServer();
  console.log(`OLT manager listening on ${started.url}`);
}
