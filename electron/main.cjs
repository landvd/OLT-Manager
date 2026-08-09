const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { createFeishuStateStore } = require("./feishu-state-store.cjs");
const { createFeishuCredentialStore } = require("./feishu-credential-store.cjs");
const { createCombinedBackupService } = require("./combined-backup.cjs");
const { createFeishuProductionRuntime } = require("../src/feishu/production-runtime.cjs");
const { discoverCCSwitchProviders } = require("./cc-switch-provider-discovery.cjs");

let mainWindow;
let serverHandle;
let feishuSdk;
let languageProvider;
let feishuStateStore;
let feishuCredentialStore;
let feishuSubsystem;
let combinedBackupService;
let feishuInitialized = false;
const terminalSessions = new Map();

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

async function startLocalServer() {
  configureRuntimePaths();
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
  const { startServer } = await import(serverModuleUrl);
  return startServer({
    host: "127.0.0.1",
    port: 8787
  });
}

async function loadModule(relativePath) {
  return import(pathToFileURL(path.join(appRoot(), relativePath)).href);
}

async function ensureCombinedBackupService() {
  if (combinedBackupService) return;
  const db = await loadModule(path.join("src", "db.mjs"));
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
    exportDatabaseBackup: db.exportDatabaseBackup,
    validateDatabaseBackup: db.validateDatabaseBackup,
    restoreDatabaseBackup: db.restoreDatabaseBackup,
    createStateStore: createFeishuStateStore,
    createCredentialStore: createFeishuCredentialStore
  });
}

async function initializeFeishu() {
  if (feishuInitialized) return;
  const [{ createFeishuSubsystem }, { createInProcessFeishuGateway }, { createFeishuQueryApplication }, languageProviderModule] = await Promise.all([
    loadModule(path.join("src", "feishu", "subsystem.mjs")),
    loadModule(path.join("src", "feishu", "gateway-contract.mjs")),
    loadModule(path.join("src", "feishu", "application.mjs")),
    loadModule(path.join("src", "feishu", "production-language-provider.mjs"))
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
        if (language.provider !== "production" || !language.endpoint || !language.model || !language.credentialReference) {
          throw new Error("生产语言 provider 配置不完整");
        }
        const provider = languageProvider.createProductionLanguageProvider({
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
        send: (chatId, reply) => runtime.sendReply(chatId, reply)
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
  await feishuSubsystem.initialize();
  feishuInitialized = true;
}

async function readFeishuSettings() {
  await initializeFeishu();
  const status = feishuSubsystem.status();
  return publicFeishuSettings(status);
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
    languageProviderReady: productionFeishuProviderConfigured(status.state)
  };
}

function productionFeishuProviderConfigured(state) {
  const language = state?.language || {};
  return language.provider === "production" &&
    Boolean(language.endpoint && language.model && language.format && language.credentialReference);
}

async function configureFeishu(_event, {
  appId,
  appSecret,
  languageProviderName,
  languageEndpoint,
  languageModel,
  languageFormat,
  languageApiKey
} = {}) {
  await initializeFeishu();
  const current = feishuSubsystem.status().state;
  const normalizedAppId = String(appId ?? current.app.appId ?? "").trim();
  if (!/^cli_[0-9a-fA-F]{16}$/.test(normalizedAppId)) {
    throw new Error("请输入有效的 Feishu App ID（cli_ 开头的 16 位标识）。");
  }
  let credentialReference = current.app.credentialReference;
  if (String(appSecret ?? "").trim()) {
    credentialReference = await feishuCredentialStore.writeSecret(appSecret);
  }
  if (!credentialReference) throw new Error("首次保存配置必须填写 App Secret。");
  const language = current.language || {};
  const providerInputsPresent = [languageProviderName, languageEndpoint, languageModel, languageApiKey]
    .some((value) => String(value ?? "").trim());
  let nextLanguage = language;
  if (providerInputsPresent || productionFeishuProviderConfigured({ language })) {
    const endpoint = languageProvider.normalizeLanguageProviderEndpoint(languageEndpoint || language.endpoint);
    const model = String(languageModel || language.model || "").trim();
    if (!model) throw new Error("请输入语言 provider 默认模型。");
    const format = languageProvider.normalizeProviderFormat({
      providerName: languageProviderName || language.providerName,
      endpoint,
      model,
      format: languageFormat || language.format
    });
    let languageCredentialReference = language.credentialReference;
    if (String(languageApiKey ?? "").trim()) {
      languageCredentialReference = await feishuCredentialStore.writeSecret(languageApiKey, "feishu-provider-key");
    }
    if (!languageCredentialReference) throw new Error("首次保存语言 provider 配置必须填写 API Key。");
    nextLanguage = {
      ...language,
      provider: "production",
      providerName: String(languageProviderName || language.providerName || "生产语言 provider").trim(),
      endpoint,
      model,
      format,
      credentialReference: languageCredentialReference,
      syntheticDatasetAttestation: null
    };
  }
  return publicFeishuSettings(await feishuSubsystem.configure({
    appId: normalizedAppId,
    credentialReference,
    language: nextLanguage
  }));
}

async function enableFeishu() {
  await initializeFeishu();
  const current = feishuSubsystem.status().state;
  if (!current.app.appId || !current.app.credentialReference) throw new Error("请先保存 Feishu 应用配置。");
  if (!productionFeishuProviderConfigured(current)) {
    throw new Error("请先保存完整的生产语言 provider 配置（接口地址、模型和 API Key）。");
  }
  await feishuSubsystem.enable({
    appId: current.app.appId,
    credentialReference: current.app.credentialReference
  });
  return publicFeishuSettings(feishuSubsystem.status());
}

async function discoverFeishuProviders() {
  return discoverCCSwitchProviders();
}

async function stopFeishu() {
  await initializeFeishu();
  return publicFeishuSettings(await feishuSubsystem.stop());
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: "OLT Manager",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(serverHandle.url);
}

app.whenReady().then(createWindow);

ipcMain.handle("terminal:create", createTerminalSession);
ipcMain.handle("feishu:read", readFeishuSettings);
ipcMain.handle("feishu:backup:export", exportFeishuCombinedBackup);
ipcMain.handle("feishu:backup:restore", restoreFeishuCombinedBackup);
ipcMain.handle("feishu:configure", configureFeishu);
ipcMain.handle("feishu:provider:discover", discoverFeishuProviders);
ipcMain.handle("feishu:enable", enableFeishu);
ipcMain.handle("feishu:stop", stopFeishu);
ipcMain.on("terminal:input", sendTerminalInput);
ipcMain.on("terminal:resize", resizeTerminal);
ipcMain.on("terminal:close", closeTerminal);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  for (const session of terminalSessions.values()) session.close();
  terminalSessions.clear();
  serverHandle?.server?.close();
});
