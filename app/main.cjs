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
  SUPPORTED_MEDIA_EXTENSIONS
} = require("../src/core/workflow.cjs");
const { toUserError, CancelledError } = require("../src/core/errors.cjs");
const { normalizeLocale, translate } = require("../src/core/locale.cjs");
const { normalizeSummaryDetail } = require("../src/core/summary-detail.cjs");
const { createLocalEngine } = require("../src/core/local-engine.cjs");
const { downloadModels, getModelStatus } = require("../src/core/local-models.cjs");

const SETTINGS_FILE = "settings.json";
const LOG_FILE = "meeting-notes.log";
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const VIDEO_DIALOG_EXTENSIONS = SUPPORTED_MEDIA_EXTENSIONS.map((extension) => extension.slice(1));
const VIDEO_COLLATOR = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
let mainWindow = null;
let activeJob = null;
let modelDownload = null;
let settingsQueue = Promise.resolve();

function modelDirectory() { return path.join(app.getPath("userData"), "models"); }
function binaryDirectory() {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
  return path.join(root, "local", `${process.platform}-${process.arch}`);
}

function updateSettings(change) {
  const operation = settingsQueue.then(async () => {
    const settings = await readSettings();
    change(settings);
    await writeSettings(settings);
  });
  settingsQueue = operation.catch(() => {});
  return operation;
}

function createWindow(locale = "ru") {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 820,
    minWidth: 700,
    minHeight: 640,
    show: false,
    title: translate(locale, "appTitle"),
    backgroundColor: "#f3f9fc",
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
    modelDownload?.abort();
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

async function getPreferredLocale() {
  const settings = await readSettings();
  return normalizeLocale(settings.locale || app.getLocale());
}

async function saveLocale(value) {
  const locale = normalizeLocale(value);
  await updateSettings((settings) => { settings.locale = locale; });
  mainWindow?.setTitle(translate(locale, "appTitle"));
  return locale;
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

async function saveApiKey(value, locale = "ru") {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (apiKey.length < 20) {
    throw new Error(translate(locale, "apiKeyTooShort"));
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(translate(locale, "secureStorageUnavailable"));
  }
  const encrypted = safeStorage.encryptString(apiKey).toString("base64");
  await updateSettings((settings) => { settings.apiKey = encrypted; });
}

async function deleteApiKey() {
  await updateSettings((settings) => { delete settings.apiKey; settings.mode = "local"; });
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
  ipcMain.handle("app:get-state", async () => {
    const locale = await getPreferredLocale();
    const hasApiKey = Boolean(await getApiKey());
    const settings = await readSettings();
    return {
      version: app.getVersion(),
      hasApiKey,
      mode: hasApiKey && settings.mode === "openai" ? "openai" : "local",
      summaryDetail: normalizeSummaryDetail(settings.summaryDetail),
      localModels: await getModelStatus(modelDirectory()),
      platform: process.platform,
      locale,
      developer: "Luckroute IT department"
    };
  });

  ipcMain.handle("settings:set-mode", async (_event, mode) => {
    if (activeJob || modelDownload || !["local", "openai"].includes(mode)) return { ok: false };
    if (mode === "openai" && !await getApiKey()) return { ok: false, code: "API_KEY_REQUIRED" };
    await updateSettings((settings) => { settings.mode = mode; });
    return { ok: true, mode };
  });

  ipcMain.handle("settings:set-summary-detail", async (_event, value) => {
    if (activeJob || modelDownload) return { ok: false };
    const summaryDetail = normalizeSummaryDetail(value);
    await updateSettings(settings => { settings.summaryDetail = summaryDetail; });
    return { ok: true, summaryDetail };
  });

  ipcMain.handle("local:download-models", async (event) => {
    if (activeJob || modelDownload) return { ok: false, code: "BUSY" };
    const controller = new AbortController();
    modelDownload = controller;
    let powerId;
    const locale = await getPreferredLocale();
    try {
      powerId = powerSaveBlocker.start("prevent-app-suspension");
      const status = await downloadModels({
        directory: modelDirectory(), locale, signal: controller.signal,
        fetchImpl: (input, init) => net.fetch(input, init),
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send("local:download-progress", progress);
        }
      });
      return { ok: true, localModels: status };
    } catch (error) {
      const userError = toUserError(controller.signal.aborted ? new CancelledError(undefined, locale) : error, locale);
      return { ok: false, code: userError.code, error: userError.message };
    } finally {
      if (Number.isInteger(powerId) && powerSaveBlocker.isStarted(powerId)) powerSaveBlocker.stop(powerId);
      modelDownload = null;
    }
  });
  ipcMain.handle("local:cancel-download", () => { modelDownload?.abort(); return { ok: true }; });

  ipcMain.handle("dialog:choose-video", async () => {
    const locale = await getPreferredLocale();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: translate(locale, "dialogChooseVideo"),
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: translate(locale, "videoFilter"), extensions: VIDEO_DIALOG_EXTENSIONS },
        { name: translate(locale, "allFilesFilter"), extensions: ["*"] }
      ]
    });
    return result.canceled ? null : sortVideoPaths(result.filePaths);
  });

  ipcMain.handle("dialog:choose-output", async () => {
    const locale = await getPreferredLocale();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: translate(locale, "dialogChooseOutput"),
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("settings:set-locale", async (_event, locale) => ({
    ok: true,
    locale: await saveLocale(locale)
  }));

  ipcMain.handle("settings:save-api-key", async (_event, apiKey, localeValue) => {
    const locale = normalizeLocale(localeValue || await getPreferredLocale());
    try {
      await saveApiKey(apiKey, locale);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toUserError(error, locale).message };
    }
  });

  ipcMain.handle("settings:delete-api-key", async () => {
    await deleteApiKey();
    return { ok: true };
  });

  ipcMain.handle("workflow:start", async (event, options) => {
    const locale = normalizeLocale(options?.locale || await getPreferredLocale());
    if (activeJob || modelDownload) {
      return { ok: false, error: translate(locale, "jobAlreadyRunning") };
    }

    const controller = new AbortController();
    let powerBlockerId = null;
    try {
      powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } catch {
      powerBlockerId = null;
    }
    activeJob = { controller, powerBlockerId, locale };
    const mode = options?.mode === "openai" ? "openai" : "local";

    const sourceNames = Array.isArray(options?.videoPaths)
      ? options.videoPaths.map((filePath) => path.basename(String(filePath)))
      : [];
    await appendDiagnosticLog("job-start", {
      appVersion: app.getVersion(),
      platform: process.platform,
      sourceFiles: sourceNames,
      locale,
      mode,
      identifySpeakers: mode === "openai",
      splitMeetings: options?.splitMeetings === true
    }).catch(() => {});

    try {
      const apiKey = mode === "openai" ? await getApiKey() : undefined;
      if (mode === "openai" && !apiKey) {
        throw Object.assign(new Error(translate(locale, "apiKeyRequired")), { code: "API_KEY_REQUIRED" });
      }
      let localEngine;
      if (mode === "local") {
        sendProgress(event, { stage: "local-verify", percent: 1,
          message: locale === "en" ? "Checking local models…" : "Проверяю локальные модели…" });
        localEngine = await createLocalEngine({ modelDirectory: modelDirectory(), binaryDirectory: binaryDirectory(), locale, signal: controller.signal });
      }
      const result = await runMeetingWorkflow({
        videoPaths: options?.videoPaths,
        outputDirectory: options?.outputDirectory,
        identifySpeakers: true,
        splitMeetings: options?.splitMeetings === true,
        summaryDetail: normalizeSummaryDetail(options?.summaryDetail),
        locale,
        mode,
        localEngine,
        checkpointDirectory: path.join(app.getPath("userData"), "checkpoints"),
        apiKey,
        signal: controller.signal,
        fetchImpl: mode === "openai" ? (input, init) => net.fetch(input, init) : undefined,
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
      const userError = toUserError(error, locale);
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
    activeJob.controller.abort(new CancelledError(undefined, activeJob.locale));
    return { ok: true };
  });

  ipcMain.handle("shell:reveal-file", async (_event, filePath) => {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return { ok: false };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createWindow(await getPreferredLocale());
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(await getPreferredLocale());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
