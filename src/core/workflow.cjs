"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { splitAudio, AUDIO_CHUNK_SECONDS } = require("./audio.cjs");
const {
  detectMeetingBoundaries,
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
const {
  flattenTranscriptParts,
  formatTranscriptUtterances
} = require("./transcript.cjs");
const {
  atomicWriteText,
  chooseMeetingOutputPaths,
  deriveOutputStem,
  formatSummaryFile
} = require("./file-output.cjs");
const {
  normalizeMeetingRanges,
  splitUtterancesByMeetings
} = require("./meeting-boundaries.cjs");
const { openCheckpoint } = require("./checkpoint.cjs");
const { CancelledError, isCancelled } = require("./errors.cjs");
const { normalizeLocale, translate } = require("./locale.cjs");

const MAX_VIDEO_FILES = 20;
const SUPPORTED_VIDEO_EXTENSIONS = Object.freeze([
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi",
  ".webm"
]);
const SUPPORTED_VIDEO_EXTENSION_SET = new Set(SUPPORTED_VIDEO_EXTENSIONS);
const SUPPORTED_VIDEO_FORMATS_TEXT = "MP4, MOV, M4V, MKV, AVI и WebM";
const VIDEO_COLLATOR = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

function isSupportedVideoPath(videoPath) {
  return typeof videoPath === "string"
    && SUPPORTED_VIDEO_EXTENSION_SET.has(path.extname(videoPath).toLowerCase());
}

function normalizeVideoPaths(videoPaths, legacyVideoPath) {
  const candidates = Array.isArray(videoPaths)
    ? videoPaths
    : typeof videoPaths === "string"
      ? [videoPaths]
      : [legacyVideoPath];
  const unique = new Map();
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = path.resolve(candidate);
    const key = process.platform === "linux" ? resolved : resolved.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, resolved);
  }
  return [...unique.values()].sort((left, right) => (
    VIDEO_COLLATOR.compare(path.basename(left), path.basename(right))
    || VIDEO_COLLATOR.compare(left, right)
  ));
}

async function validateInputs(videoPaths, outputDirectory, legacyVideoPath, locale = "ru") {
  const normalizedLocale = normalizeLocale(locale);
  const normalizedPaths = normalizeVideoPaths(videoPaths, legacyVideoPath);
  if (normalizedPaths.length === 0) {
    throw new Error(translate(normalizedLocale, "noVideos"));
  }
  if (normalizedPaths.length > MAX_VIDEO_FILES) {
    throw new Error(translate(normalizedLocale, "tooManyVideos", { max: MAX_VIDEO_FILES }));
  }
  for (const videoPath of normalizedPaths) {
    if (!path.isAbsolute(videoPath) || !isSupportedVideoPath(videoPath)) {
      const formats = normalizedLocale === "ru"
        ? SUPPORTED_VIDEO_FORMATS_TEXT
        : "MP4, MOV, M4V, MKV, AVI, and WebM";
      throw new Error(translate(normalizedLocale, "supportedFormats", { formats }));
    }
  }
  if (typeof outputDirectory !== "string" || !path.isAbsolute(outputDirectory)) {
    throw new Error(translate(normalizedLocale, "chooseOutputDirectory"));
  }

  const [videoStats, outputStat] = await Promise.all([
    Promise.all(normalizedPaths.map((videoPath) => fs.stat(videoPath))),
    fs.stat(outputDirectory)
  ]);
  if (videoStats.some((stat) => !stat.isFile())) {
    throw new Error(translate(normalizedLocale, "sourceNotFile"));
  }
  if (!outputStat.isDirectory()) {
    throw new Error(translate(normalizedLocale, "outputNotDirectory"));
  }
  return normalizedPaths;
}

function createMemoryCheckpoint() {
  const transcriptions = {};
  return {
    get: (key) => transcriptions[key] || null,
    set: async (key, value) => { transcriptions[key] = value; },
    remove: async () => {}
  };
}

function retryProgress(onProgress, percent, subjectKey, locale) {
  return ({ nextAttempt, maxAttempts, delayMs }) => onProgress({
    stage: "network-retry",
    percent,
    message: translate(locale, "networkRetry", {
      subject: translate(locale, subjectKey),
      next: nextAttempt,
      max: maxAttempts,
      seconds: Math.max(1, Math.ceil((delayMs || 0) / 1000))
    })
  });
}

async function runMeetingWorkflow({
  videoPath,
  videoPaths,
  outputDirectory,
  apiKey,
  identifySpeakers = true,
  splitMeetings = false,
  locale = "ru",
  checkpointDirectory,
  signal,
  fetchImpl,
  onProgress = () => {},
  dependencies = {}
}) {
  const normalizedLocale = normalizeLocale(locale);
  const normalizedVideoPaths = await validateInputs(
    videoPaths,
    outputDirectory,
    videoPath,
    normalizedLocale
  );
  if (signal?.aborted) throw new CancelledError(undefined, normalizedLocale);

  const sources = normalizedVideoPaths.map((sourcePath, sourceIndex) => ({
    sourceIndex,
    sourcePath,
    sourceName: path.basename(sourcePath)
  }));
  const sourceNames = sources.map((source) => source.sourceName);
  const outputStem = deriveOutputStem(normalizedVideoPaths, normalizedLocale);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-notes-"));
  const splitAudioImpl = dependencies.splitAudio || splitAudio;
  const transcribeImpl = dependencies.transcribeAudioFile || transcribeAudioFile;
  const summarizeImpl = dependencies.summarizeTranscript || summarizeTranscript;
  const extractFramesImpl = dependencies.extractSpeakerFrames || extractSpeakerFrames;
  const identifyFramesImpl = dependencies.identifySpeakersFromFrames || identifySpeakersFromFrames;
  const detectBoundariesImpl = dependencies.detectMeetingBoundaries || detectMeetingBoundaries;
  const openCheckpointImpl = dependencies.openCheckpoint || openCheckpoint;
  const createdFiles = [];
  let checkpoint;

  try {
    try {
      checkpoint = await openCheckpointImpl({
        directory: checkpointDirectory,
        videoPaths: normalizedVideoPaths
      });
    } catch {
      checkpoint = createMemoryCheckpoint();
      onProgress({
        stage: "checkpoint-unavailable",
        percent: 1,
        message: translate(normalizedLocale, "checkpointUnavailable")
      });
    }

    const chunkGroups = [];
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      if (signal?.aborted) throw new CancelledError(undefined, normalizedLocale);
      const source = sources[sourceIndex];
      const audioDirectory = path.join(
        temporaryDirectory,
        `audio-${String(sourceIndex + 1).padStart(2, "0")}`
      );
      await fs.mkdir(audioDirectory, { recursive: true });
      onProgress({
        stage: "audio",
        percent: 3 + Math.round(((sourceIndex + 1) / sources.length) * 8),
        message: sources.length > 1
          ? translate(normalizedLocale, "audioMany", {
            current: sourceIndex + 1,
            total: sources.length
          })
          : translate(normalizedLocale, "audioOne")
      });
      const chunks = await splitAudioImpl({
        inputPath: source.sourcePath,
        outputDirectory: audioDirectory,
        signal
      });
      chunkGroups.push({ ...source, chunks });
    }

    const totalChunks = chunkGroups.reduce((sum, group) => sum + group.chunks.length, 0);
    const parts = [];
    let completedChunks = 0;
    let checkpointWarningShown = false;
    for (const group of chunkGroups) {
      for (let chunkIndex = 0; chunkIndex < group.chunks.length; chunkIndex += 1) {
        if (signal?.aborted) throw new CancelledError(undefined, normalizedLocale);
        const progressPercent = 12 + Math.round(((completedChunks + 1) / totalChunks) * 43);
        const checkpointKey = `${group.sourceIndex}:${chunkIndex}`;
        let result = checkpoint.get(checkpointKey);
        onProgress({
          stage: result ? "transcription-restored" : "transcription",
          percent: progressPercent,
          message: translate(
            normalizedLocale,
            result ? "transcriptionRestored" : "transcribing",
            { current: completedChunks + 1, total: totalChunks }
          )
        });
        if (!result) {
          result = await transcribeImpl({
            filePath: group.chunks[chunkIndex],
            apiKey,
            signal,
            fetchImpl,
            locale: normalizedLocale,
            onRetry: retryProgress(
              onProgress,
              progressPercent,
              "retryTranscription",
              normalizedLocale
            )
          });
          try {
            await checkpoint.set(checkpointKey, {
              text: result.text || "",
              segments: Array.isArray(result.segments) ? result.segments : []
            });
          } catch {
            checkpoint = createMemoryCheckpoint();
            if (!checkpointWarningShown) {
              checkpointWarningShown = true;
              onProgress({
                stage: "checkpoint-unavailable",
                percent: progressPercent,
                message: translate(normalizedLocale, "checkpointSaveFailed")
              });
            }
          }
        }
        parts.push({
          text: result.text || "",
          segments: Array.isArray(result.segments) ? result.segments : [],
          sourceIndex: group.sourceIndex,
          sourceName: group.sourceName,
          sourcePath: group.sourcePath,
          chunkIndex,
          sourceOffsetSeconds: chunkIndex * AUDIO_CHUNK_SECONDS,
          offsetSeconds: chunkIndex * AUDIO_CHUNK_SECONDS
        });
        completedChunks += 1;
      }
    }

    let resolvedParts = parts;
    let identifiedSpeakerCount = 0;
    if (identifySpeakers) {
      const samples = selectSpeakerSamples(parts);
      if (samples.length > 0) {
        const framesDirectory = path.join(temporaryDirectory, "speaker-frames");
        await fs.mkdir(framesDirectory, { recursive: true });
        onProgress({
          stage: "speaker-identification",
          percent: 58,
          message: translate(normalizedLocale, "prepareFrames", { count: samples.length })
        });
        try {
          const frames = await extractFramesImpl({
            inputPath: normalizedVideoPaths[0],
            samples,
            outputDirectory: framesDirectory,
            signal
          });
          if (frames.length > 0) {
            const observations = await identifyFramesImpl({
              samples: frames,
              apiKey,
              signal,
              fetchImpl,
              locale: normalizedLocale,
              onProgress: ({ completedBatches, totalBatches, message }) => onProgress({
                stage: "speaker-identification",
                percent: 60 + Math.round((completedBatches / Math.max(1, totalBatches)) * 7),
                message
              }),
              onRetry: retryProgress(
                onProgress,
                63,
                "retrySpeakers",
                normalizedLocale
              )
            });
            const mappings = aggregateSpeakerNames(frames, observations);
            identifiedSpeakerCount = new Set(Object.values(mappings)).size;
            resolvedParts = applySpeakerNames(parts, mappings);
          }
        } catch (error) {
          if (signal?.aborted || isCancelled(error)) {
            throw new CancelledError(undefined, normalizedLocale);
          }
          onProgress({
            stage: "speaker-identification-skipped",
            percent: 67,
            message: translate(normalizedLocale, "speakerIdentificationSkipped")
          });
        }
      }
    }

    const utterances = flattenTranscriptParts(resolvedParts, { locale: normalizedLocale });
    if (utterances.length === 0) {
      const error = new Error(translate(normalizedLocale, "emptyTranscript"));
      error.code = "EMPTY_TRANSCRIPT";
      throw error;
    }

    let ranges = normalizeMeetingRanges([], utterances.length, normalizedLocale);
    let splitDetectionSkipped = false;
    if (splitMeetings) {
      onProgress({
        stage: "meeting-boundaries",
        percent: 69,
        message: translate(normalizedLocale, "findMeetingBoundaries")
      });
      try {
        const detected = await detectBoundariesImpl({
          utterances,
          apiKey,
          signal,
          fetchImpl,
          locale: normalizedLocale,
          onRetry: retryProgress(
            onProgress,
            70,
            "retryBoundaries",
            normalizedLocale
          )
        });
        ranges = normalizeMeetingRanges(detected, utterances.length, normalizedLocale);
      } catch (error) {
        if (signal?.aborted || isCancelled(error)) {
          throw new CancelledError(undefined, normalizedLocale);
        }
        splitDetectionSkipped = true;
        onProgress({
          stage: "meeting-boundaries-skipped",
          percent: 72,
          message: translate(normalizedLocale, "meetingSplitSkipped")
        });
      }
    }

    const meetings = splitUtterancesByMeetings(utterances, ranges);
    const outputPairs = await chooseMeetingOutputPaths(
      outputDirectory,
      outputStem,
      meetings,
      normalizedLocale
    );
    const createdAt = new Date();
    const transcripts = [];
    for (let index = 0; index < meetings.length; index += 1) {
      const meeting = meetings[index];
      const title = meetings.length > 1 ? meeting.title : undefined;
      const transcript = formatTranscriptUtterances(meeting.utterances, {
        sourceNames,
        title,
        createdAt,
        locale: normalizedLocale
      });
      await atomicWriteText(outputPairs[index].transcriptPath, transcript);
      createdFiles.push(outputPairs[index].transcriptPath);
      transcripts.push(transcript);
    }
    onProgress({
      stage: "saved-transcript",
      percent: 75,
      message: meetings.length > 1
        ? translate(normalizedLocale, "savedTranscriptsMany", { count: meetings.length })
        : identifiedSpeakerCount > 0
          ? translate(normalizedLocale, "savedTranscriptWithNames", {
            count: identifiedSpeakerCount
          })
          : translate(normalizedLocale, "savedTranscript")
    });

    for (let index = 0; index < meetings.length; index += 1) {
      const progressStart = 76 + ((97 - 76) * index) / meetings.length;
      const progressEnd = 76 + ((97 - 76) * (index + 1)) / meetings.length;
      let summary;
      try {
        summary = await summarizeImpl({
          transcript: transcripts[index],
          apiKey,
          signal,
          fetchImpl,
          onProgress,
          progressStart,
          progressEnd,
          locale: normalizedLocale,
          label: meetings.length > 1
            ? translate(normalizedLocale, "summaryLabelMany", {
              current: index + 1,
              total: meetings.length
            })
            : translate(normalizedLocale, "summaryLabelOne")
        });
      } catch (error) {
        error.transcriptPath = outputPairs[index].transcriptPath;
        throw error;
      }
      await atomicWriteText(
        outputPairs[index].summaryPath,
        formatSummaryFile(summary, {
          sourceNames,
          title: meetings.length > 1 ? meetings[index].title : undefined,
          createdAt,
          locale: normalizedLocale
        })
      );
      createdFiles.push(outputPairs[index].summaryPath);
    }

    await checkpoint.remove().catch(() => {});
    onProgress({
      stage: "complete",
      percent: 100,
      message: meetings.length > 1
        ? translate(normalizedLocale, "completeMany", {
          meetings: meetings.length,
          files: createdFiles.length
        })
        : translate(normalizedLocale, "completeOne")
    });
    return {
      transcriptPath: outputPairs[0].transcriptPath,
      summaryPath: outputPairs[0].summaryPath,
      files: createdFiles,
      meetingCount: meetings.length,
      identifiedSpeakerCount,
      splitDetectionSkipped,
      locale: normalizedLocale,
      outputDirectory
    };
  } catch (error) {
    if (createdFiles.length > 0) {
      error.createdFiles = [...createdFiles];
      error.transcriptPath ||= createdFiles[0] || null;
      error.outputDirectory = outputDirectory;
    }
    throw error;
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  MAX_VIDEO_FILES,
  SUPPORTED_VIDEO_EXTENSIONS,
  isSupportedVideoPath,
  normalizeVideoPaths,
  runMeetingWorkflow,
  validateInputs
};
