"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

function sanitizeStem(value) {
  const cleaned = String(value || "созвон")
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || "созвон";
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

async function atomicWriteText(destination, content) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `\uFEFF${content}`, "utf8");
  await fs.rename(temporary, destination);
}

function formatSummaryFile(summary, { sourceName, createdAt = new Date() }) {
  return [
    "СВОДКА СОЗВОНА",
    `Исходный файл: ${sourceName}`,
    `Создано: ${createdAt.toLocaleString("ru-RU")}`,
    "",
    summary.trim(),
    ""
  ].join("\n");
}

module.exports = {
  atomicWriteText,
  chooseOutputPaths,
  formatSummaryFile,
  sanitizeStem
};

