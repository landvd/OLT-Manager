const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } = require("electron");
const { createFeishuStateStore } = require("./feishu-state-store.cjs");
const { createFeishuCredentialStore } = require("./feishu-credential-store.cjs");
const { createWecomStateStore } = require("./wecom-state-store.cjs");
const { createWecomCredentialStore } = require("./wecom-credential-store.cjs");
const { createCombinedBackupService } = require("./combined-backup.cjs");
const {
  applyStagedUpdate,
  stageLocalUpdate,
  spawnUpdateApplier,
} = require("./update-manager.cjs");
const { createFeishuProductionRuntime } = require("../src/feishu/production-runtime.cjs");
const { createWecomProductionRuntime } = require("../src/wecom/production-runtime.cjs");

let mainWindow;
let tray;
let serverHandle;
let runtimeLifecycle;
let runtimeShutdownPromise;
let feishuSdk;
let languageProvider;
let feishuStateStore;
let feishuCredentialStore;
let feishuSubsystem;
let wecomStateStore;
let wecomCredentialStore;
let wecomSubsystem;
let wecomInitialized = false;
let combinedBackupService;
let databaseModule;
let feishuInitialized = false;
let serverPiAgentEngine;
const terminalSessions = new Map();
let stagedManualUpdate;
let pendingShowMainWindow = false;

async function chooseManualUpdate() {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "选择手动增量更新包（ZIP 压缩包或 latest.json）",
    properties: ["openFile"],
    filters: [{ name: "OLT Manager 更新包 (*.zip, latest.json)", extensions: ["zip", "json"] }]
  });
  if (picked.canceled || !picked.filePaths[0]) return { cancelled: true, available: false };
  const staged = await stageLocalUpdate({
    manifestPath: picked.filePaths[0],
    currentVersion: app.getVersion(),
    userDataPath: app.getPath("userData")
  });
  stagedManualUpdate = staged.available ? staged : undefined;
  return {
    ...staged,
    packageName: path.basename(picked.filePaths[0])
  };
}

async function installManualUpdate() {
  if (!stagedManualUpdate?.stageRoot) throw new Error("请先选择并校验手动增量更新包。");
  const launcher = spawnUpdateApplier({
    stageRoot: stagedManualUpdate.stageRoot,
    targetRoot: appRoot(),
    parentPid: process.pid
  });
  const version = stagedManualUpdate.version;
  stagedManualUpdate = undefined;
  setImmediate(() => {
    void closeRuntimeResources().then(() => app.exit(0));
  });
  return { available: true, version, restarting: true, updaterPid: launcher.pid };
}

function parseApplyUpdateArgs(argv = process.argv) {
  const index = argv.indexOf("--apply-update");
  if (index < 0) return null;
  const stageRoot = argv[index + 1];
  const targetRoot = argv[index + 2];
  const parentPid = Number(argv[index + 3]);
  if (!stageRoot || !targetRoot || !Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error("更新启动参数不完整。");
  }
  return { stageRoot, targetRoot, parentPid };
}

async function runApplyUpdate(request) {
  try {
    await applyStagedUpdate(request);
    app.exit(0);
  } catch (error) {
    appendDiagnostics("update apply failed", error?.stack || error?.message || String(error));
    app.exit(1);
  }
}

const TRAY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect x="1" y="1" width="14" height="14" rx="3" fill="#2563eb"/>
  <path d="M4 5h8v2H4zm0 4h5v2H4z" fill="#fff"/>
</svg>`;

function appRoot() {
  return app.getAppPath();
}

function configureRuntimePaths() {
  const root = appRoot();
  const userData = app.getPath("userData");
  const sqliteExe = process.platform === "win32" ? "sqlite3.exe" : "sqlite3";
  const bundledSqliteCandidates = [
    path.join(root, "bin", process.platform, sqliteExe),
    path.join(process.resourcesPath || "", "bin", process.platform, sqliteExe)
  ];
  const bundledSqlite = bundledSqliteCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  process.env.OLT_MANAGER_APP_ROOT = root;
  process.env.OLT_MANAGER_STATIC_DIR = path.join(root, "dist");
  process.env.OLT_MANAGER_SEED_DIR = path.join(root, "data");
  process.env.OLT_MANAGER_DATA_DIR = path.join(userData, "data");
  if (bundledSqlite) {
    process.env.OLT_MANAGER_SQLITE_BIN = bundledSqlite;
  }
}

function configureFeishuRuntimeDependencies() {
  const candidates = [
    path.join(process.resourcesPath || "", "feishu-runtime", "node_modules"),
    path.join(appRoot(), "build", "feishu-runtime", "node_modules")
  ];
  const runtimeNodeModules = candidates.find((candidate) => fs.existsSync(candidate));
  if (!runtimeNodeModules) return;
  process.env.NODE_PATH = [runtimeNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  appendDiagnostics("Feishu runtime dependencies", runtimeNodeModules);
}

function diagnosticsPath() {
  return path.join(app.getPath("userData"), "startup-diagnostics.log");
}

function appendDiagnostics(message, detail = "") {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    const text = [
      `[${new Date().toISOString()}] ${message}`,
      detail ? String(detail) : "",
      ""
    ].join("\n");
    fs.appendFileSync(diagnosticsPath(), text, "utf8");
  } catch {
    // Startup diagnostics must never prevent the app from showing its real error.
  }
}

function createTrayIcon() {
  const trayIconPath = path.join(appRoot(), "assets", "generated", "olt-manager-16.png");
  const packagedIcon = nativeImage.createFromPath(trayIconPath);
  if (!packagedIcon.isEmpty()) return packagedIcon.resize({ width: 16, height: 16 });
  const executableIcon = nativeImage.createFromPath(process.execPath);
  if (!executableIcon.isEmpty()) return executableIcon.resize({ width: 16, height: 16 });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(TRAY_ICON_SVG).toString("base64")}`;
  return nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingShowMainWindow = true;
    return;
  }
  pendingShowMainWindow = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("OLT Manager");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示 OLT Manager", click: showMainWindow },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]));
  tray.on("click", showMainWindow);
}

async function startLocalServer() {
  configureRuntimePaths();
  configureFeishuRuntimeDependencies();
  appendDiagnostics("runtime paths", JSON.stringify({
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    osRelease: os.release(),
    appRoot: appRoot(),
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
    dataDir: process.env.OLT_MANAGER_DATA_DIR,
    seedDir: process.env.OLT_MANAGER_SEED_DIR,
    sqliteBin: process.env.OLT_MANAGER_SQLITE_BIN || "",
    sqliteCandidates: [
      path.join(appRoot(), "bin", process.platform, process.platform === "win32" ? "sqlite3.exe" : "sqlite3"),
      path.join(process.resourcesPath || "", "bin", process.platform, process.platform === "win32" ? "sqlite3.exe" : "sqlite3")
    ]
  }, null, 2));
  const serverModuleUrl = pathToFileURL(path.join(appRoot(), "src", "server.mjs")).href;
  const lifecycleModuleUrl = pathToFileURL(path.join(appRoot(), "src", "runtime-lifecycle.mjs")).href;
  const { createRuntimeLifecycle } = await import(lifecycleModuleUrl);
  runtimeLifecycle ??= createRuntimeLifecycle({ closeTimeoutMs: 1_500 });
  const serverModule = await import(serverModuleUrl);
  const { startServer, setPiAgentLanguageConfigProvider, piAgentEngine } = serverModule;
  serverPiAgentEngine = piAgentEngine;
  if (typeof setPiAgentLanguageConfigProvider === "function") {
    setPiAgentLanguageConfigProvider(async () => {
      try {
        await ensureCombinedBackupService();
        const current = await feishuStateStore?.read?.();
        const piAgentLanguage = current?.piAgentLanguage || {};
        const legacyLanguage = current?.language || {};
        const language = piAgentLanguage.endpoint && piAgentLanguage.model && piAgentLanguage.credentialReference
          ? piAgentLanguage
          : !piAgentLanguage.endpoint && !piAgentLanguage.model && !piAgentLanguage.credentialReference &&
              legacyLanguage.endpoint && legacyLanguage.model && legacyLanguage.credentialReference
            ? legacyLanguage
            : {};
        if (!language.endpoint || !language.model || !language.credentialReference) return null;
        const apiKey = await feishuCredentialStore?.readSecret?.(language.credentialReference);
        return {
          endpoint: language.endpoint,
          model: language.model,
          apiKey,
          format: language.format || "chat-completions"
        };
      } catch {
        return null;
      }
    });
  }
  return runtimeLifecycle.start(() => startServer({
    host: "127.0.0.1",
    port: 8787
  }));
}

async function loadModule(relativePath) {
  return import(pathToFileURL(path.join(appRoot(), relativePath)).href);
}

async function ensureCombinedBackupService() {
  if (combinedBackupService) return;
  databaseModule ??= await loadModule(path.join("src", "db.mjs"));
  feishuStateStore ??= createFeishuStateStore({
    dataDirectory: app.getPath("userData"),
    safeStorage
  });
  feishuCredentialStore ??= createFeishuCredentialStore({
    dataDirectory: app.getPath("userData"),
    safeStorage
  });
  combinedBackupService = createCombinedBackupService({
    dataDirectory: process.env.OLT_MANAGER_DATA_DIR,
    feishuDataDirectory: app.getPath("userData"),
    safeStorage,
    exportDatabaseBackup: databaseModule.exportDatabaseBackup,
    validateDatabaseBackup: databaseModule.validateDatabaseBackup,
    restoreDatabaseBackup: databaseModule.restoreDatabaseBackup,
    createStateStore: createFeishuStateStore,
    createCredentialStore: createFeishuCredentialStore
  });
}

async function initializeFeishu() {
  if (feishuInitialized) return;
  const [{ createFeishuSubsystem }, { createInProcessFeishuGateway }, { createFeishuQueryApplication }, languageProviderModule, jevLanguageProviderModule] = await Promise.all([
    loadModule(path.join("src", "feishu", "subsystem.mjs")),
    loadModule(path.join("src", "feishu", "gateway-contract.mjs")),
    loadModule(path.join("src", "feishu", "application.mjs")),
    loadModule(path.join("src", "feishu", "production-language-provider.mjs")),
    loadModule(path.join("src", "feishu", "jev-language-provider.mjs"))
  ]);
  languageProvider ??= languageProviderModule;
  await ensureCombinedBackupService();
  const gateway = createInProcessFeishuGateway({ gateway: serverHandle.gateway });
  feishuSubsystem ??= createFeishuSubsystem({
    stateStore: feishuStateStore,
    gateway,
    runtimeFactory: ({ gateway: runtimeGateway, stateStore: runtimeStateStore }) => {
      let runtime;
      const interpret = async (input) => {
        const current = await runtimeStateStore.read();
        const language = current?.language || {};
        const useJev = jevLanguageProviderModule.isJevProviderName(language.providerName);
        if (language.provider !== "production" || (!useJev && !language.endpoint) || !language.model || !language.credentialReference) {
          throw new Error("生产语言 provider 配置不完整");
        }
        const provider = useJev
          ? jevLanguageProviderModule.createJevLanguageProvider({
              model: language.model,
              credentialReference: language.credentialReference,
              readSecret: (reference) => feishuCredentialStore.readSecret(reference)
            })
          : languageProvider.createProductionLanguageProvider({
              providerName: language.providerName,
              endpoint: language.endpoint,
              model: language.model,
              format: language.format,
              credentialReference: language.credentialReference,
              readSecret: (reference) => feishuCredentialStore.readSecret(reference)
            });
        return provider(input);
      };
      const application = createFeishuQueryApplication({
        stateStore: runtimeStateStore,
        gateway: runtimeGateway,
        interpret,
        piAgentEngine: serverPiAgentEngine,
        send: (chatId, reply, options) => runtime.sendReply(chatId, reply, options)
      });
      const dispatch = async ({ kind, event }) => {
        return kind === "message"
          ? application.handleMessage(event)
          : application.handleCallback(event);
      };
      runtime = createFeishuProductionRuntime({
        sdk: feishuSdk ??= require("@larksuiteoapi/node-sdk"),
        readSecret: (reference) => feishuCredentialStore.readSecret(reference),
        onMessage: dispatch,
        log: (message, detail) => appendDiagnostics(message, detail)
      });
      return runtime;
    }
  });
  try {
    await feishuSubsystem.initialize();
  } catch (err) {
    console.warn("[Feishu] 初始化失败，可能 safeStorage 密钥已变动，将使用默认/数据库配置:", err?.message || err);
  }

  try {
    databaseModule ??= await loadModule(path.join("src", "db.mjs"));
    const dbConfig = await databaseModule?.getBotAiConfig?.();
    if (dbConfig) {
      const currentState = feishuSubsystem.status()?.state;
      let appSecretValid = false;
      if (currentState?.app?.credentialReference) {
        try {
          const s = await feishuCredentialStore.readSecret(currentState.app.credentialReference);
          if (s) appSecretValid = true;
        } catch {}
      }
      if (!appSecretValid && dbConfig.feishuAppId && dbConfig.feishuAppSecret) {
        const ref = await feishuCredentialStore.writeSecret(dbConfig.feishuAppSecret, "feishu-app-secret");
        await feishuSubsystem.configureApp({ appId: dbConfig.feishuAppId, credentialReference: ref });
      }

      let langValid = false;
      if (currentState?.language?.credentialReference) {
        try {
          const s = await feishuCredentialStore.readSecret(currentState.language.credentialReference);
          if (s) langValid = true;
        } catch {}
      }
      if (!langValid && dbConfig.jevModel && dbConfig.jevApiKey) {
        const ref = await feishuCredentialStore.writeSecret(dbConfig.jevApiKey, "feishu-jev-key");
        await feishuSubsystem.configureLanguage({
          provider: "production",
          providerName: "jev",
          endpoint: dbConfig.jevEndpoint || "",
          model: dbConfig.jevModel,
          format: "responses",
          credentialReference: ref
        });
      }

      let piValid = false;
      if (currentState?.piAgentLanguage?.credentialReference) {
        try {
          const s = await feishuCredentialStore.readSecret(currentState.piAgentLanguage.credentialReference);
          if (s) piValid = true;
        } catch {}
      }
      if (!piValid && dbConfig.piModel && dbConfig.piApiKey) {
        const ref = await feishuCredentialStore.writeSecret(dbConfig.piApiKey, "feishu-pi-key");
        await feishuSubsystem.configurePiAgentLanguage({
          providerName: "pi-agent",
          endpoint: dbConfig.piEndpoint || "",
          model: dbConfig.piModel,
          format: "chat-completions",
          credentialReference: ref
        });
      }

      if (dbConfig.feishuEnabled && !feishuSubsystem.status().enabled) {
        const updated = feishuSubsystem.status()?.state;
        if (updated?.app?.appId && updated?.app?.credentialReference && productionFeishuProviderConfigured(updated)) {
          await feishuSubsystem.enable({
            appId: updated.app.appId,
            credentialReference: updated.app.credentialReference
          }).catch((e) => console.warn("[Feishu] 自愈启动失败:", e?.message || e));
        }
      }
    }
  } catch (err) {
    console.warn("[Feishu] 从 SQLite 自愈配置失败:", err?.message || err);
  }
  feishuInitialized = true;
}

async function syncBotAiConfigToDb(patch = {}) {
  try {
    databaseModule ??= await loadModule(path.join("src", "db.mjs"));
    if (typeof databaseModule?.saveBotAiConfig === "function") {
      await databaseModule.saveBotAiConfig(patch);
    }
  } catch (err) {
    console.warn("[BotAi] 同步配置到数据库失败:", err?.message || err);
  }
}

async function readFeishuSettings() {
  try {
    await initializeFeishu();
  } catch (err) {
    console.warn("[Feishu] initialize error:", err?.message || err);
  }
  let status = null;
  try {
    status = feishuSubsystem?.status();
  } catch {}
  const settings = status ? publicFeishuSettings(status) : {
    enabled: false,
    configured: false,
    connection: { state: "stopped", lastError: null },
    appId: "",
    credentialConfigured: false,
    languageProvider: "production",
    languageProviderName: "",
    languageEndpoint: "",
    languageModel: "",
    languageFormat: "responses",
    languageApiKeyConfigured: false,
    languageProviderReady: false,
    piAgentLanguageProviderName: "",
    piAgentLanguageEndpoint: "",
    piAgentLanguageModel: "",
    piAgentLanguageFormat: "chat-completions",
    piAgentLanguageApiKeyConfigured: false
  };

  let dbConfig = null;
  try {
    databaseModule ??= await loadModule(path.join("src", "db.mjs"));
    dbConfig = await databaseModule?.getBotAiConfig?.();
  } catch {}

  if (status?.state?.app?.credentialReference) {
    try {
      settings.appSecret = await feishuCredentialStore.readSecret(status.state.app.credentialReference);
    } catch {
      settings.appSecret = "";
    }
  }
  if (!settings.appSecret && dbConfig?.feishuAppSecret) {
    settings.appSecret = dbConfig.feishuAppSecret;
  }
  if (!settings.appId && dbConfig?.feishuAppId) {
    settings.appId = dbConfig.feishuAppId;
  }

  if (status.state.language?.credentialReference) {
    try {
      settings.languageApiKey = await feishuCredentialStore.readSecret(status.state.language.credentialReference);
    } catch {
      settings.languageApiKey = "";
    }
  }
  if (!settings.languageApiKey && dbConfig?.jevApiKey) {
    settings.languageApiKey = dbConfig.jevApiKey;
  }
  if (!settings.languageEndpoint && dbConfig?.jevEndpoint) {
    settings.languageEndpoint = dbConfig.jevEndpoint;
  }
  if (!settings.languageModel && dbConfig?.jevModel) {
    settings.languageModel = dbConfig.jevModel;
  }

  if (status.state.piAgentLanguage?.credentialReference) {
    try {
      settings.piAgentLanguageApiKey = await feishuCredentialStore.readSecret(status.state.piAgentLanguage.credentialReference);
    } catch {
      settings.piAgentLanguageApiKey = "";
    }
  }
  if (!settings.piAgentLanguageApiKey && dbConfig?.piApiKey) {
    settings.piAgentLanguageApiKey = dbConfig.piApiKey;
  }
  if (!settings.piAgentLanguageEndpoint && dbConfig?.piEndpoint) {
    settings.piAgentLanguageEndpoint = dbConfig.piEndpoint;
  }
  if (!settings.piAgentLanguageModel && dbConfig?.piModel) {
    settings.piAgentLanguageModel = dbConfig.piModel;
  }

  return settings;
}

async function exportFeishuCombinedBackup() {
  await ensureCombinedBackupService();
  return new Uint8Array(await combinedBackupService.exportBackup());
}

async function resetFeishuRuntimeForRestore() {
  try {
    await feishuSubsystem?.stop?.();
  } catch {
    // A corrupted or cross-platform state must not block local SQLite restore.
  }
    feishuSubsystem = undefined;
    feishuInitialized = false;
}

async function restoreFeishuCombinedBackup(_event, value = {}) {
  await ensureCombinedBackupService();
  await resetFeishuRuntimeForRestore();
  return combinedBackupService.restoreBackup(Buffer.from(value.bytes || []), { confirmed: value.confirmed === true });
}

async function restoreSqliteBackup(_event, value = {}) {
  if (value.confirmed !== true) throw new Error("还原 SQLite 备份需要明确确认。");
  await ensureCombinedBackupService();
  await databaseModule.restoreDatabaseBackup(Buffer.from(value.bytes || []));
  return { warnings: ["仅恢复了 SQLite 数据；Feishu 加密状态未变更。"] };
}

function publicFeishuSettings(status) {
  const language = status.state.language || {};
  return {
    enabled: status.enabled,
    configured: status.configured,
    connection: status.connection,
    appId: status.state.app.appId,
    credentialConfigured: Boolean(status.state.app.credentialReference),
    languageProvider: language.provider,
    languageProviderName: language.providerName || "",
    languageEndpoint: language.endpoint || "",
    languageModel: language.model || "",
    languageFormat: language.format || "chat-completions",
    languageApiKeyConfigured: Boolean(language.credentialReference),
    languageProviderReady: productionFeishuProviderConfigured(status.state),
    piAgentLanguageProviderName: status.state.piAgentLanguage?.providerName || "",
    piAgentLanguageEndpoint: status.state.piAgentLanguage?.endpoint || "",
    piAgentLanguageModel: status.state.piAgentLanguage?.model || "",
    piAgentLanguageFormat: status.state.piAgentLanguage?.format || "chat-completions",
    piAgentLanguageApiKeyConfigured: Boolean(status.state.piAgentLanguage?.credentialReference)
  };
}

function productionFeishuProviderConfigured(state) {
  const language = state?.language || {};
  return language.provider === "production" &&
    Boolean((isJevLanguageProviderName(language.providerName) || language.endpoint) &&
      language.model && language.format && language.credentialReference);
}

function isJevLanguageProviderName(value) {
  const name = String(value ?? "").trim().toLowerCase();
  return name === "jev" || name === "typesafe jev" || name === "typesafe-ai jev";
}

function normalizeFeishuAppId(appId, current) {
  const normalizedAppId = String(appId ?? current.app.appId ?? "").trim();
  if (!/^cli_[0-9a-fA-F]{16}$/.test(normalizedAppId)) {
    throw new Error("请输入有效的飞书APP ID（cli_ 开头的 16 位标识）。");
  }
  return normalizedAppId;
}

async function configureFeishuCredentials(_event, { appId, appSecret } = {}) {
  await initializeFeishu();
  const current = feishuSubsystem.status().state;
  const normalizedAppId = normalizeFeishuAppId(appId, current);
  let credentialReference = current.app.credentialReference;
  if (String(appSecret ?? "").trim()) {
    credentialReference = await feishuCredentialStore.writeSecret(appSecret);
  }
  if (!credentialReference) throw new Error("首次保存飞书机器人配置必须填写 APP SECRET。");
  const result = publicFeishuSettings(await feishuSubsystem.configure({
    appId: normalizedAppId,
    credentialReference,
    language: current.language
  }));
  await syncBotAiConfigToDb({
    feishuAppId: normalizedAppId,
    ...(appSecret ? { feishuAppSecret: String(appSecret).trim() } : {})
  });
  return result;
}

async function configureFeishuLanguageProvider(_event, {
  languageProviderName,
  languageEndpoint,
  languageModel,
  languageFormat,
  languageApiKey
} = {}) {
  await initializeFeishu();
  const current = feishuSubsystem.status().state;
  if (!current.app.appId || !current.app.credentialReference) {
    throw new Error("请先保存飞书APP ID和APP SECRET。");
  }
  const language = current.language || {};
  const providerName = String(languageProviderName || language.providerName || "生产语言 provider").trim();
  const useJev = isJevLanguageProviderName(providerName);
  const endpoint = useJev
    ? String(languageEndpoint || language.endpoint || "").trim()
    : languageProvider.normalizeLanguageProviderEndpoint(languageEndpoint || language.endpoint);
  const model = String(languageModel || language.model || (useJev ? "jev-latest" : "")).trim();
  if (!model) throw new Error("请输入大模型默认模型。");
  const format = useJev
    ? (["chat-completions", "responses"].includes(languageFormat || language.format)
        ? (languageFormat || language.format)
        : "responses")
    : languageProvider.normalizeProviderFormat({
        providerName,
        endpoint,
        model,
        format: languageFormat || language.format
      });
  let languageCredentialReference = language.credentialReference;
  if (String(languageApiKey ?? "").trim()) {
    languageCredentialReference = await feishuCredentialStore.writeSecret(languageApiKey, "feishu-provider-key");
  }
  if (!languageCredentialReference) throw new Error("首次保存大模型配置必须填写 API KEY。");
  const nextLanguage = {
    ...language,
    provider: "production",
    providerName,
    endpoint,
    model,
    format,
    credentialReference: languageCredentialReference,
    syntheticDatasetAttestation: null
  };
  const hasPiAgentLanguage = current.piAgentLanguage?.endpoint &&
    current.piAgentLanguage?.model && current.piAgentLanguage?.credentialReference;
  const shouldMigrateLegacyPiAgentLanguage = !hasPiAgentLanguage &&
    !isJevLanguageProviderName(language.providerName) &&
    language.endpoint && language.model && language.credentialReference;
  const piAgentLanguage = shouldMigrateLegacyPiAgentLanguage
    ? {
        providerName: language.providerName,
        endpoint: language.endpoint,
        model: language.model,
        format: language.format,
        credentialReference: language.credentialReference
      }
    : current.piAgentLanguage;
  const result = publicFeishuSettings(await feishuSubsystem.configure({
    appId: current.app.appId,
    credentialReference: current.app.credentialReference,
    language: nextLanguage,
    ...(piAgentLanguage ? { piAgentLanguage } : {})
  }));
  await syncBotAiConfigToDb({
    jevProviderName: providerName,
    jevEndpoint: endpoint,
    jevModel: model,
    jevFormat: format,
    ...(languageApiKey ? { jevApiKey: String(languageApiKey).trim() } : {})
  });
  return result;
}

async function configurePiAgentLanguageProvider(_event, {
  piAgentLanguageProviderName,
  piAgentLanguageEndpoint,
  piAgentLanguageModel,
  piAgentLanguageFormat,
  piAgentLanguageApiKey
} = {}) {
  await initializeFeishu();
  const current = feishuSubsystem.status().state;
  if (!current.app.appId || !current.app.credentialReference) {
    throw new Error("请先保存飞书APP ID和APP SECRET。");
  }
  const endpoint = languageProvider.normalizeLanguageProviderEndpoint(
    piAgentLanguageEndpoint || current.piAgentLanguage?.endpoint
  );
  const model = String(piAgentLanguageModel || current.piAgentLanguage?.model || "").trim();
  if (!model) throw new Error("请输入 Pi Agent 原大模型默认模型。");
  const format = languageProvider.normalizeLanguageProviderFormat(
    piAgentLanguageFormat || current.piAgentLanguage?.format
  );
  let credentialReference = current.piAgentLanguage?.credentialReference || "";
  if (String(piAgentLanguageApiKey ?? "").trim()) {
    credentialReference = await feishuCredentialStore.writeSecret(piAgentLanguageApiKey, "pi-agent-provider-key");
  }
  if (!credentialReference) throw new Error("首次保存 Pi Agent 原大模型配置必须填写 API KEY。");
  const piAgentLanguage = {
    ...(current.piAgentLanguage || {}),
    providerName: String(piAgentLanguageProviderName || current.piAgentLanguage?.providerName || "").trim(),
    endpoint,
    model,
    format,
    credentialReference
  };
  const result = publicFeishuSettings(await feishuSubsystem.configure({
    appId: current.app.appId,
    credentialReference: current.app.credentialReference,
    language: current.language,
    piAgentLanguage
  }));
  await syncBotAiConfigToDb({
    piProviderName: piAgentLanguage.providerName,
    piEndpoint: endpoint,
    piModel: model,
    piFormat: format,
    ...(piAgentLanguageApiKey ? { piApiKey: String(piAgentLanguageApiKey).trim() } : {})
  });
  return result;
}

async function enableFeishu() {
  await initializeFeishu();
  const current = feishuSubsystem.status().state;
  if (!current.app.appId || !current.app.credentialReference) throw new Error("请先保存 Feishu 应用配置。");
  if (!productionFeishuProviderConfigured(current)) {
    throw new Error("请先保存完整的生产语言 provider 配置（Jev 路由只需模型和 API Key；普通 production provider 还需要接口地址）。");
  }
  await feishuSubsystem.enable({
    appId: current.app.appId,
    credentialReference: current.app.credentialReference
  });
  await syncBotAiConfigToDb({ feishuEnabled: true });
  return publicFeishuSettings(feishuSubsystem.status());
}

async function stopFeishu() {
  await initializeFeishu();
  const result = publicFeishuSettings(await feishuSubsystem.stop());
  await syncBotAiConfigToDb({ feishuEnabled: false });
  return result;
}

async function initializeWecom() {
  if (wecomInitialized) return;
  const [{ createWecomSubsystem }] = await Promise.all([
    loadModule(path.join("src", "wecom", "subsystem.mjs"))
  ]);
  wecomStateStore ??= createWecomStateStore({
    dataDirectory: app.getPath("userData"),
    safeStorage
  });
  wecomCredentialStore ??= createWecomCredentialStore({
    dataDirectory: app.getPath("userData"),
    safeStorage
  });
  wecomSubsystem ??= createWecomSubsystem({
    stateStore: wecomStateStore,
    gateway: serverHandle.gateway,
    runtimeFactory: () => {
      return createWecomProductionRuntime({
        gateway: serverHandle.gateway,
        piAgentEngine: serverPiAgentEngine,
        getSecret: (ref) => wecomCredentialStore.readSecret(ref)
      });
    }
  });
  try {
    await wecomSubsystem.initialize();
  } catch (err) {
    console.warn("[WeCom] 初始化失败，可能 safeStorage 密钥已变动，将使用默认配置:", err?.message || err);
  }

  try {
    databaseModule ??= await loadModule(path.join("src", "db.mjs"));
    const dbConfig = await databaseModule?.getBotAiConfig?.();
    if (dbConfig) {
      const currentState = wecomSubsystem.status()?.state;
      let secretValid = false;
      if (currentState?.bot?.credentialReference) {
        try {
          const s = await wecomCredentialStore.readSecret(currentState.bot.credentialReference);
          if (s) secretValid = true;
        } catch {}
      }
      if (!secretValid && dbConfig.wecomBotId && dbConfig.wecomSecret) {
        const ref = await wecomCredentialStore.writeSecret(dbConfig.wecomSecret, "wecom-bot-secret");
        await wecomSubsystem.configure({
          botId: dbConfig.wecomBotId,
          credentialReference: ref,
          welcomeEnabled: true
        });
      }

      if (dbConfig.wecomEnabled && !wecomSubsystem.status().enabled) {
        const updated = wecomSubsystem.status()?.state;
        if (updated?.bot?.botId && updated?.bot?.credentialReference) {
          await wecomSubsystem.enable({
            botId: updated.bot.botId,
            credentialReference: updated.bot.credentialReference,
            welcomeEnabled: updated.welcomeEnabled !== false
          }).catch((e) => console.warn("[WeCom] 自愈启动失败:", e?.message || e));
        }
      }
    }
  } catch (err) {
    console.warn("[WeCom] 从 SQLite 自愈配置失败:", err?.message || err);
  }

  wecomInitialized = true;
}

function publicWecomSettings(status) {
  return {
    enabled: Boolean(status?.enabled),
    configured: Boolean(status?.configured),
    connection: status?.connection || { state: "stopped", lastError: null },
    botId: status?.state?.bot?.botId || "",
    credentialConfigured: Boolean(status?.state?.bot?.credentialReference),
    welcomeEnabled: status?.state?.welcomeEnabled !== false
  };
}

async function readWecomSettings() {
  try {
    await initializeWecom();
  } catch (err) {
    console.warn("[WeCom] initialize error:", err?.message || err);
  }
  let status = null;
  try {
    status = wecomSubsystem?.status();
  } catch {}
  const settings = publicWecomSettings(status);

  let dbConfig = null;
  try {
    databaseModule ??= await loadModule(path.join("src", "db.mjs"));
    dbConfig = await databaseModule?.getBotAiConfig?.();
  } catch {}

  if (status?.state?.bot?.credentialReference) {
    try {
      settings.secret = await wecomCredentialStore.readSecret(status.state.bot.credentialReference);
    } catch {
      settings.secret = "";
    }
  }
  if (!settings.secret && dbConfig?.wecomSecret) {
    settings.secret = dbConfig.wecomSecret;
  }
  if (!settings.botId && dbConfig?.wecomBotId) {
    settings.botId = dbConfig.wecomBotId;
  }
  if (dbConfig?.wecomSecret || settings.secret) {
    settings.credentialConfigured = true;
    if (settings.botId) settings.configured = true;
  }

  return settings;
}

async function configureWecomCredentials(_event, payload = {}) {
  try {
    await initializeWecom();
    const { botId, secret, welcomeEnabled } = payload || {};
    const current = wecomSubsystem.status().state;
    const normalizedBotId = String(botId ?? current?.bot?.botId ?? "").trim();
    if (!normalizedBotId) {
      throw new Error("请输入有效的企业微信机器人 Bot ID。");
    }
    let credentialReference = current?.bot?.credentialReference;
    if (String(secret ?? "").trim()) {
      credentialReference = await wecomCredentialStore.writeSecret(secret);
    }
    if (!credentialReference) throw new Error("首次保存企业微信机器人配置必须填写 Secret。");
    const configuredStatus = await wecomSubsystem.configure({
      botId: normalizedBotId,
      credentialReference,
      welcomeEnabled: welcomeEnabled !== false
    });
    await syncBotAiConfigToDb({
      wecomBotId: normalizedBotId,
      ...(secret ? { wecomSecret: secret } : {})
    });
    return publicWecomSettings(configuredStatus);
  } catch (error) {
    appendDiagnostics("configureWecomCredentials failed", error?.stack || error?.message || String(error));
    console.error("[WeCom] configureWecomCredentials error:", error);
    throw error;
  }
}

async function enableWecom() {
  try {
    await initializeWecom();
    const current = wecomSubsystem.status().state;
    if (!current?.bot?.botId || !current?.bot?.credentialReference) {
      throw new Error("请先保存企业微信机器人配置（Bot ID 与 Secret）。");
    }
    await wecomSubsystem.enable({
      botId: current.bot.botId,
      credentialReference: current.bot.credentialReference,
      welcomeEnabled: current.bot.welcomeEnabled !== false
    });
    await syncBotAiConfigToDb({ wecomEnabled: true });
    return publicWecomSettings(wecomSubsystem.status());
  } catch (error) {
    appendDiagnostics("enableWecom failed", error?.stack || error?.message || String(error));
    console.error("[WeCom] enableWecom error:", error);
    throw error;
  }
}

async function stopWecom() {
  try {
    await initializeWecom();
    const result = publicWecomSettings(await wecomSubsystem.stop());
    await syncBotAiConfigToDb({ wecomEnabled: false });
    return result;
  } catch (error) {
    appendDiagnostics("stopWecom failed", error?.stack || error?.message || String(error));
    console.error("[WeCom] stopWecom error:", error);
    throw error;
  }
}

async function getSecretOlt(oltId) {
  const { getOlts } = await loadModule(path.join("src", "db.mjs"));
  const olts = await getOlts({ includeSecrets: true });
  const requestedId = oltId || olts[0]?.id;
  return olts.find((olt) => olt.id === requestedId);
}

function sendTerminalEvent(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("terminal:event", event);
}

async function createTerminalSession(_event, { oltId } = {}) {
  const olt = await getSecretOlt(oltId);
  const { InteractiveTelnetSession, validateTelnetTarget } = await loadModule(path.join("src", "telnet-client.mjs"));
  const validation = validateTelnetTarget(olt);
  if (!validation.ok) throw new Error(validation.error);

  const sessionId = `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const session = new InteractiveTelnetSession(sessionId, olt);
  terminalSessions.set(sessionId, session);
  session.on("event", (event) => {
    sendTerminalEvent(event);
    if (["error", "disconnected"].includes(event.type)) terminalSessions.delete(sessionId);
  });
  session.connect();
  return { sessionId };
}

function sendTerminalInput(_event, { sessionId, input } = {}) {
  terminalSessions.get(sessionId)?.send(String(input || ""));
}

function resizeTerminal(_event, { sessionId, cols, rows } = {}) {
  terminalSessions.get(sessionId)?.resize(cols, rows);
}

function closeTerminal(_event, { sessionId } = {}) {
  const session = terminalSessions.get(sessionId);
  if (!session) return;
  session.close();
  terminalSessions.delete(sessionId);
}

function closeRuntimeResources() {
  if (runtimeShutdownPromise) return runtimeShutdownPromise;
  tray?.destroy();
  tray = undefined;
  for (const session of terminalSessions.values()) session.close();
  terminalSessions.clear();
  try {
    wecomSubsystem?.stop?.();
  } catch {
    /* ignore */
  }
  runtimeShutdownPromise = Promise.resolve(runtimeLifecycle?.close({ force: true }))
    .catch((error) => {
      appendDiagnostics("local server close failed", error?.stack || error?.message || String(error));
    });
  return runtimeShutdownPromise;
}

async function createWindow() {
  try {
    serverHandle = await startLocalServer();
    appendDiagnostics("local server started", serverHandle.url);
  } catch (error) {
    appendDiagnostics("local server failed", error?.stack || error?.message || String(error));
    await dialog.showMessageBox({
      type: "error",
      title: "OLT Manager 启动失败",
      message: "本地服务启动失败",
      detail: `${error.message || String(error)}\n\n诊断日志：${diagnosticsPath()}`
    });
    app.quit();
    return;
  }

  try {
    await initializeFeishu();
  } catch (error) {
    appendDiagnostics("Feishu subsystem unavailable; local OLT functions remain available", error?.stack || error?.message || String(error));
  }

  try {
    await initializeWecom();
  } catch (error) {
    appendDiagnostics("WeCom subsystem unavailable; local OLT functions remain available", error?.stack || error?.message || String(error));
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: "OLT Manager",
    ...(process.platform === "win32"
      ? { icon: path.join(appRoot(), "assets", "generated", "olt-manager.ico") }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  createTray();
  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(serverHandle.url);
  if (pendingShowMainWindow) showMainWindow();
}

ipcMain.handle("terminal:create", createTerminalSession);
ipcMain.handle("feishu:read", readFeishuSettings);
ipcMain.handle("feishu:backup:export", exportFeishuCombinedBackup);
ipcMain.handle("feishu:backup:restore", restoreFeishuCombinedBackup);
ipcMain.handle("database:backup:restore", restoreSqliteBackup);
ipcMain.handle("feishu:configure-credentials", configureFeishuCredentials);
ipcMain.handle("feishu:configure-language-provider", configureFeishuLanguageProvider);
ipcMain.handle("feishu:configure-pi-agent-language", configurePiAgentLanguageProvider);
ipcMain.handle("feishu:enable", enableFeishu);
ipcMain.handle("feishu:stop", stopFeishu);
ipcMain.handle("wecom:read", readWecomSettings);
ipcMain.handle("wecom:configure-credentials", configureWecomCredentials);
ipcMain.handle("wecom:enable", enableWecom);
ipcMain.handle("wecom:stop", stopWecom);
ipcMain.handle("update:choose-manual", chooseManualUpdate);
ipcMain.handle("update:install-manual", installManualUpdate);
ipcMain.on("terminal:input", sendTerminalInput);
ipcMain.on("terminal:resize", resizeTerminal);
ipcMain.on("terminal:close", closeTerminal);

const applyUpdateRequest = parseApplyUpdateArgs();
const singleInstanceLock = applyUpdateRequest || app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else if (applyUpdateRequest) {
  app.whenReady().then(() => runApplyUpdate(applyUpdateRequest));
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(createWindow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) showMainWindow();
    else if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", (event) => {
    event.preventDefault();
    void closeRuntimeResources().then(() => app.exit(0));
  });
}
