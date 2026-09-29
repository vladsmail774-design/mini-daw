const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("miniDaw", {
  openProject: () => ipcRenderer.invoke("project:open"),
  saveProject: (bytes, suggestedName, saveAs) => ipcRenderer.invoke("project:save", bytes, suggestedName, saveAs),
  resetProjectPath: () => ipcRenderer.invoke("project:reset-path"),
});
