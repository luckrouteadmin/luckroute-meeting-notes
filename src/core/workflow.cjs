"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { splitAudio, AUDIO_CHUNK_SECONDS } = require("./audio.cjs");
const {
  detectMeetingBoundaries,
  identifySpeakersFromFrames,
  identifySpeakersFromContext,
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
const { contextRows, resolveContextObservations, applyContextIdentities } = require("./context-identity.cjs");
const { SUPPORTED_VIDEO_EXTENSIONS, SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_MEDIA_EXTENSIONS,
  isSupportedVideoPath, isSupportedMediaPath, formatsText } = require("./media.cjs");

const MAX_VIDEO_FILES = 20;
const VIDEO_COLLATOR = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

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
    if (!path.isAbsolute(videoPath) || !isSupportedMediaPath(videoPath)) {
      const formats = formatsText(normalizedLocale);
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
  summaryDetail = "standard",
  locale = "ru",
  mode = "openai",
  localEngine,
  checkpointDirectory,
  signal,
  fetchImpl,
  onProgress = () => {},
  dependencies = {}
}) {
  if (!["local", "openai"].includes(mode)) throw new Error("Invalid processing mode");
  if (mode === "local") {
    for (const method of ["splitAudio", "transcribeAudioFile", "summarizeTranscript", "detectMeetingBoundaries"]) {
      if (typeof localEngine?.[method] !== "function") throw new Error("Local engine is not ready");
    }
    // Explicitly sever all cloud capabilities, including optional video analysis.
    dependencies = { ...dependencies, ...localEngine };
    identifySpeakers = false;
    apiKey = undefined;
    fetchImpl = undefined;
  }
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
  const identifyContextImpl = dependencies.identifySpeakersFromContext || identifySpeakersFromContext;
  const detectBoundariesImpl = dependencies.detectMeetingBoundaries || detectMeetingBoundaries;
  const openCheckpointImpl = dependencies.openCheckpoint || openCheckpoint;
  const createdFiles = [];
  let checkpoint;

  try {
    try {
      checkpoint = await openCheckpointImpl({
        directory: checkpointDirectory,
        videoPaths: normalizedVideoPaths,
        configuration: { mode, locale: normalizedLocale, model: mode === "local" ? "whisper-small-v1" : "gpt-4o-transcribe-diarize" }
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
        let progressPercent = 12 + Math.round((completedChunks / totalChunks) * 43);
        const checkpointKey = `${group.sourceIndex}:${chunkIndex}`;
        let result = checkpoint.get(checkpointKey);
        if (result) progressPercent = 12 + Math.round(((completedChunks + 1) / totalChunks) * 43);
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
            onProgress: percent => {
              if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
              // A CPU retry can start at zero; the overall bar must not go back.
              progressPercent = Math.max(progressPercent, 12 + Math.round(((completedChunks + percent / 100) / totalChunks) * 43));
              onProgress({ stage: "transcription", percent: progressPercent,
                message: translate(normalizedLocale, "transcribing", { current: completedChunks + 1, total: totalChunks }) + ` (${Math.round(percent)}%)` });
            },
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
    let identifiedRoleCount = 0;
    if (identifySpeakers) {
      // Keep original part indices: speaker IDs are scoped to a transcription chunk.
      const samples = selectSpeakerSamples(parts.map(part => isSupportedVideoPath(part.sourcePath)
        ? part : { ...part, segments: [] }));
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

    if (identifySpeakers && mode === "openai" && parts.some(part => part.segments.some(segment => segment.speaker))) {
      try {
        const observations = await identifyContextImpl({ parts: resolvedParts, apiKey, signal, fetchImpl, locale: normalizedLocale,
          onProgress: ({ current, total }) => onProgress({ stage: "context-identification", percent: 67,
            message: translate(normalizedLocale, "contextIdentity", { current, total }) }),
          onRetry: retryProgress(onProgress, 67, "retrySpeakers", normalizedLocale) });
        resolvedParts = applyContextIdentities(resolvedParts, resolveContextObservations(contextRows(resolvedParts), observations, normalizedLocale));
      } catch (error) {
        if (signal?.aborted || isCancelled(error)) throw new CancelledError(undefined, normalizedLocale);
        onProgress({ stage: "context-identification-skipped", percent: 68, message: translate(normalizedLocale, "contextIdentitySkipped") });
      }
      identifiedSpeakerCount = new Set(resolvedParts.flatMap(part => part.segments.map(segment => segment.speakerName).filter(Boolean))).size;
      identifiedRoleCount = new Set(resolvedParts.flatMap((part, index) => part.segments.filter(segment => segment.speakerRole).map(segment => `${index}:${segment.speaker}`))).size;
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
        locale: normalizedLocale,
        mode
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
          summaryDetail,
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
      identifiedRoleCount,
      splitDetectionSkipped,
      locale: normalizedLocale,
      mode,
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
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_MEDIA_EXTENSIONS,
  isSupportedVideoPath,
  isSupportedMediaPath,
  normalizeVideoPaths,
  runMeetingWorkflow,
  validateInputs
};
