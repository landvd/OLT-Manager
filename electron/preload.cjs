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
    configure: (settings) => ipcRenderer.invoke("feishu:configure", settings),
    discoverProviders: () => ipcRenderer.invoke("feishu:provider:discover"),
    enable: () => ipcRenderer.invoke("feishu:enable"),
    stop: () => ipcRenderer.invoke("feishu:stop")
  },
  feishuBackup: {
    export: () => ipcRenderer.invoke("feishu:backup:export"),
    restore: (value) => ipcRenderer.invoke("feishu:backup:restore", value)
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
