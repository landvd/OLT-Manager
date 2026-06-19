const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, shell } = require("electron");

let mainWindow;
let serverHandle;

function appRoot() {
  return app.getAppPath();
}

function configureRuntimePaths() {
  const root = appRoot();
  const userData = app.getPath("userData");
  process.env.OLT_MANAGER_APP_ROOT = root;
  process.env.OLT_MANAGER_STATIC_DIR = path.join(root, "dist");
  process.env.OLT_MANAGER_SEED_DIR = path.join(root, "data");
  process.env.OLT_MANAGER_DATA_DIR = path.join(userData, "data");
}

async function startLocalServer() {
  configureRuntimePaths();
  const serverModuleUrl = pathToFileURL(path.join(appRoot(), "src", "server.mjs")).href;
  const { startServer } = await import(serverModuleUrl);
  return startServer({ host: "127.0.0.1", port: 0 });
}

async function createWindow() {
  try {
    serverHandle = await startLocalServer();
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "OLT Manager 启动失败",
      message: "本地服务启动失败",
      detail: error.message || String(error)
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  serverHandle?.server?.close();
});
