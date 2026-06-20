const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oltManagerDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
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
