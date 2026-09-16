"use strict";

const api = window.meetingNotes;

const COPY = Object.freeze({
  ru: Object.freeze({
    documentTitle: "Сводка созвона — Luckroute",
    brandUnit: "AI WORKSPACE",
    languageSwitchLabel: "Язык интерфейса и результата",
    settingsTitle: "Настройки OpenAI",
    settingsAria: "Открыть настройки",
    eyebrow: "MEETING INTELLIGENCE",
    appTitle: "Сводка созвона",
    subtitle: "Из видео и аудио — в полную расшифровку и сводку",
    keyNoticeTitle: "OpenAI заблокирован без ключа",
    keyNoticeText: "Локальный режим доступен без ключа. Добавьте свой API-ключ, если хотите включить облачную обработку.",
    modeMeta: "ЛОКАЛЬНО / OPENAI",
    modeHeading: "Режим обработки",
    detailHeading: "Подробность сводки",
    detailBrief: "Краткая",
    detailStandard: "Обычная",
    detailDetailed: "Подробная",
    detailHint: "{range} символов для 45–60 минут. Объём зависит от длительности и содержания разговора.",
    detailError: "Не удалось сохранить подробность сводки.",
    localMode: "На компьютере",
    cloudLocked: "OpenAI заблокирован. Добавьте API-ключ в настройках.",
    localDescription: "Расшифровка и сводка создаются на вашем компьютере. После установки моделей интернет не нужен; записи, текст и кадры никуда не отправляются.",
    cloudDescription: "Аудио и текст отправляются в OpenAI. Для видеозаписей программа автоматически анализирует также отдельные кадры с подписями. Нужен интернет; использование оплачивается по вашему API-ключу.",
    localNames: "Имена и роли учитываются в сводке по явно сказанному. Локальный режим пока не разделяет голоса и не подписывает отдельные реплики именами.",
    modelRequirements: "Whisper + Qwen3.5 · около 6,2 ГБ с Hugging Face · рекомендуется 16 ГБ ОЗУ. На CPU обработка может быть долгой.",
    downloadModels: "Скачать модели",
    pauseDownload: "Приостановить",
    modelsNeeded: "Один раз установите локальные модели",
    modelsReady: "Всё готово для работы без интернета",
    modelsDownloading: "Загрузка моделей: {percent}%",
    modelsVerifying: "Проверяю целостность моделей…",
    modeError: "Не удалось переключить режим.",
    configure: "Настроить",
    workspaceEyebrow: "НОВАЯ ОБРАБОТКА",
    workspaceTitle: "Подготовьте материалы",
    oneClick: "ОДИН ЗАПУСК",
    sourceHeading: "Видео или аудио созвона",
    noVideos: "Записи не выбраны",
    videoNotSelected: "Запись не выбрана",
    selectedFiles: "Выбрано файлов: {count}",
    videoOrderHint: "Файлы будут обработаны по порядку их названий.",
    chooseVideo: "Выбрать файлы",
    outputHeading: "Место сохранения",
    noFolder: "Папка не выбрана",
    chooseFolder: "Выбрать папку",
    identifyNamesTitle: "Имена и роли — автоматически",
    identifyNamesText: "Программа сопоставляет видео, самопредставления и обращения в разговоре. Предположительная роль помечается отдельно от подтверждённой должности.",
    splitMeetingsTitle: "В записях несколько разных созвонов",
    splitMeetingsText: "Программа найдёт явные границы и создаст отдельную расшифровку и сводку для каждой встречи.",
    preparing: "Подготовка…",
    processing: "Обработка…",
    elapsed: "Прошло: {time}",
    progressHint: "Можно работать в фоне. Готовые части сохраняются для продолжения после сбоя.",
    done: "Готово",
    filesSaved: "Файлы сохранены.",
    showFiles: "Показать файлы",
    showLog: "Показать журнал диагностики",
    start: "Создать расшифровку и сводку",
    stop: "Остановить",
    stopping: "Останавливаю обработку…",
    outputHint: "На выходе: полная расшифровка и сводка в TXT",
    developedBy: "Разработчик",
    version: "Версия {version}",
    settingsEyebrow: "НАСТРОЙКИ",
    apiKeyTitle: "Ключ OpenAI",
    close: "Закрыть",
    apiKeyDescription: "Введите API-ключ один раз. Он будет зашифрован средствами Windows или связкой ключей macOS и не попадёт в файлы результата.",
    apiKeyLabel: "API-ключ",
    deleteKey: "Удалить ключ",
    cancel: "Отмена",
    save: "Сохранить",
    keyStored: "Ключ уже сохранён. Введите новый, только если хотите заменить его.",
    enterKey: "Введите API-ключ.",
    keyDeleted: "Ключ удалён.",
    ipcError: "Приложение не смогло завершить обработку. Перезапустите его и повторите — готовые части будут восстановлены.",
    initError: "Не удалось запустить приложение. Перезапустите его.",
    localeError: "Не удалось сохранить выбор языка.",
    partialTitle: "Готовые файлы сохранены",
    partialMessage: "Сохранено до сбоя: {count}",
    splitSkippedTitle: "Готово — сохранено как один созвон",
    splitSkippedMessage: "Автоматическое разделение не сработало · TXT-файлов: {count}",
    meetingsDoneTitle: "Готово — найдено созвонов: {count}",
    filesDoneMessage: "Сохранено TXT-файлов: {count}",
    oneDoneTitle: "Готово — сохранены два TXT-файла",
    oneDoneMessage: "Расшифровка и сводка готовы",
    namesCount: "имён: {count}",
    rolesCount: "ролей: {count}"
  }),
  en: Object.freeze({
    documentTitle: "Meeting Notes — Luckroute",
    brandUnit: "AI WORKSPACE",
    languageSwitchLabel: "Interface and output language",
    settingsTitle: "OpenAI settings",
    settingsAria: "Open settings",
    eyebrow: "MEETING INTELLIGENCE",
    appTitle: "Meeting Notes",
    subtitle: "Turn video and audio into a full transcript and meeting summary",
    keyNoticeTitle: "OpenAI is locked without a key",
    keyNoticeText: "Local mode works without a key. Add your API key if you want to enable cloud processing.",
    modeMeta: "LOCAL / OPENAI",
    modeHeading: "Processing mode",
    detailHeading: "Summary detail",
    detailBrief: "Brief",
    detailStandard: "Standard",
    detailDetailed: "Detailed",
    detailHint: "{range} characters for 45–60 minutes. Length adapts to the duration and substance of the meeting.",
    detailError: "Could not save the summary detail setting.",
    localMode: "On this computer",
    cloudLocked: "OpenAI is locked. Add an API key in settings.",
    localDescription: "Transcripts and summaries are created on your computer. Once models are installed, no internet is needed. Recordings, text and frames never leave this device.",
    cloudDescription: "Audio and text are sent to OpenAI. For video recordings, selected frames are also analyzed automatically to identify speakers. Requires internet; charges apply to your API key.",
    localNames: "Explicitly mentioned names and roles are used in the summary. Local mode does not yet distinguish voices or assign names to individual utterances.",
    modelRequirements: "Whisper + Qwen3.5 · about 6.2 GB from Hugging Face · 16 GB RAM recommended. CPU processing may take a long time.",
    downloadModels: "Download models",
    pauseDownload: "Pause download",
    modelsNeeded: "Install local models once",
    modelsReady: "Ready to work offline",
    modelsDownloading: "Downloading models: {percent}%",
    modelsVerifying: "Verifying model integrity…",
    modeError: "Could not switch processing mode.",
    configure: "Set up",
    workspaceEyebrow: "NEW PROCESSING JOB",
    workspaceTitle: "Prepare your files",
    oneClick: "ONE START",
    sourceHeading: "Meeting video or audio",
    noVideos: "No recordings selected",
    videoNotSelected: "No recording selected",
    selectedFiles: "Files selected: {count}",
    videoOrderHint: "Files will be processed in filename order.",
    chooseVideo: "Choose files",
    outputHeading: "Save location",
    noFolder: "No folder selected",
    chooseFolder: "Choose folder",
    identifyNamesTitle: "Names and roles — automatic",
    identifyNamesText: "The app combines video labels, self-introductions and dialogue. Inferred roles are marked separately from confirmed job titles.",
    splitMeetingsTitle: "The recordings contain separate meetings",
    splitMeetingsText: "The app finds clear boundaries and creates a separate transcript and summary for every meeting.",
    preparing: "Preparing…",
    processing: "Processing…",
    elapsed: "Elapsed: {time}",
    progressHint: "You can keep working in the background. Completed segments are saved for recovery after a failure.",
    done: "Done",
    filesSaved: "Files saved.",
    showFiles: "Show files",
    showLog: "Show diagnostic log",
    start: "Create transcript and summary",
    stop: "Stop",
    stopping: "Stopping processing…",
    outputHint: "Output: a full transcript and summary in TXT",
    developedBy: "Developer",
    version: "Version {version}",
    settingsEyebrow: "SETTINGS",
    apiKeyTitle: "OpenAI key",
    close: "Close",
    apiKeyDescription: "Enter the API key once. It is encrypted with Windows security or macOS Keychain and is never included in output files.",
    apiKeyLabel: "API key",
    deleteKey: "Delete key",
    cancel: "Cancel",
    save: "Save",
    keyStored: "A key is already saved. Enter a new one only if you want to replace it.",
    enterKey: "Enter an API key.",
    keyDeleted: "Key deleted.",
    ipcError: "The app could not finish processing. Restart it and try again — completed segments will be restored.",
    initError: "The app could not start. Please restart it.",
    localeError: "The language selection could not be saved.",
    partialTitle: "Completed files were saved",
    partialMessage: "Saved before the failure: {count}",
    splitSkippedTitle: "Done — saved as one meeting",
    splitSkippedMessage: "Automatic separation was unavailable · TXT files: {count}",
    meetingsDoneTitle: "Done — meetings found: {count}",
    filesDoneMessage: "TXT files saved: {count}",
    oneDoneTitle: "Done — two TXT files saved",
    oneDoneMessage: "The transcript and summary are ready",
    namesCount: "names: {count}",
    rolesCount: "roles: {count}"
  })
});

const elements = {
  localModeButton: document.querySelector("#localModeButton"),
  openaiModeButton: document.querySelector("#openaiModeButton"),
  cloudLock: document.querySelector("#cloudLock"),
  modeDescription: document.querySelector("#modeDescription"),
  modelSetup: document.querySelector("#modelSetup"),
  modelStatus: document.querySelector("#modelStatus"),
  downloadModelsButton: document.querySelector("#downloadModelsButton"),
  cancelDownloadButton: document.querySelector("#cancelDownloadButton"),
  modelDownloadProgress: document.querySelector("#modelDownloadProgress"),
  identifyNamesDescription: document.querySelector("#identifyNamesDescription"),
  languageButtons: [...document.querySelectorAll("#languageSwitch [data-locale]")],
  settingsButton: document.querySelector("#settingsButton"),
  chooseVideoButton: document.querySelector("#chooseVideoButton"),
  chooseOutputButton: document.querySelector("#chooseOutputButton"),
  identityNotice: document.querySelector("#identityNotice"),
  splitMeetingsCheckbox: document.querySelector("#splitMeetingsCheckbox"),
  summaryDetail: document.querySelector("#summaryDetail"),
  detailValue: document.querySelector("#detailValue"),
  detailHint: document.querySelector("#detailHint"),
  videoPath: document.querySelector("#videoPath"),
  videoList: document.querySelector("#videoList"),
  videoOrderHint: document.querySelector("#videoOrderHint"),
  outputPath: document.querySelector("#outputPath"),
  startButton: document.querySelector("#startButton"),
  cancelButton: document.querySelector("#cancelButton"),
  progressSection: document.querySelector("#progressSection"),
  progressMessage: document.querySelector("#progressMessage"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  elapsedTime: document.querySelector("#elapsedTime"),
  resultSection: document.querySelector("#resultSection"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMessage: document.querySelector("#resultMessage"),
  showResultButton: document.querySelector("#showResultButton"),
  errorMessage: document.querySelector("#errorMessage"),
  errorActions: document.querySelector("#errorActions"),
  showLogButton: document.querySelector("#showLogButton"),
  versionLabel: document.querySelector("#versionLabel"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  settingsStatus: document.querySelector("#settingsStatus"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  deleteKeyButton: document.querySelector("#deleteKeyButton"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton")
};

const state = {
  mode: "local",
  summaryDetail: "standard",
  modelsReady: false,
  downloading: false,
  switchingMode: false,
  locale: "ru",
  version: "",
  videoPaths: [],
  outputDirectory: null,
  hasApiKey: false,
  running: false,
  revealPath: null,
  logPath: null,
  elapsedTimer: null,
  startedAt: 0,
  result: null,
  partialResult: null,
  settingsStatusKey: null
};

function t(key, parameters = {}) {
  const template = COPY[state.locale]?.[key] ?? COPY.ru[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_match, name) => (
    Object.prototype.hasOwnProperty.call(parameters, name)
      ? String(parameters[name])
      : `{${name}}`
  ));
}

function basename(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function displayPath(element, value, placeholderKey) {
  element.textContent = value || t(placeholderKey);
  element.title = value || "";
  element.classList.toggle("empty", !value);
}

function displayVideos(videoPaths) {
  elements.videoList.replaceChildren();
  if (videoPaths.length === 0) {
    displayPath(elements.videoPath, null, "noVideos");
    elements.videoList.hidden = true;
    elements.videoOrderHint.hidden = true;
    return;
  }
  if (videoPaths.length === 1) {
    displayPath(elements.videoPath, videoPaths[0], "videoNotSelected");
    elements.videoList.hidden = true;
    elements.videoOrderHint.hidden = true;
    return;
  }

  elements.videoPath.textContent = t("selectedFiles", { count: videoPaths.length });
  elements.videoPath.title = videoPaths.join("\n");
  elements.videoPath.classList.remove("empty");
  for (const filePath of videoPaths) {
    const item = document.createElement("li");
    item.textContent = basename(filePath);
    item.title = filePath;
    elements.videoList.append(item);
  }
  elements.videoList.hidden = false;
  elements.videoOrderHint.hidden = false;
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function updateElapsed() {
  const time = formatElapsed(Date.now() - state.startedAt);
  elements.elapsedTime.textContent = t("elapsed", { time });
}

function startElapsedTimer() {
  state.startedAt = Date.now();
  updateElapsed();
  state.elapsedTimer = setInterval(updateElapsed, 1000);
}

function stopElapsedTimer() {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

function updateControls() {
  const busy = state.running || state.downloading || state.switchingMode;
  const local = state.mode === "local";
  elements.startButton.disabled = busy || state.videoPaths.length === 0 || !state.outputDirectory || (local && !state.modelsReady);
  elements.chooseVideoButton.disabled = busy;
  elements.chooseOutputButton.disabled = busy;
  elements.identifyNamesDescription.textContent = t(local ? "localNames" : "identifyNamesText");
  elements.splitMeetingsCheckbox.disabled = busy;
  elements.summaryDetail.disabled = busy;
  elements.settingsButton.disabled = busy;
  for (const button of elements.languageButtons) button.disabled = busy;
  elements.localModeButton.disabled = busy;
  elements.openaiModeButton.disabled = busy || !state.hasApiKey;
  elements.openaiModeButton.title = state.hasApiKey ? "OpenAI" : t("cloudLocked");
  elements.openaiModeButton.setAttribute("aria-label", elements.openaiModeButton.title);
  // SVG does not expose HTMLElement.hidden; set the actual attribute for CSS.
  elements.cloudLock.toggleAttribute("hidden", state.hasApiKey);
  elements.localModeButton.setAttribute("aria-pressed", String(local));
  elements.openaiModeButton.setAttribute("aria-pressed", String(!local));
  elements.modeDescription.textContent = t(local ? "localDescription" : "cloudDescription");
  elements.modelSetup.hidden = !local;
  elements.modelSetup.classList.toggle("ready", state.modelsReady);
  elements.downloadModelsButton.hidden = state.downloading || state.modelsReady;
  elements.downloadModelsButton.disabled = busy;
  elements.cancelDownloadButton.hidden = !state.downloading;
  elements.modelDownloadProgress.hidden = !state.downloading;
  if (!state.downloading) elements.modelStatus.textContent = t(state.modelsReady ? "modelsReady" : "modelsNeeded");
  elements.cancelButton.hidden = !state.running;
  elements.deleteKeyButton.hidden = !state.hasApiKey;
}

function renderResult() {
  const result = state.result;
  const partial = state.partialResult;
  if (!result && !partial) return;

  if (partial) {
    elements.resultTitle.textContent = t("partialTitle");
    elements.resultMessage.textContent = t("partialMessage", { count: partial.fileCount });
  } else {
    const fileCount = Array.isArray(result.files) ? result.files.length : 2;
    const meetingCount = Number(result.meetingCount) || 1;
    if (result.splitDetectionSkipped) {
      elements.resultTitle.textContent = t("splitSkippedTitle");
      elements.resultMessage.textContent = t("splitSkippedMessage", { count: fileCount });
    } else if (meetingCount > 1) {
      elements.resultTitle.textContent = t("meetingsDoneTitle", { count: meetingCount });
      elements.resultMessage.textContent = t("filesDoneMessage", { count: fileCount });
    } else {
      elements.resultTitle.textContent = t("oneDoneTitle");
      elements.resultMessage.textContent = t("oneDoneMessage");
    }
    if (result.identifiedSpeakerCount > 0) {
      elements.resultMessage.textContent += ` · ${t("namesCount", {
        count: result.identifiedSpeakerCount
      })}`;
    }
    if (result.identifiedRoleCount > 0) elements.resultMessage.textContent += ` · ${t("rolesCount", { count: result.identifiedRoleCount })}`;
  }
  elements.showResultButton.textContent = t("showFiles");
  elements.resultSection.hidden = false;
}

function applyLocale() {
  document.documentElement.lang = state.locale;
  document.title = t("documentTitle");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-title]")) {
    element.title = t(element.dataset.i18nTitle);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  }
  for (const button of elements.languageButtons) {
    const active = button.dataset.locale === state.locale;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.versionLabel.textContent = t("version", { version: state.version });
  displayVideos(state.videoPaths);
  displayPath(elements.outputPath, state.outputDirectory, "noFolder");
  if (state.running) updateElapsed();
  if (state.settingsStatusKey) {
    elements.settingsStatus.textContent = t(state.settingsStatusKey);
  }
  renderResult();
  renderDetail();
  updateControls();
}

const DETAIL_LEVELS = ["brief", "standard", "detailed"];
function renderDetail() {
  const index = Math.max(0, DETAIL_LEVELS.indexOf(state.summaryDetail));
  const label = t(["detailBrief", "detailStandard", "detailDetailed"][index]);
  elements.summaryDetail.value = String(index);
  elements.summaryDetail.setAttribute("aria-valuetext", label);
  elements.detailValue.textContent = label;
  elements.detailHint.textContent = t("detailHint", { range: ["1 000–3 000", "3 000–10 000", "10 000–30 000"][index] });
}

elements.summaryDetail.addEventListener("input", () => {
  state.summaryDetail = DETAIL_LEVELS[Number(elements.summaryDetail.value)] || "standard";
  renderDetail();
});
elements.summaryDetail.addEventListener("change", async () => {
  try {
    const result = await api.setSummaryDetail(state.summaryDetail);
    if (!result.ok) showError(t("detailError"));
  } catch { showError(t("detailError")); }
});

function hideMessages() {
  elements.errorMessage.hidden = true;
  elements.errorActions.hidden = true;
  elements.resultSection.hidden = true;
  state.logPath = null;
  state.result = null;
  state.partialResult = null;
}

function showError(message, logPath) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
  state.logPath = logPath || null;
  elements.errorActions.hidden = !state.logPath;
}

function openSettings() {
  elements.apiKeyInput.value = "";
  state.settingsStatusKey = state.hasApiKey ? "keyStored" : null;
  elements.settingsStatus.textContent = state.settingsStatusKey ? t(state.settingsStatusKey) : "";
  elements.settingsStatus.style.color = "";
  elements.settingsDialog.showModal();
  setTimeout(() => elements.apiKeyInput.focus(), 0);
}

function closeSettings() {
  elements.settingsDialog.close();
}

async function switchMode(mode) {
  if (state.running || state.downloading || state.switchingMode || (mode === "openai" && !state.hasApiKey)) return;
  state.switchingMode = true;
  updateControls();
  try {
    const result = await api.setMode(mode);
    if (!result?.ok) throw new Error();
    state.mode = result.mode;
    hideMessages();
  } catch { showError(t("modeError")); }
  finally { state.switchingMode = false; updateControls(); }
}
elements.localModeButton.addEventListener("click", () => switchMode("local"));
elements.openaiModeButton.addEventListener("click", () => switchMode("openai"));
elements.downloadModelsButton.addEventListener("click", async () => {
  if (state.running || state.downloading) return;
  hideMessages();
  state.downloading = true;
  elements.modelStatus.textContent = t("modelsDownloading", { percent: 0 });
  elements.modelDownloadProgress.value = 0;
  updateControls();
  try {
    const result = await api.downloadModels();
    if (result.ok) state.modelsReady = result.localModels.ready;
    else if (result.code !== "CANCELLED") showError(result.error || t("ipcError"));
  } catch { showError(t("ipcError")); }
  finally { state.downloading = false; updateControls(); }
});
elements.cancelDownloadButton.addEventListener("click", () => api.cancelDownload());
api.onDownloadProgress((progress) => {
  const percent = Math.min(100, Math.floor((progress.downloaded / Math.max(1, progress.total)) * 100));
  elements.modelDownloadProgress.value = percent;
  elements.modelStatus.textContent = progress.verifying ? t("modelsVerifying") : t("modelsDownloading", { percent });
});

for (const button of elements.languageButtons) {
  button.addEventListener("click", async () => {
    const locale = button.dataset.locale === "en" ? "en" : "ru";
    if (state.running || locale === state.locale) return;
    state.locale = locale;
    applyLocale();
    try {
      const result = await api.setLocale(locale);
      if (!result?.ok) showError(t("localeError"));
    } catch {
      showError(t("localeError"));
    }
  });
}

elements.settingsButton.addEventListener("click", openSettings);
elements.closeSettingsButton.addEventListener("click", closeSettings);
elements.cancelSettingsButton.addEventListener("click", closeSettings);

elements.chooseVideoButton.addEventListener("click", async () => {
  const selected = await api.chooseVideo();
  if (!selected) return;
  state.videoPaths = Array.isArray(selected) ? selected : [selected];
  displayVideos(state.videoPaths);
  hideMessages();
  updateControls();
});

elements.chooseOutputButton.addEventListener("click", async () => {
  const selected = await api.chooseOutputDirectory();
  if (!selected) return;
  state.outputDirectory = selected;
  displayPath(elements.outputPath, selected, "noFolder");
  hideMessages();
  updateControls();
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) {
    state.settingsStatusKey = "enterKey";
    elements.settingsStatus.textContent = t("enterKey");
    return;
  }
  elements.saveKeyButton.disabled = true;
  const result = await api.saveApiKey(apiKey, state.locale);
  elements.saveKeyButton.disabled = false;
  if (!result.ok) {
    state.settingsStatusKey = null;
    elements.settingsStatus.textContent = result.error;
    return;
  }
  state.hasApiKey = true;
  state.settingsStatusKey = null;
  elements.apiKeyInput.value = "";
  updateControls();
  closeSettings();
});

elements.deleteKeyButton.addEventListener("click", async () => {
  await api.deleteApiKey();
  state.hasApiKey = false;
  state.mode = "local";
  state.settingsStatusKey = "keyDeleted";
  elements.settingsStatus.style.color = "#47751b";
  elements.settingsStatus.textContent = t("keyDeleted");
  updateControls();
});

elements.startButton.addEventListener("click", async () => {
  hideMessages();
  if (state.mode === "openai" && !state.hasApiKey) {
    openSettings();
    return;
  }

  state.running = true;
  state.revealPath = null;
  elements.progressBar.value = 0;
  elements.progressPercent.textContent = "0%";
  elements.progressMessage.textContent = t("preparing");
  elements.progressSection.hidden = false;
  startElapsedTimer();
  updateControls();

  let result;
  try {
    result = await api.start({
      videoPaths: state.videoPaths,
      mode: state.mode,
      outputDirectory: state.outputDirectory,
      splitMeetings: elements.splitMeetingsCheckbox.checked,
      summaryDetail: state.summaryDetail,
      locale: state.locale
    });
  } catch {
    result = { ok: false, code: "IPC_ERROR", error: t("ipcError") };
  }

  state.running = false;
  stopElapsedTimer();
  elements.progressSection.hidden = true;
  updateControls();

  if (!result.ok) {
    if (result.code === "API_KEY_REQUIRED" || result.code === "INVALID_API_KEY") {
      state.hasApiKey = false;
      state.mode = "local";
      updateControls();
    }
    if (result.code === "LOCAL_MODELS_REQUIRED") { state.modelsReady = false; updateControls(); }
    if (result.code !== "CANCELLED") showError(result.error, result.logPath);
    const createdFiles = Array.isArray(result.createdFiles) ? result.createdFiles : [];
    if (result.transcriptPath || createdFiles.length > 0) {
      state.revealPath = result.transcriptPath || createdFiles[0];
      state.partialResult = { fileCount: Math.max(1, createdFiles.length) };
      renderResult();
    }
    return;
  }

  state.revealPath = result.summaryPath;
  state.result = result;
  renderResult();
});

elements.cancelButton.addEventListener("click", async () => {
  elements.cancelButton.disabled = true;
  elements.progressMessage.textContent = t("stopping");
  await api.cancel();
  elements.cancelButton.disabled = false;
});

elements.showResultButton.addEventListener("click", () => {
  if (state.revealPath) api.revealFile(state.revealPath);
});

elements.showLogButton.addEventListener("click", () => {
  if (state.logPath) api.revealFile(state.logPath);
});

api.onProgress((progress) => {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  elements.progressBar.value = percent;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressMessage.textContent = progress?.message || t("processing");
});

async function initialize() {
  const initial = await api.getState();
  state.locale = initial.locale === "en" ? "en" : "ru";
  state.version = initial.version || "";
  state.hasApiKey = initial.hasApiKey;
  state.mode = initial.hasApiKey && initial.mode === "openai" ? "openai" : "local";
  state.modelsReady = Boolean(initial.localModels?.ready);
  state.summaryDetail = DETAIL_LEVELS.includes(initial.summaryDetail) ? initial.summaryDetail : "standard";
  applyLocale();
  updateControls();
}

initialize().catch(() => showError(t("initError")));
