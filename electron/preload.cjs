const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oltManagerDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  feishu: {
    read: () => ipcRenderer.invoke("feishu:read"),
    configureCredentials: (settings) => ipcRenderer.invoke("feishu:configure-credentials", settings),
    configureLanguageProvider: (settings) => ipcRenderer.invoke("feishu:configure-language-provider", settings),
    configurePiAgentLanguage: (settings) => ipcRenderer.invoke("feishu:configure-pi-agent-language", settings),
    enable: () => ipcRenderer.invoke("feishu:enable"),
    stop: () => ipcRenderer.invoke("feishu:stop")
  },
  wecom: {
    read: () => ipcRenderer.invoke("wecom:read"),
    configureCredentials: (settings) => ipcRenderer.invoke("wecom:configure-credentials", settings),
    enable: () => ipcRenderer.invoke("wecom:enable"),
    stop: () => ipcRenderer.invoke("wecom:stop")
  },
  feishuBackup: {
    export: () => ipcRenderer.invoke("feishu:backup:export"),
    restore: (value) => ipcRenderer.invoke("feishu:backup:restore", value)
  },
  databaseBackup: {
    restore: (value) => ipcRenderer.invoke("database:backup:restore", value)
  },
  update: {
    chooseManual: () => ipcRenderer.invoke("update:choose-manual"),
    installManual: () => ipcRenderer.invoke("update:install-manual")
  },
  terminal: {
    create: (options) => ipcRenderer.invoke("terminal:create", options),
    input: (payload) => ipcRenderer.send("terminal:input", payload),
    resize: (payload) => ipcRenderer.send("terminal:resize", payload),
    close: (payload) => ipcRenderer.send("terminal:close", payload),
    onEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("terminal:event", listener);
      return () => ipcRenderer.removeListener("terminal:event", listener);
    }
  }
});
