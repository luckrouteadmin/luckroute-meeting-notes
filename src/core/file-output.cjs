"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { translate } = require("./locale.cjs");

function sanitizeStem(value, maximumLength = 100, fallback = "созвон") {
  const cleaned = String(value || fallback)
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback)
    .slice(0, Math.max(12, maximumLength))
    .replace(/[. ]+$/g, "");
}

function deriveOutputStem(videoPaths, locale = "ru") {
  const fallback = translate(locale, "defaultStem");
  const stems = videoPaths.map((filePath) => sanitizeStem(
    path.basename(filePath, path.extname(filePath)),
    64,
    fallback
  ));
  if (stems.length <= 1) return stems[0] || fallback;

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
  return sanitizeStem(translate(locale, "combinedStem", { stem: base }), 82, fallback);
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

async function chooseOutputPaths(outputDirectory, originalStem, locale = "ru") {
  const fallback = translate(locale, "defaultStem");
  const stem = sanitizeStem(originalStem, 100, fallback);
  const transcriptSuffix = translate(locale, "transcriptSuffix");
  const summarySuffix = translate(locale, "summarySuffix");
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const decorated = suffix === 1 ? stem : `${stem} (${suffix})`;
    const transcriptPath = path.join(outputDirectory, `${decorated} — ${transcriptSuffix}.txt`);
    const summaryPath = path.join(outputDirectory, `${decorated} — ${summarySuffix}.txt`);
    if (!(await exists(transcriptPath)) && !(await exists(summaryPath))) {
      return { transcriptPath, summaryPath };
    }
  }
  throw new Error(translate(locale, "outputNameFailure"));
}

async function chooseMeetingOutputPaths(outputDirectory, baseStem, meetings, locale = "ru") {
  const multiple = meetings.length > 1;
  const outputPaths = [];
  const fallback = translate(locale, "defaultStem");
  for (let index = 0; index < meetings.length; index += 1) {
    const number = String(index + 1).padStart(2, "0");
    const title = sanitizeStem(
      meetings[index]?.title || translate(locale, "defaultMeetingNumber", { number: index + 1 }),
      42,
      fallback
    );
    const stem = multiple
      ? translate(locale, "meetingStem", {
        stem: sanitizeStem(baseStem, 52, fallback),
        number,
        title
      })
      : baseStem;
    outputPaths.push(await chooseOutputPaths(outputDirectory, stem, locale));
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
  createdAt = new Date(),
  locale = "ru"
}) {
  const names = (Array.isArray(sourceNames) ? sourceNames : [sourceName]).filter(Boolean);
  const sourceLines = names.length <= 1
    ? [translate(locale, "sourceFile", {
      name: names[0] || translate(locale, "notSpecified")
    })]
    : [translate(locale, "sourceFiles"), ...names.map((name, index) => `${index + 1}. ${name}`)];
  return [
    translate(locale, "summaryTitle"),
    ...(title ? [translate(locale, "titleLabel", { title })] : []),
    ...sourceLines,
    translate(locale, "createdLabel", {
      date: createdAt.toLocaleString(translate(locale, "dateLocale"))
    }),
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
