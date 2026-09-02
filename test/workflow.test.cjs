"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runMeetingWorkflow } = require("../src/core/workflow.cjs");

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-workflow-test-"));
  const videoPath = path.join(directory, "План продаж.mp4");
  const outputDirectory = path.join(directory, "result");
  await fs.writeFile(videoPath, "fake mp4");
  await fs.mkdir(outputDirectory);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { videoPath, outputDirectory };
}

function fakeSplitAudio() {
  return async ({ outputDirectory }) => {
    const chunk = path.join(outputDirectory, "audio-000.mp3");
    await fs.writeFile(chunk, "audio");
    return [chunk];
  };
}

test("рабочий процесс сохраняет расшифровку и сводку", async (t) => {
  const paths = await fixture(t);
  const progress = [];
  const result = await runMeetingWorkflow({
    ...paths,
    apiKey: "not-used",
    onProgress: (event) => progress.push(event),
    dependencies: {
      splitAudio: fakeSplitAudio(),
      transcribeAudioFile: async () => ({
        text: "Обсудили продажи",
        segments: [{ start: 0, end: 3, speaker: "A", text: "Обсудили продажи" }]
      }),
      summarizeTranscript: async () => "КРАТКОЕ РЕЗЮМЕ\nОбсудили продажи."
    }
  });
  const transcript = await fs.readFile(result.transcriptPath, "utf8");
  const summary = await fs.readFile(result.summaryPath, "utf8");
  assert.match(transcript, /Спикер A: Обсудили продажи/);
  assert.match(summary, /КРАТКОЕ РЕЗЮМЕ/);
  assert.equal(progress.at(-1).percent, 100);
});

test("при сбое сводки уже готовая расшифровка остаётся на диске", async (t) => {
  const paths = await fixture(t);
  let capturedError;
  try {
    await runMeetingWorkflow({
      ...paths,
      apiKey: "not-used",
      dependencies: {
        splitAudio: fakeSplitAudio(),
        transcribeAudioFile: async () => ({ text: "Важный текст" }),
        summarizeTranscript: async () => { throw new Error("summary failed"); }
      }
    });
  } catch (error) {
    capturedError = error;
  }
  assert.ok(capturedError);
  assert.ok(capturedError.transcriptPath);
  assert.match(await fs.readFile(capturedError.transcriptPath, "utf8"), /Важный текст/);
});
