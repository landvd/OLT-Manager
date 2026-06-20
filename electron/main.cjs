const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

let mainWindow;
let serverHandle;
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
  return startServer({ host: "127.0.0.1", port: 0 });
}

async function loadModule(relativePath) {
  return import(pathToFileURL(path.join(appRoot(), relativePath)).href);
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
