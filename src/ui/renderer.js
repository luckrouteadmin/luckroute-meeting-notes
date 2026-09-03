"use strict";

const api = window.meetingNotes;
const elements = {
  keyNotice: document.querySelector("#keyNotice"),
  settingsButton: document.querySelector("#settingsButton"),
  noticeSettingsButton: document.querySelector("#noticeSettingsButton"),
  chooseVideoButton: document.querySelector("#chooseVideoButton"),
  chooseOutputButton: document.querySelector("#chooseOutputButton"),
  identifySpeakersCheckbox: document.querySelector("#identifySpeakersCheckbox"),
  videoPath: document.querySelector("#videoPath"),
  outputPath: document.querySelector("#outputPath"),
  startButton: document.querySelector("#startButton"),
  cancelButton: document.querySelector("#cancelButton"),
  progressSection: document.querySelector("#progressSection"),
  progressMessage: document.querySelector("#progressMessage"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  resultSection: document.querySelector("#resultSection"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMessage: document.querySelector("#resultMessage"),
  showResultButton: document.querySelector("#showResultButton"),
  errorMessage: document.querySelector("#errorMessage"),
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
  videoPath: null,
  outputDirectory: null,
  hasApiKey: false,
  running: false,
  revealPath: null
};

function basename(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function displayPath(element, value, placeholder) {
  element.textContent = value || placeholder;
  element.title = value || "";
  element.classList.toggle("empty", !value);
}

function updateControls() {
  elements.startButton.disabled = state.running || !state.videoPath || !state.outputDirectory;
  elements.chooseVideoButton.disabled = state.running;
  elements.chooseOutputButton.disabled = state.running;
  elements.identifySpeakersCheckbox.disabled = state.running;
  elements.settingsButton.disabled = state.running;
  elements.cancelButton.hidden = !state.running;
  elements.keyNotice.hidden = state.hasApiKey;
  elements.deleteKeyButton.hidden = !state.hasApiKey;
}

function hideMessages() {
  elements.errorMessage.hidden = true;
  elements.resultSection.hidden = true;
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
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
  state.videoPath = selected;
  displayPath(elements.videoPath, selected, "MP4-файл не выбран");
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
  updateControls();

  const result = await api.start({
    videoPath: state.videoPath,
    outputDirectory: state.outputDirectory,
    identifySpeakers: elements.identifySpeakersCheckbox.checked
  });

  state.running = false;
  elements.progressSection.hidden = true;
  updateControls();

  if (!result.ok) {
    if (result.code === "API_KEY_REQUIRED" || result.code === "INVALID_API_KEY") {
      state.hasApiKey = false;
      updateControls();
    }
    if (result.code !== "CANCELLED") showError(result.error);
    if (result.transcriptPath) {
      state.revealPath = result.transcriptPath;
      elements.resultTitle.textContent = "Расшифровка сохранена";
      elements.resultMessage.textContent = basename(result.transcriptPath);
      elements.showResultButton.textContent = "Показать файл";
      elements.resultSection.hidden = false;
    }
    return;
  }

  state.revealPath = result.summaryPath;
  elements.resultTitle.textContent = "Готово — сохранены два TXT-файла";
  elements.resultMessage.textContent = result.identifiedSpeakerCount > 0
    ? `${basename(result.summaryPath)} · имён определено: ${result.identifiedSpeakerCount}`
    : basename(result.summaryPath);
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
  updateControls();
}

initialize().catch(() => showError("Не удалось запустить приложение. Перезапустите его."));
