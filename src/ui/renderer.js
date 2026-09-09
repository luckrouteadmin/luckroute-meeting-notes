"use strict";

const api = window.meetingNotes;
const elements = {
  keyNotice: document.querySelector("#keyNotice"),
  settingsButton: document.querySelector("#settingsButton"),
  noticeSettingsButton: document.querySelector("#noticeSettingsButton"),
  chooseVideoButton: document.querySelector("#chooseVideoButton"),
  chooseOutputButton: document.querySelector("#chooseOutputButton"),
  identifySpeakersCheckbox: document.querySelector("#identifySpeakersCheckbox"),
  splitMeetingsCheckbox: document.querySelector("#splitMeetingsCheckbox"),
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
  videoPaths: [],
  outputDirectory: null,
  hasApiKey: false,
  running: false,
  revealPath: null,
  logPath: null,
  elapsedTimer: null,
  startedAt: 0
};

function basename(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function displayPath(element, value, placeholder) {
  element.textContent = value || placeholder;
  element.title = value || "";
  element.classList.toggle("empty", !value);
}

function displayVideos(videoPaths) {
  elements.videoList.replaceChildren();
  if (videoPaths.length === 0) {
    displayPath(elements.videoPath, null, "MP4-файлы не выбраны");
    elements.videoList.hidden = true;
    elements.videoOrderHint.hidden = true;
    return;
  }
  if (videoPaths.length === 1) {
    displayPath(elements.videoPath, videoPaths[0], "MP4-файл не выбран");
    elements.videoList.hidden = true;
    elements.videoOrderHint.hidden = true;
    return;
  }

  elements.videoPath.textContent = `Выбрано файлов: ${videoPaths.length}`;
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

function startElapsedTimer() {
  state.startedAt = Date.now();
  const update = () => {
    elements.elapsedTime.textContent = `Прошло: ${formatElapsed(Date.now() - state.startedAt)}`;
  };
  update();
  state.elapsedTimer = setInterval(update, 1000);
}

function stopElapsedTimer() {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

function updateControls() {
  elements.startButton.disabled = state.running || state.videoPaths.length === 0 || !state.outputDirectory;
  elements.chooseVideoButton.disabled = state.running;
  elements.chooseOutputButton.disabled = state.running;
  elements.identifySpeakersCheckbox.disabled = state.running;
  elements.splitMeetingsCheckbox.disabled = state.running;
  elements.settingsButton.disabled = state.running;
  elements.cancelButton.hidden = !state.running;
  elements.keyNotice.hidden = state.hasApiKey;
  elements.deleteKeyButton.hidden = !state.hasApiKey;
}

function hideMessages() {
  elements.errorMessage.hidden = true;
  elements.errorActions.hidden = true;
  elements.resultSection.hidden = true;
  state.logPath = null;
}

function showError(message, logPath) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
  state.logPath = logPath || null;
  elements.errorActions.hidden = !state.logPath;
}

function openSettings() {
  elements.apiKeyInput.value = "";
  elements.settingsStatus.textContent = state.hasApiKey
    ? "Ключ уже сохранён. Введите новый, только если хотите заменить его."
    : "";
  elements.settingsStatus.style.color = "";
  elements.settingsDialog.showModal();
  setTimeout(() => elements.apiKeyInput.focus(), 0);
}

function closeSettings() {
  elements.settingsDialog.close();
}

elements.settingsButton.addEventListener("click", openSettings);
elements.noticeSettingsButton.addEventListener("click", openSettings);
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
  displayPath(elements.outputPath, selected, "Папка не выбрана");
  hideMessages();
  updateControls();
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) {
    elements.settingsStatus.textContent = "Введите API-ключ.";
    return;
  }
  elements.saveKeyButton.disabled = true;
  const result = await api.saveApiKey(apiKey);
  elements.saveKeyButton.disabled = false;
  if (!result.ok) {
    elements.settingsStatus.textContent = result.error;
    return;
  }
  state.hasApiKey = true;
  elements.apiKeyInput.value = "";
  updateControls();
  closeSettings();
});

elements.deleteKeyButton.addEventListener("click", async () => {
  await api.deleteApiKey();
  state.hasApiKey = false;
  elements.settingsStatus.style.color = "#315f2f";
  elements.settingsStatus.textContent = "Ключ удалён.";
  updateControls();
});

elements.startButton.addEventListener("click", async () => {
  hideMessages();
  if (!state.hasApiKey) {
    openSettings();
    return;
  }

  state.running = true;
  state.revealPath = null;
  elements.progressBar.value = 0;
  elements.progressPercent.textContent = "0%";
  elements.progressMessage.textContent = "Подготовка…";
  elements.progressSection.hidden = false;
  startElapsedTimer();
  updateControls();

  let result;
  try {
    result = await api.start({
      videoPaths: state.videoPaths,
      outputDirectory: state.outputDirectory,
      identifySpeakers: elements.identifySpeakersCheckbox.checked,
      splitMeetings: elements.splitMeetingsCheckbox.checked
    });
  } catch {
    result = {
      ok: false,
      code: "IPC_ERROR",
      error: "Приложение не смогло завершить обработку. Перезапустите его и повторите — готовые части будут восстановлены."
    };
  }

  state.running = false;
  stopElapsedTimer();
  elements.progressSection.hidden = true;
  updateControls();

  if (!result.ok) {
    if (result.code === "API_KEY_REQUIRED" || result.code === "INVALID_API_KEY") {
      state.hasApiKey = false;
      updateControls();
    }
    if (result.code !== "CANCELLED") showError(result.error, result.logPath);
    const createdFiles = Array.isArray(result.createdFiles) ? result.createdFiles : [];
    if (result.transcriptPath || createdFiles.length > 0) {
      state.revealPath = result.transcriptPath || createdFiles[0];
      elements.resultTitle.textContent = "Готовые файлы сохранены";
      elements.resultMessage.textContent = `Сохранено до сбоя: ${Math.max(1, createdFiles.length)}`;
      elements.showResultButton.textContent = "Показать файлы";
      elements.resultSection.hidden = false;
    }
    return;
  }

  state.revealPath = result.summaryPath;
  const fileCount = Array.isArray(result.files) ? result.files.length : 2;
  const meetingCount = Number(result.meetingCount) || 1;
  if (result.splitDetectionSkipped) {
    elements.resultTitle.textContent = "Готово — сохранено как один созвон";
    elements.resultMessage.textContent = `Автоматическое разделение не сработало · TXT-файлов: ${fileCount}`;
  } else if (meetingCount > 1) {
    elements.resultTitle.textContent = `Готово — найдено созвонов: ${meetingCount}`;
    elements.resultMessage.textContent = `Сохранено TXT-файлов: ${fileCount}`;
  } else {
    elements.resultTitle.textContent = "Готово — сохранены два TXT-файла";
    elements.resultMessage.textContent = "Расшифровка и подробная сводка готовы";
  }
  if (result.identifiedSpeakerCount > 0) {
    elements.resultMessage.textContent += ` · имён: ${result.identifiedSpeakerCount}`;
  }
  elements.showResultButton.textContent = "Показать файлы";
  elements.resultSection.hidden = false;
});

elements.cancelButton.addEventListener("click", async () => {
  elements.cancelButton.disabled = true;
  elements.progressMessage.textContent = "Останавливаю обработку…";
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
  elements.progressMessage.textContent = progress?.message || "Обработка…";
});

async function initialize() {
  const initial = await api.getState();
  state.hasApiKey = initial.hasApiKey;
  elements.versionLabel.textContent = `Версия ${initial.version}`;
  displayVideos([]);
  updateControls();
}

initialize().catch(() => showError("Не удалось запустить приложение. Перезапустите его."));
