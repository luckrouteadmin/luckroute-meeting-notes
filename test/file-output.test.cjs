"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chooseOutputPaths, deriveOutputStem, sanitizeStem } = require("../src/core/file-output.cjs");

test("имя исходного видео очищается от недопустимых символов", () => {
  assert.equal(sanitizeStem('  Созвон: продажи?  '), "Созвон продажи");
  assert.equal(sanitizeStem("..."), "созвон");
});

test("существующие результаты не перезаписываются", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-output-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "План — сводка.txt"), "old");
  const result = await chooseOutputPaths(directory, "План");
  assert.equal(path.basename(result.summaryPath), "План (2) — сводка.txt");
  assert.equal(path.basename(result.transcriptPath), "План (2) — расшифровка.txt");
});


test("несколько видео получают понятное общее имя", () => {
  const result = deriveOutputStem([
    "/tmp/Еженедельный созвон 01.mp4",
    "/tmp/Еженедельный созвон 02.mp4"
  ]);
  assert.match(result, /Еженедельный созвон/);
  assert.match(result, /объединено/);
});

test("английский режим создаёт английские имена выходных файлов", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-output-en-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const result = await chooseOutputPaths(directory, "Sales call", "en");
  assert.equal(path.basename(result.summaryPath), "Sales call — summary.txt");
  assert.equal(path.basename(result.transcriptPath), "Sales call — transcript.txt");
});
