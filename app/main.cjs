"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  powerSaveBlocker,
  safeStorage,
  shell
} = require("electron");

const {
  runMeetingWorkflow,
  SUPPORTED_VIDEO_EXTENSIONS
} = require("../src/core/workflow.cjs");
const { toUserError, CancelledError } = require("../src/core/errors.cjs");

const SETTINGS_FILE = "settings.json";
const LOG_FILE = "meeting-notes.log";
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const VIDEO_DIALOG_EXTENSIONS = SUPPORTED_VIDEO_EXTENSIONS.map((extension) => extension.slice(1));
const VIDEO_COLLATOR = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
let mainWindow = null;
let activeJob = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 860,
    minWidth: 700,
    minHeight: 740,
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

function diagnosticLogPath() {
  return path.join(app.getPath("userData"), "logs", LOG_FILE);
}

async function appendDiagnosticLog(event, details = {}) {
  const destination = diagnosticLogPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const stat = await fs.stat(destination);
    if (stat.size > MAX_LOG_BYTES) {
      const previous = `${destination}.previous`;
      await fs.rm(previous, { force: true });
      await fs.rename(destination, previous);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const record = {
    time: new Date().toISOString(),
    event,
    ...details
  };
  await fs.appendFile(destination, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function errorForLog(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    status: error?.status || null,
    message: String(error?.message || error || "Unknown error").slice(0, 2000),
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 8000) : null
  };
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

function sortVideoPaths(filePaths) {
  return [...filePaths].sort((left, right) => (
    VIDEO_COLLATOR.compare(path.basename(left), path.basename(right))
    || VIDEO_COLLATOR.compare(left, right)
  ));
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => ({
    version: app.getVersion(),
    hasApiKey: Boolean(await getApiKey()),
    platform: process.platform
  }));

  ipcMain.handle("dialog:choose-video", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите одну или несколько записей созвона",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Видео", extensions: VIDEO_DIALOG_EXTENSIONS },
        { name: "Все файлы", extensions: ["*"] }
      ]
    });
    return result.canceled ? null : sortVideoPaths(result.filePaths);
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
    let powerBlockerId = null;
    try {
      powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } catch {
      powerBlockerId = null;
    }
    activeJob = { controller, powerBlockerId };

    const sourceNames = Array.isArray(options?.videoPaths)
      ? options.videoPaths.map((filePath) => path.basename(String(filePath)))
      : [];
    await appendDiagnosticLog("job-start", {
      appVersion: app.getVersion(),
      platform: process.platform,
      sourceFiles: sourceNames,
      identifySpeakers: options?.identifySpeakers !== false,
      splitMeetings: options?.splitMeetings === true
    }).catch(() => {});

    try {
      const result = await runMeetingWorkflow({
        videoPaths: options?.videoPaths,
        outputDirectory: options?.outputDirectory,
        identifySpeakers: options?.identifySpeakers !== false,
        splitMeetings: options?.splitMeetings === true,
        checkpointDirectory: path.join(app.getPath("userData"), "checkpoints"),
        apiKey,
        signal: controller.signal,
        fetchImpl: (input, init) => net.fetch(input, init),
        onProgress: (progress) => {
          sendProgress(event, progress);
          void appendDiagnosticLog("progress", {
            stage: progress?.stage,
            percent: progress?.percent,
            message: progress?.message
          }).catch(() => {});
        }
      });
      await appendDiagnosticLog("job-complete", {
        meetingCount: result.meetingCount,
        fileCount: result.files?.length || 0,
        identifiedSpeakerCount: result.identifiedSpeakerCount
      }).catch(() => {});
      return { ok: true, ...result };
    } catch (error) {
      const userError = toUserError(error);
      await appendDiagnosticLog("job-error", errorForLog(error)).catch(() => {});
      return {
        ok: false,
        code: userError.code,
        error: userError.message,
        transcriptPath: error?.transcriptPath || null,
        createdFiles: error?.createdFiles || [],
        outputDirectory: error?.outputDirectory || null,
        logPath: diagnosticLogPath()
      };
    } finally {
      if (
        Number.isInteger(powerBlockerId)
        && powerSaveBlocker.isStarted(powerBlockerId)
      ) powerSaveBlocker.stop(powerBlockerId);
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
