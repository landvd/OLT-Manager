const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oltManagerDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  gatewaySettings: {
    read: () => ipcRenderer.invoke("gateway-settings:read"),
    save: (settings) => ipcRenderer.invoke("gateway-settings:save", settings),
    generate: (settings) => ipcRenderer.invoke("gateway-settings:generate", settings)
  },
  feishu: {
    read: () => ipcRenderer.invoke("feishu:read"),
    configure: (settings) => ipcRenderer.invoke("feishu:configure", settings),
    enable: () => ipcRenderer.invoke("feishu:enable"),
    stop: () => ipcRenderer.invoke("feishu:stop")
  },
  feishuBackup: {
    export: () => ipcRenderer.invoke("feishu:backup:export"),
    restore: (value) => ipcRenderer.invoke("feishu:backup:restore", value)
  },
  feishuMigration: {
    selectDirectory: () => ipcRenderer.invoke("feishu:migration:select-directory"),
    preview: (value) => ipcRenderer.invoke("feishu:migration:preview", value),
    apply: (value) => ipcRenderer.invoke("feishu:migration:apply", value)
  },
  feishuAdmin: {
    read: () => ipcRenderer.invoke("feishu:admin:read"),
    saveOperator: (value) => ipcRenderer.invoke("feishu:admin:operator:save", value),
    removeOperator: (openId) => ipcRenderer.invoke("feishu:admin:operator:remove", openId),
    setOperatorEnabled: (value) => ipcRenderer.invoke("feishu:admin:operator:enable", value),
    saveChat: (value) => ipcRenderer.invoke("feishu:admin:chat:save", value),
    removeChat: (chatId) => ipcRenderer.invoke("feishu:admin:chat:remove", chatId),
    setChatEnabled: (value) => ipcRenderer.invoke("feishu:admin:chat:enable", value),
    approveRequest: (value) => ipcRenderer.invoke("feishu:admin:request:approve", value),
    rejectRequest: (requestId) => ipcRenderer.invoke("feishu:admin:request:reject", requestId),
    expireRequest: (requestId) => ipcRenderer.invoke("feishu:admin:request:expire", requestId)
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
