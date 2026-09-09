"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

function sanitizeStem(value, maximumLength = 100) {
  const cleaned = String(value || "созвон")
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || "созвон")
    .slice(0, Math.max(12, maximumLength))
    .replace(/[. ]+$/g, "");
}

function deriveOutputStem(videoPaths) {
  const stems = videoPaths.map((filePath) => sanitizeStem(
    path.basename(filePath, path.extname(filePath)),
    64
  ));
  if (stems.length <= 1) return stems[0] || "созвон";

  let common = stems[0];
  for (const stem of stems.slice(1)) {
    let index = 0;
    while (
      index < common.length
      && index < stem.length
      && common[index].toLocaleLowerCase("ru-RU") === stem[index].toLocaleLowerCase("ru-RU")
    ) index += 1;
    common = common.slice(0, index);
  }
  common = common.replace(/[\s_.–—-]+$/g, "").trim();
  const base = common.length >= 4 ? common : stems[0];
  return sanitizeStem(`${base} — объединено`, 82);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function chooseOutputPaths(outputDirectory, originalStem) {
  const stem = sanitizeStem(originalStem);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const decorated = suffix === 1 ? stem : `${stem} (${suffix})`;
    const transcriptPath = path.join(outputDirectory, `${decorated} — расшифровка.txt`);
    const summaryPath = path.join(outputDirectory, `${decorated} — сводка.txt`);
    if (!(await exists(transcriptPath)) && !(await exists(summaryPath))) {
      return { transcriptPath, summaryPath };
    }
  }
  throw new Error("Не удалось подобрать свободное имя для файлов результата.");
}

async function chooseMeetingOutputPaths(outputDirectory, baseStem, meetings) {
  const multiple = meetings.length > 1;
  const outputPaths = [];
  for (let index = 0; index < meetings.length; index += 1) {
    const title = sanitizeStem(meetings[index]?.title || `Созвон ${index + 1}`, 42);
    const stem = multiple
      ? `${sanitizeStem(baseStem, 52)} — созвон ${String(index + 1).padStart(2, "0")} — ${title}`
      : baseStem;
    outputPaths.push(await chooseOutputPaths(outputDirectory, stem));
  }
  return outputPaths;
}

async function atomicWriteText(destination, content) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `\uFEFF${content}`, "utf8");
  await fs.rename(temporary, destination);
}

function formatSummaryFile(summary, {
  sourceName,
  sourceNames,
  title,
  createdAt = new Date()
}) {
  const names = (Array.isArray(sourceNames) ? sourceNames : [sourceName]).filter(Boolean);
  const sourceLines = names.length <= 1
    ? [`Исходный файл: ${names[0] || "не указан"}`]
    : ["Исходные файлы (в порядке обработки):", ...names.map((name, index) => `${index + 1}. ${name}`)];
  return [
    "СВОДКА СОЗВОНА",
    ...(title ? [`Название: ${title}`] : []),
    ...sourceLines,
    `Создано: ${createdAt.toLocaleString("ru-RU")}`,
    "",
    summary.trim(),
    ""
  ].join("\n");
}

module.exports = {
  atomicWriteText,
  chooseMeetingOutputPaths,
  chooseOutputPaths,
  deriveOutputStem,
  formatSummaryFile,
  sanitizeStem
};
