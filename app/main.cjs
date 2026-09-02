"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell
} = require("electron");

const { runMeetingWorkflow } = require("../src/core/workflow.cjs");
const { toUserError, CancelledError } = require("../src/core/errors.cjs");

const SETTINGS_FILE = "settings.json";
let mainWindow = null;
let activeJob = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 690,
    minWidth: 680,
    minHeight: 620,
    show: false,
    title: "Сводка созвона",
    backgroundColor: "#f5f3ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "../src/ui/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => {
    activeJob?.controller.abort();
    mainWindow = null;
  });
}

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function writeSettings(settings) {
  const destination = settingsPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.rename(temporary, destination);
}

async function getApiKey() {
  const settings = await readSettings();
  if (!settings.apiKey) return null;
  try {
    return safeStorage.decryptString(Buffer.from(settings.apiKey, "base64"));
  } catch {
    return null;
  }
}

async function saveApiKey(value) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (apiKey.length < 20) {
    throw new Error("Ключ OpenAI выглядит слишком коротким.");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Системное защищённое хранилище недоступно.");
  }
  const settings = await readSettings();
  settings.apiKey = safeStorage.encryptString(apiKey).toString("base64");
  await writeSettings(settings);
}

async function deleteApiKey() {
  const settings = await readSettings();
  delete settings.apiKey;
  await writeSettings(settings);
}

function sendProgress(event, progress) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("workflow:progress", progress);
  }
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => ({
    version: app.getVersion(),
    hasApiKey: Boolean(await getApiKey()),
    platform: process.platform
  }));

  ipcMain.handle("dialog:choose-video", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите запись созвона",
      properties: ["openFile"],
      filters: [
        { name: "Видео MP4", extensions: ["mp4"] },
        { name: "Все файлы", extensions: ["*"] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:choose-output", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Куда сохранить расшифровку и сводку",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("settings:save-api-key", async (_event, apiKey) => {
    try {
      await saveApiKey(apiKey);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toUserError(error).message };
    }
  });

  ipcMain.handle("settings:delete-api-key", async () => {
    await deleteApiKey();
    return { ok: true };
  });

  ipcMain.handle("workflow:start", async (event, options) => {
    if (activeJob) {
      return { ok: false, error: "Обработка уже запущена." };
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      return { ok: false, code: "API_KEY_REQUIRED", error: "Сначала сохраните ключ OpenAI." };
    }

    const controller = new AbortController();
    activeJob = { controller };

    try {
      const result = await runMeetingWorkflow({
        videoPath: options?.videoPath,
        outputDirectory: options?.outputDirectory,
        apiKey,
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, progress)
      });
      return { ok: true, ...result };
    } catch (error) {
      const userError = toUserError(error);
      return {
        ok: false,
        code: userError.code,
        error: userError.message,
        transcriptPath: error?.transcriptPath || null
      };
    } finally {
      activeJob = null;
    }
  });

  ipcMain.handle("workflow:cancel", async () => {
    if (!activeJob) return { ok: false };
    activeJob.controller.abort(new CancelledError());
    return { ok: true };
  });

  ipcMain.handle("shell:reveal-file", async (_event, filePath) => {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return { ok: false };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

