"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("meetingNotes", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  chooseVideo: () => ipcRenderer.invoke("dialog:choose-video"),
  chooseOutputDirectory: () => ipcRenderer.invoke("dialog:choose-output"),
  setLocale: (locale) => ipcRenderer.invoke("settings:set-locale", locale),
  setMode: (mode) => ipcRenderer.invoke("settings:set-mode", mode),
  setSummaryDetail: (value) => ipcRenderer.invoke("settings:set-summary-detail", value),
  downloadModels: () => ipcRenderer.invoke("local:download-models"),
  cancelDownload: () => ipcRenderer.invoke("local:cancel-download"),
  onDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("local:download-progress", listener);
    return () => ipcRenderer.removeListener("local:download-progress", listener);
  },
  saveApiKey: (apiKey, locale) => ipcRenderer.invoke("settings:save-api-key", apiKey, locale),
  deleteApiKey: () => ipcRenderer.invoke("settings:delete-api-key"),
  start: (options) => ipcRenderer.invoke("workflow:start", options),
  cancel: () => ipcRenderer.invoke("workflow:cancel"),
  revealFile: (filePath) => ipcRenderer.invoke("shell:reveal-file", filePath),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("workflow:progress", listener);
    return () => ipcRenderer.removeListener("workflow:progress", listener);
  }
});
