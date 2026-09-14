"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  SUPPORTED_VIDEO_EXTENSIONS,
  isSupportedVideoPath,
  runMeetingWorkflow,
  validateInputs
} = require("../src/core/workflow.cjs");

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

test("поддерживаются MOV и другие популярные видеоформаты", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-formats-test-"));
  const outputDirectory = path.join(directory, "result");
  await fs.mkdir(outputDirectory);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const videoPaths = [];
  for (const extension of SUPPORTED_VIDEO_EXTENSIONS) {
    const videoPath = path.join(directory, `recording${extension.toUpperCase()}`);
    await fs.writeFile(videoPath, `fake ${extension}`);
    videoPaths.push(videoPath);
    assert.equal(isSupportedVideoPath(videoPath), true);
  }

  const validatedPaths = await validateInputs(videoPaths, outputDirectory);
  assert.equal(validatedPaths.length, videoPaths.length);
  assert.deepEqual(new Set(validatedPaths), new Set(videoPaths));
  assert.equal(isSupportedVideoPath(path.join(directory, "recording.txt")), false);
  await assert.rejects(
    validateInputs([path.join(directory, "recording.txt")], outputDirectory),
    /MP4, MOV, M4V, MKV, AVI и WebM/
  );
});

test("рабочий процесс сохраняет расшифровку и сводку", async (t) => {
  const paths = await fixture(t);
  const progress = [];
  const result = await runMeetingWorkflow({
    ...paths,
    apiKey: "not-used",
    identifySpeakers: false,
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

test("английский режим локализует процесс и оба результата", async (t) => {
  const paths = await fixture(t);
  const progress = [];
  const result = await runMeetingWorkflow({
    ...paths,
    apiKey: "not-used",
    locale: "en",
    identifySpeakers: false,
    onProgress: (event) => progress.push(event),
    dependencies: {
      splitAudio: fakeSplitAudio(),
      transcribeAudioFile: async ({ locale }) => {
        assert.equal(locale, "en");
        return {
          text: "We discussed sales",
          segments: [{ start: 0, end: 3, speaker: "A", text: "We discussed sales" }]
        };
      },
      summarizeTranscript: async ({ transcript, locale }) => {
        assert.equal(locale, "en");
        assert.match(transcript, /Speaker A/);
        return "EXECUTIVE SUMMARY\nWe discussed sales.";
      }
    }
  });

  assert.match(path.basename(result.transcriptPath), /transcript\.txt$/);
  assert.match(path.basename(result.summaryPath), /summary\.txt$/);
  assert.match(await fs.readFile(result.transcriptPath, "utf8"), /FULL MEETING TRANSCRIPT/);
  assert.match(await fs.readFile(result.summaryPath, "utf8"), /MEETING SUMMARY/);
  assert.match(progress.at(-1).message, /both TXT files/);
});

test("рабочий процесс подставляет подтверждённое по кадрам имя", async (t) => {
  const paths = await fixture(t);
  const systemFetch = async () => new Response(null, { status: 204 });
  const result = await runMeetingWorkflow({
    ...paths,
    apiKey: "not-used",
    fetchImpl: systemFetch,
    dependencies: {
      splitAudio: fakeSplitAudio(),
      transcribeAudioFile: async ({ fetchImpl }) => {
        assert.equal(fetchImpl, systemFetch);
        return {
          text: "Первое сообщение. Второе сообщение.",
          segments: [
            { start: 0, end: 5, speaker: "A", text: "Первое сообщение" },
            { start: 12, end: 18, speaker: "A", text: "Второе сообщение" }
          ]
        };
      },
      extractSpeakerFrames: async ({ samples }) => samples.map((sample) => ({
        ...sample,
        framePath: `/temporary/${sample.sampleId}.jpg`
      })),
      identifySpeakersFromFrames: async ({ samples, fetchImpl }) => {
        assert.equal(fetchImpl, systemFetch);
        return samples.map((sample) => ({
          sample_id: sample.sampleId,
          active_speaker_name: "Максим",
          active_indicator_visible: true,
          name_label_visible: true,
          confidence: "high"
        }));
      },
      summarizeTranscript: async ({ transcript, fetchImpl }) => {
        assert.equal(fetchImpl, systemFetch);
        assert.match(transcript, /Максим: Первое сообщение/);
        return "КРАТКОЕ РЕЗЮМЕ\nОбсудили вопрос.";
      }
    }
  });
  assert.equal(result.identifiedSpeakerCount, 1);
  assert.match(await fs.readFile(result.transcriptPath, "utf8"), /Имена, определённые по видео: Максим/);
});

test("сбой необязательного анализа кадров не мешает создать оба TXT", async (t) => {
  const paths = await fixture(t);
  const result = await runMeetingWorkflow({
    ...paths,
    apiKey: "not-used",
    dependencies: {
      splitAudio: fakeSplitAudio(),
      transcribeAudioFile: async () => ({
        text: "Текст",
        segments: [{ start: 0, end: 5, speaker: "A", text: "Текст" }]
      }),
      extractSpeakerFrames: async () => { throw new Error("vision unavailable"); },
      summarizeTranscript: async () => "КРАТКОЕ РЕЗЮМЕ\nТекст."
    }
  });
  assert.equal(result.identifiedSpeakerCount, 0);
  assert.match(await fs.readFile(result.transcriptPath, "utf8"), /Спикер A: Текст/);
  assert.match(await fs.readFile(result.summaryPath, "utf8"), /КРАТКОЕ РЕЗЮМЕ/);
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

test("несколько видео разных форматов сортируются естественно и делятся на отдельные созвоны", async (t) => {
  const paths = await fixture(t);
  const secondVideo = path.join(path.dirname(paths.videoPath), "План продаж 2.mov");
  await fs.rename(paths.videoPath, path.join(path.dirname(paths.videoPath), "План продаж 10.mp4"));
  const tenthVideo = path.join(path.dirname(paths.videoPath), "План продаж 10.mp4");
  await fs.writeFile(secondVideo, "fake mov 2");
  const transcribed = [];

  const result = await runMeetingWorkflow({
    videoPaths: [tenthVideo, secondVideo],
    outputDirectory: paths.outputDirectory,
    apiKey: "not-used",
    identifySpeakers: false,
    splitMeetings: true,
    dependencies: {
      splitAudio: fakeSplitAudio(),
      transcribeAudioFile: async ({ filePath }) => {
        const sourceFolder = path.basename(path.dirname(filePath));
        transcribed.push(sourceFolder);
        const index = transcribed.length;
        return {
          text: `Созвон ${index}`,
          segments: [{ start: 0, end: 3, speaker: "A", text: `Созвон ${index}` }]
        };
      },
      detectMeetingBoundaries: async ({ utterances }) => [
        { title: "Продажи", start_segment_id: utterances[0].id, end_segment_id: utterances[0].id },
        { title: "Маркетинг", start_segment_id: utterances[1].id, end_segment_id: utterances[1].id }
      ],
      summarizeTranscript: async ({ transcript }) => `КРАТКОЕ РЕЗЮМЕ\n${transcript.includes("Созвон 1") ? "Первая встреча" : "Вторая встреча"}.`
    }
  });

  assert.equal(result.meetingCount, 2);
  assert.equal(result.files.length, 4);
  assert.equal(transcribed.length, 2);
  assert.ok(result.files.every((filePath) => filePath.includes("созвон 0")));
  const summaries = result.files.filter((filePath) => filePath.endsWith("сводка.txt"));
  assert.equal(summaries.length, 2);
  assert.match(await fs.readFile(summaries[0], "utf8"), /Название: Продажи/);
});
