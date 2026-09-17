"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("meetingNotes", {
  getState: async () => ({ version: "1.3.2", locale: "ru", hasApiKey: false, mode: "local", summaryDetail: "detailed", localModels: { ready: false } }),
  chooseVideo: async () => ["C:\\Calls\\part-01.mov", "C:\\Calls\\part-02.mp3"],
  chooseOutputDirectory: async () => "C:\\Results",
  setLocale: async (locale) => ({ ok: true, locale }),
  setMode: async (mode) => ({ ok: true, mode }),
  setSummaryDetail: async (summaryDetail) => ({ ok: true, summaryDetail }),
  saveApiKey: async () => ({ ok: true }),
  deleteApiKey: async () => ({ ok: true }),
  downloadModels: async () => ({ ok: true, localModels: { ready: true } }),
  cancelDownload: async () => ({ ok: true }),
  onDownloadProgress: () => {},
  start: async (options) => {
    await ipcRenderer.invoke("qa:record-start", options);
    return { ok: true, meetingCount: 1, identifiedSpeakerCount: 0, files: ["transcript.txt", "summary.txt"], summaryPath: "C:\\Results\\summary.txt" };
  },
  cancel: async () => ({ ok: true }),
  revealFile: async () => ({ ok: true }),
  onProgress: () => {}
});
