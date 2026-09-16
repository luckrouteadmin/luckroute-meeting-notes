"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "app/main.cjs",
  "app/preload.cjs",
  "src/ui/index.html",
  "src/ui/styles.css",
  "src/ui/renderer.js",
  "src/core/workflow.cjs",
  "src/core/checkpoint.cjs",
  "src/core/meeting-boundaries.cjs",
  "src/core/openai-api.cjs",
  "src/core/speaker-identity.cjs",
  "src/core/video.cjs",
  "src/core/prompt.cjs",
  "src/core/locale.cjs",
  "src/core/local-engine.cjs",
  "src/core/summary-detail.cjs",
  "src/core/local-models.cjs",
  "src/core/local-process.cjs",
  "scripts/build-local-engines.cjs",
  "src/ui/luckroute.svg",
  "scripts/mac-adhoc-sign.cjs",
  "build/entitlements.mac.plist",
  "build/native-utf8.manifest",
  "build/icon.png",
  "build/icon.ico",
  ".github/workflows/build-installers.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/dependabot.yml",
  ".github/CODEOWNERS",
  "SECURITY.md",
  "package-lock.json"
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Нет обязательного файла: ${relativePath}`);
  }
}

const javascriptFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", "dist", ".native-cache", "resources", ".git"].includes(entry.name)) collect(fullPath);
    if (entry.isFile() && /\.(?:cjs|js)$/.test(entry.name)) javascriptFiles.push(fullPath);
  }
}
collect(root);

for (const filePath of javascriptFiles) {
  execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.build?.nsis?.oneClick !== false || packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) {
  throw new Error("Windows-сборка должна использовать мастер установки с выбором папки.");
}

if (packageJson.build?.mac?.identity !== "-" || packageJson.build?.mac?.sign !== "./scripts/mac-adhoc-sign.cjs") {
  throw new Error("macOS-сборка должна получать проверяемую ad-hoc-подпись без сертификата.");
}

if (packageJson.version !== "1.3.1") {
  throw new Error("Версия сборки должна быть 1.3.1.");
}

const lockJson = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (lockJson.lockfileVersion !== 3 || lockJson.packages?.[""]?.version !== packageJson.version) {
  throw new Error("package-lock.json должен фиксировать зависимости и совпадать с версией приложения.");
}

for (const relativePath of [
  ".github/workflows/build-installers.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml"
]) {
  const workflowText = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const line of workflowText.split(/\r?\n/)) {
    const match = line.match(/^\s*-?\s*uses:\s*[^@\s]+@([^\s#]+)/);
    if (match && !/^[0-9a-f]{40}$/.test(match[1])) {
      throw new Error(`GitHub Action в ${relativePath} должна быть закреплена полным SHA: ${line.trim()}`);
    }
  }
}

const releaseWorkflow = fs.readFileSync(path.join(root, ".github/workflows/build-installers.yml"), "utf8");
if (/\n\s*push\s*:/.test(releaseWorkflow) || releaseWorkflow.includes("--clobber")) {
  throw new Error("Релизы должны запускаться вручную и никогда не перезаписывать опубликованные файлы.");
}
for (const marker of ["npm ci", "SHA256SUMS.txt", "actions/attest@", "immutable"]) {
  if (!releaseWorkflow.includes(marker)) throw new Error(`В защищённой сборке отсутствует: ${marker}`);
}

const mainProcess = fs.readFileSync(path.join(root, "app/main.cjs"), "utf8");
if (!mainProcess.includes("net.fetch") || !mainProcess.includes("fetchImpl")) {
  throw new Error("Запросы OpenAI должны использовать системный сетевой стек Electron.");
}

const interfaceHtml = fs.readFileSync(path.join(root, "src/ui/index.html"), "utf8");
if (interfaceHtml.includes("identifySpeakersCheckbox") || !interfaceHtml.includes("identityNotice") || !interfaceHtml.includes("splitMeetingsCheckbox")) {
  throw new Error("Определение участников должно быть автоматическим, разделение созвонов — по выбору.");
}
if (!interfaceHtml.includes("languageSwitch") || !interfaceHtml.includes("data-i18n")) {
  throw new Error("Интерфейс должен поддерживать переключение русского и английского языков.");
}

if (packageJson.author !== "Luckroute IT department") {
  throw new Error("Разработчиком должен быть указан Luckroute IT department.");
}

if (!mainProcess.includes("powerSaveBlocker") || !mainProcess.includes("multiSelections")) {
  throw new Error("Главный процесс должен защищать долгую обработку и поддерживать несколько видеофайлов.");
}

const media = require("../src/core/media.cjs");
for (const extension of [".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff", ".aif", ".amr"]) {
  if (!media.SUPPORTED_MEDIA_EXTENSIONS.includes(extension)) {
    throw new Error(`В списке поддерживаемых форматов нет ${extension}.`);
  }
}
if (!mainProcess.includes("SUPPORTED_MEDIA_EXTENSIONS") || !mainProcess.includes("identifySpeakers: true")) {
  throw new Error("Диалог выбора должен поддерживать все медиаформаты, определение участников — включаться автоматически.");
}

const openAiApi = fs.readFileSync(path.join(root, "src/core/openai-api.cjs"), "utf8");
if (!openAiApi.includes("status >= 500") || !openAiApi.includes("REQUEST_ATTEMPTS = 5")) {
  throw new Error("Сетевые запросы должны повторять все ошибки HTTP 5xx не менее пяти раз.");
}

const prompt = fs.readFileSync(path.join(root, "src/core/prompt.cjs"), "utf8");
for (const heading of ["КРАТКОЕ РЕЗЮМЕ", "ОБСУЖДЕНИЕ ПО ТЕМАМ", "ПРИНЯТЫЕ РЕШЕНИЯ", "ЗАДАЧИ ПО ОТВЕТСТВЕННЫМ", "ОТКРЫТЫЕ ВОПРОСЫ", "ИТОГИ"]) {
  if (!prompt.includes(heading)) throw new Error(`В шаблоне сводки нет раздела: ${heading}`);
}

process.stdout.write(`Проверено файлов JavaScript: ${javascriptFiles.length}. Проект собран корректно.\n`);
