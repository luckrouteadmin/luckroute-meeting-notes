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
  "src/core/openai-api.cjs",
  "src/core/speaker-identity.cjs",
  "src/core/video.cjs",
  "src/core/prompt.cjs",
  "scripts/mac-adhoc-sign.cjs",
  "build/entitlements.mac.plist",
  "build/icon.png",
  "build/icon.ico",
  ".github/workflows/build-installers.yml"
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
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") collect(fullPath);
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

if (packageJson.version !== "1.1.0") {
  throw new Error("Версия сборки должна быть 1.1.0.");
}

const interfaceHtml = fs.readFileSync(path.join(root, "src/ui/index.html"), "utf8");
if (!interfaceHtml.includes("identifySpeakersCheckbox") || !interfaceHtml.includes("отдельные временные кадры")) {
  throw new Error("Интерфейс должен явно сообщать об анализе отдельных кадров.");
}

const prompt = fs.readFileSync(path.join(root, "src/core/prompt.cjs"), "utf8");
for (const heading of ["КРАТКОЕ РЕЗЮМЕ", "ОБСУЖДЕНИЕ ПО ТЕМАМ", "ПРИНЯТЫЕ РЕШЕНИЯ", "ЗАДАЧИ ПО ОТВЕТСТВЕННЫМ", "ОТКРЫТЫЕ ВОПРОСЫ", "ИТОГИ"]) {
  if (!prompt.includes(heading)) throw new Error(`В шаблоне сводки нет раздела: ${heading}`);
}

process.stdout.write(`Проверено файлов JavaScript: ${javascriptFiles.length}. Проект собран корректно.\n`);
