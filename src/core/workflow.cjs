"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { splitAudio, AUDIO_CHUNK_SECONDS } = require("./audio.cjs");
const {
  identifySpeakersFromFrames,
  transcribeAudioFile,
  summarizeTranscript
} = require("./openai-api.cjs");
const { extractSpeakerFrames } = require("./video.cjs");
const {
  aggregateSpeakerNames,
  applySpeakerNames,
  selectSpeakerSamples
} = require("./speaker-identity.cjs");
const { formatFullTranscript } = require("./transcript.cjs");
const {
  atomicWriteText,
  chooseOutputPaths,
  formatSummaryFile
} = require("./file-output.cjs");
const { CancelledError } = require("./errors.cjs");

async function validateInputs(videoPath, outputDirectory) {
  if (typeof videoPath !== "string" || !path.isAbsolute(videoPath) || path.extname(videoPath).toLowerCase() !== ".mp4") {
    throw new Error("Выберите MP4-файл с записью созвона.");
  }
  if (typeof outputDirectory !== "string" || !path.isAbsolute(outputDirectory)) {
    throw new Error("Выберите папку для сохранения результата.");
  }
  const [videoStat, outputStat] = await Promise.all([fs.stat(videoPath), fs.stat(outputDirectory)]);
  if (!videoStat.isFile()) throw new Error("Выбранный MP4 не является файлом.");
  if (!outputStat.isDirectory()) throw new Error("Выбранное место сохранения не является папкой.");
}

async function runMeetingWorkflow({
  videoPath,
  outputDirectory,
  apiKey,
  identifySpeakers = true,
  signal,
  onProgress = () => {},
  dependencies = {}
}) {
  await validateInputs(videoPath, outputDirectory);
  if (signal?.aborted) throw new CancelledError();

  const sourceName = path.basename(videoPath);
  const originalStem = path.basename(videoPath, path.extname(videoPath));
  const outputPaths = await chooseOutputPaths(outputDirectory, originalStem);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-notes-"));
  const splitAudioImpl = dependencies.splitAudio || splitAudio;
  const transcribeImpl = dependencies.transcribeAudioFile || transcribeAudioFile;
  const summarizeImpl = dependencies.summarizeTranscript || summarizeTranscript;
  const extractFramesImpl = dependencies.extractSpeakerFrames || extractSpeakerFrames;
  const identifyFramesImpl = dependencies.identifySpeakersFromFrames || identifySpeakersFromFrames;

  try {
    onProgress({ stage: "audio", percent: 4, message: "Извлекаю звук из видео…" });
    const chunks = await splitAudioImpl({
      inputPath: videoPath,
      outputDirectory: temporaryDirectory,
      signal
    });

    const parts = [];
    for (let index = 0; index < chunks.length; index += 1) {
      if (signal?.aborted) throw new CancelledError();
      onProgress({
        stage: "transcription",
        percent: 10 + Math.round(((index + 1) / chunks.length) * 45),
        message: `Расшифровываю часть ${index + 1} из ${chunks.length}…`
      });
      const result = await transcribeImpl({
        filePath: chunks[index],
        apiKey,
        signal
      });
      parts.push({
        text: result.text || "",
        segments: result.segments || [],
        offsetSeconds: index * AUDIO_CHUNK_SECONDS
      });
    }

    let resolvedParts = parts;
    let identifiedSpeakerCount = 0;
    if (identifySpeakers) {
      const samples = selectSpeakerSamples(parts);
      if (samples.length > 0) {
        onProgress({
          stage: "speaker-identification",
          percent: 58,
          message: "Определяю имена участников по видео…"
        });
        try {
          const frames = await extractFramesImpl({
            inputPath: videoPath,
            samples,
            outputDirectory: temporaryDirectory,
            signal
          });
          if (frames.length > 0) {
            const observations = await identifyFramesImpl({
              samples: frames,
              apiKey,
              signal
            });
            const mappings = aggregateSpeakerNames(frames, observations);
            identifiedSpeakerCount = Object.keys(mappings).length;
            resolvedParts = applySpeakerNames(parts, mappings);
          }
        } catch (error) {
          if (signal?.aborted || error instanceof CancelledError) throw new CancelledError();
          onProgress({
            stage: "speaker-identification-skipped",
            percent: 61,
            message: "Имена определить не удалось — продолжаю с нейтральными метками спикеров."
          });
        }
      }
    }

    const createdAt = new Date();
    const transcript = formatFullTranscript(resolvedParts, { sourceName, createdAt });
    await atomicWriteText(outputPaths.transcriptPath, transcript);
    onProgress({
      stage: "saved-transcript",
      percent: 66,
      message: identifiedSpeakerCount > 0
        ? `Полная расшифровка сохранена. Определено имён: ${identifiedSpeakerCount}.`
        : "Полная расшифровка сохранена."
    });

    let summary;
    try {
      summary = await summarizeImpl({
        transcript,
        apiKey,
        signal,
        onProgress
      });
    } catch (error) {
      error.transcriptPath = outputPaths.transcriptPath;
      throw error;
    }

    await atomicWriteText(
      outputPaths.summaryPath,
      formatSummaryFile(summary, { sourceName, createdAt })
    );
    onProgress({ stage: "complete", percent: 100, message: "Готово: оба TXT-файла сохранены." });
    return { ...outputPaths, identifiedSpeakerCount };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { runMeetingWorkflow, validateInputs };
