"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ApiError, CancelledError } = require("./errors.cjs");
const {
  getExtractionInstructions,
  getSummaryInstructions,
  wrapTranscript
} = require("./prompt.cjs");
const { buildBoundaryInput } = require("./meeting-boundaries.cjs");
const { normalizeLocale, translate } = require("./locale.cjs");
const { detailInstructions, summaryBudget } = require("./summary-detail.cjs");
const { CONTEXT_SCHEMA, contextInstructions, contextRows, buildContextWindows } = require("./context-identity.cjs");

const API_BASE_URL = "https://api.openai.com/v1";
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const SUMMARY_MODEL = "gpt-5.6";
const SPEAKER_VISION_MODEL = "gpt-5.4-mini";
const MEETING_BOUNDARY_MODEL = "gpt-5.6";
const MAX_DIRECT_SUMMARY_CHARACTERS = 700_000;
const NOTES_CHUNK_CHARACTERS = 220_000;
const REQUEST_TIMEOUT_MS = 8 * 60 * 1000;
const REQUEST_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 20_000;
const SPEAKER_VISION_BATCH_SIZE = 10;

const SPEAKER_VISION_INSTRUCTIONS = `Ты анализируешь кадры записи видеосозвона и читаешь только видимые элементы интерфейса Teams, Zoom, Google Meet или похожей программы.

Для каждого кадра:
1. Внимательно найди однозначный визуальный индикатор активного говорящего: цветную или яркую рамку, подсветку плитки, значок речи или микрофона, подпись активного спикера либо отдельный баннер программы.
2. Прочитай мелкую подпись с именем именно у выделенного участника. Учитывай, что имя может находиться в углу плитки, непосредственно под ней или в баннере поверх видео.
3. Не распознавай человека по лицу, не связывай имя с внешностью, голосом, содержанием речи, порядком плиток или предыдущими кадрами.
4. Если индикатор не виден, имя обрезано, подпись не читается или есть несколько возможных говорящих, верни пустое имя и confidence=low.
5. Сохраняй написание видимого имени без исправлений и дополнений.`;

const ENGLISH_SPEAKER_VISION_INSTRUCTIONS = `Analyze frames from a video meeting recording and read only visible interface elements from Teams, Zoom, Google Meet, or a similar app.

For every frame:
1. Find an unambiguous visual active-speaker indicator: a colored or bright border, highlighted tile, speech or microphone icon, active-speaker label, or dedicated app banner.
2. Read the small name label belonging specifically to that highlighted participant. The name may be in a tile corner, below the tile, or in an overlay banner.
3. Never identify a person from their face and never associate a name with appearance, voice, speech content, tile position, or earlier frames.
4. If the indicator is missing, the name is cropped or unreadable, or several speakers are possible, return an empty name with confidence=low.
5. Preserve the visible spelling exactly, without corrections or additions.`;

const SPEAKER_OBSERVATIONS_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sample_id: { type: "string" },
          active_speaker_name: { type: "string" },
          active_indicator_visible: { type: "boolean" },
          name_label_visible: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: [
          "sample_id",
          "active_speaker_name",
          "active_indicator_visible",
          "name_label_visible",
          "confidence"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["observations"],
  additionalProperties: false
};

const MEETING_BOUNDARIES_SCHEMA = {
  type: "object",
  properties: {
    meetings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          start_segment_id: { type: "integer" },
          end_segment_id: { type: "integer" }
        },
        required: ["title", "start_segment_id", "end_segment_id"],
        additionalProperties: false
      }
    }
  },
  required: ["meetings"],
  additionalProperties: false
};

const MEETING_BOUNDARY_INSTRUCTIONS = `Определи границы самостоятельных созвонов внутри последовательной расшифровки. Каждый фрагмент имеет непрерывный ID, номер исходного видео, таймкод и говорящего.

Правила:
1. Разделяй только явно самостоятельные сессии: видны новое приветствие или представление, смена состава и контекста, завершение предыдущей встречи и начало новой либо явный полный перезапуск разговора.
2. Смена темы внутри одного разговора не означает новый созвон. Граница видеофайла сама по себе тоже не означает новый созвон: несколько файлов могут быть частями одной встречи.
3. Если уверенности нет, верни один созвон.
4. Каждый ID должен войти ровно в один диапазон. Диапазоны должны начинаться с ID 1, идти без пробелов и перекрытий и заканчиваться последним ID.
5. Дай каждому созвону короткое деловое название по его фактической основной теме. Не добавляй фактов, которых нет в тексте.`;

const ENGLISH_MEETING_BOUNDARY_INSTRUCTIONS = `Find the boundaries of separate meetings inside a sequential transcript. Every segment has a continuous ID, source video number, timestamp, and speaker.

Rules:
1. Split only clearly independent sessions: a new greeting or introduction, a change in participants and context, an ending followed by a new meeting, or an explicit full restart of the conversation.
2. A topic change within one conversation is not a new meeting. A source-file boundary alone is not a meeting boundary because several files can be parts of one meeting.
3. If uncertain, return one meeting.
4. Every ID must belong to exactly one range. Ranges must start with ID 1, be contiguous and non-overlapping, and end with the final ID.
5. Give every meeting a short business title based on its actual main topic. Do not add facts that are not in the transcript.`;

function sleep(milliseconds, signal, locale = "ru") {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError(undefined, locale));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new CancelledError(undefined, locale));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort(parentSignal.reason);
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  };
}

function normalizeRequestError(error, { timedOut = false, locale = "ru" } = {}) {
  if (error instanceof ApiError || error instanceof CancelledError) return error;
  if (timedOut) {
    return new ApiError(translate(locale, "requestTimeout"), {
      code: "NETWORK_TIMEOUT",
      cause: error
    });
  }
  return new ApiError(translate(locale, "requestNetworkError"), {
    code: "NETWORK_ERROR",
    cause: error
  });
}

function isRetryableStatus(status) {
  return status === 408
    || status === 409
    || status === 425
    || status === 429
    || (status >= 500 && status <= 599);
}

function retryDelayMs(response, attempt, randomImpl = Math.random) {
  const rawRetryAfter = response?.headers?.get?.("retry-after");
  if (typeof rawRetryAfter === "string" && rawRetryAfter.trim()) {
    const seconds = Number.parseFloat(rawRetryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1000));
    }
    const date = Date.parse(rawRetryAfter);
    if (Number.isFinite(date)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - Date.now()));
    }
  }
  const base = Math.min(MAX_RETRY_DELAY_MS, 1250 * (2 ** attempt));
  const jitter = 0.8 + Math.max(0, Math.min(1, Number(randomImpl()) || 0)) * 0.4;
  return Math.round(base * jitter);
}

async function parseApiResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    const code = payload?.error?.code || "API_ERROR";
    throw new ApiError(message, { status: response.status, code });
  }
  return payload;
}

async function requestWithRetry({
  url,
  apiKey,
  bodyFactory,
  headers = {},
  signal,
  fetchImpl = fetch,
  onRetry = () => {},
  maxAttempts = REQUEST_ATTEMPTS,
  sleepImpl = sleep,
  randomImpl = Math.random,
  locale = "ru"
}) {
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new CancelledError(undefined, locale);
    const timed = timeoutSignal(signal, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, ...headers },
        body: bodyFactory(),
        signal: timed.signal
      });
      if (isRetryableStatus(response.status) && attempt < maxAttempts - 1) {
        const delayMs = retryDelayMs(response, attempt, randomImpl);
        await response.text();
        timed.cleanup();
        onRetry({
          nextAttempt: attempt + 2,
          maxAttempts,
          delayMs,
          reason: `HTTP ${response.status}`
        });
        await sleepImpl(delayMs, signal, locale);
        continue;
      }
      return await parseApiResponse(response);
    } catch (error) {
      if (signal?.aborted) throw new CancelledError(undefined, locale);
      lastError = normalizeRequestError(error, {
        timedOut: timed.didTimeOut(),
        locale
      });
      if (error instanceof ApiError || attempt === maxAttempts - 1) throw lastError;
      const delayMs = retryDelayMs(null, attempt, randomImpl);
      onRetry({
        nextAttempt: attempt + 2,
        maxAttempts,
        delayMs,
        reason: lastError.code
      });
      await sleepImpl(delayMs, signal, locale);
    } finally {
      timed.cleanup();
    }
  }
  throw lastError;
}

async function transcribeAudioFile({
  filePath,
  apiKey,
  signal,
  fetchImpl = fetch,
  onRetry,
  locale = "ru"
}) {
  const normalizedLocale = normalizeLocale(locale);
  const bytes = await fs.readFile(filePath);
  if (bytes.length > 25 * 1024 * 1024) {
    throw new ApiError(translate(normalizedLocale, "audioChunkTooLarge"), {
      status: 413,
      code: "FILE_TOO_LARGE"
    });
  }

  return requestWithRetry({
    url: `${API_BASE_URL}/audio/transcriptions`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
    locale: normalizedLocale,
    bodyFactory: () => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "audio/mpeg" }), path.basename(filePath));
      form.append("model", TRANSCRIPTION_MODEL);
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", "auto");
      form.append("language", normalizedLocale);
      return form;
    }
  });
}

function extractResponseText(payload, locale = "ru") {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const pieces = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  const result = pieces.join("\n").trim();
  if (!result) {
    throw new ApiError(translate(locale, "emptyResponse"), { code: "EMPTY_RESPONSE" });
  }
  return result;
}

async function createTextResponse({
  apiKey,
  instructions,
  input,
  maxOutputTokens,
  signal,
  fetchImpl = fetch,
  model = SUMMARY_MODEL,
  reasoningEffort = "low",
  verbosity = "high",
  onRetry,
  locale = "ru"
}) {
  const payload = await requestWithRetry({
    url: `${API_BASE_URL}/responses`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
    locale,
    headers: { "Content-Type": "application/json" },
    bodyFactory: () => JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: reasoningEffort },
      text: {
        format: { type: "text" },
        verbosity
      },
      store: false
    })
  });
  return extractResponseText(payload, locale);
}

function parseSpeakerObservations(payload, locale = "ru") {
  let parsed;
  try {
    parsed = JSON.parse(extractResponseText(payload, locale));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(translate(locale, "invalidVisionResponse"), {
      code: "INVALID_VISION_RESPONSE"
    });
  }
  if (!Array.isArray(parsed?.observations)) {
    throw new ApiError(translate(locale, "missingVisionObservations"), {
      code: "INVALID_VISION_RESPONSE"
    });
  }
  return parsed.observations;
}

async function identifySpeakerFrameBatch({
  samples,
  apiKey,
  signal,
  fetchImpl,
  onRetry,
  locale = "ru"
}) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const images = await Promise.all(samples.map(async (sample) => ({
    ...sample,
    base64: (await fs.readFile(sample.framePath)).toString("base64")
  })));
  const content = [{
    type: "input_text",
    text: translate(locale, "speakerFrameIntro")
  }];
  for (const image of images) {
    content.push({
      type: "input_text",
      text: `sample_id=${image.sampleId}; audio_speaker=${image.speakerKey}; time_seconds=${image.timestampSeconds.toFixed(3)}`
    });
    content.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${image.base64}`,
      detail: "original"
    });
  }

  const payload = await requestWithRetry({
    url: `${API_BASE_URL}/responses`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
    locale,
    headers: { "Content-Type": "application/json" },
    bodyFactory: () => JSON.stringify({
      model: SPEAKER_VISION_MODEL,
      instructions: normalizeLocale(locale) === "en"
        ? ENGLISH_SPEAKER_VISION_INSTRUCTIONS
        : SPEAKER_VISION_INSTRUCTIONS,
      input: [{ role: "user", content }],
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "speaker_frame_observations",
          strict: true,
          schema: SPEAKER_OBSERVATIONS_SCHEMA
        },
        verbosity: "low"
      },
      max_output_tokens: 4_000,
      store: false
    })
  });
  return parseSpeakerObservations(payload, locale);
}

async function identifySpeakersFromContext({ parts, apiKey, signal, fetchImpl = fetch, onRetry, onProgress = () => {}, locale = "ru" }) {
  const rows = contextRows(parts);
  if (!rows.some(row => row.speaker_key)) return [];
  const windows = buildContextWindows(rows);
  const observations = [];
  for (let index = 0; index < windows.length; index++) {
    onProgress({ current: index + 1, total: windows.length });
    const payload = await requestWithRetry({
      url: `${API_BASE_URL}/responses`, apiKey, signal, fetchImpl, onRetry, locale,
      headers: { "Content-Type": "application/json" },
      bodyFactory: () => JSON.stringify({
        model: SPEAKER_VISION_MODEL, instructions: contextInstructions(locale),
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ dialogue: windows[index] }) }] }],
        reasoning: { effort: "low" }, text: { format: { type: "json_schema", name: "context_speaker_observations", strict: true, schema: CONTEXT_SCHEMA }, verbosity: "low" },
        max_output_tokens: 6000, store: false
      })
    });
    let parsed;
    try { parsed = JSON.parse(extractResponseText(payload, locale)); } catch { parsed = null; }
    if (!Array.isArray(parsed?.observations)) throw new ApiError(locale === "en"
      ? "Could not read context identification." : "Не удалось прочитать имена и роли по контексту.", { code: "INVALID_CONTEXT_RESPONSE" });
    // Bind evidence to the actual window sent, not to arbitrary transcript IDs.
    const ids = new Set(windows[index].map(row => row.id));
    for (const item of parsed.observations) {
      if (Array.isArray(item?.evidence) && item.evidence.every(evidence => ids.has(evidence.segment_id))) observations.push(item);
    }
  }
  return observations;
}

async function identifySpeakersFromFrames({
  samples,
  apiKey,
  signal,
  fetchImpl = fetch,
  onProgress = () => {},
  onRetry,
  locale = "ru"
}) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const observations = [];
  const totalBatches = Math.ceil(samples.length / SPEAKER_VISION_BATCH_SIZE);
  for (let offset = 0; offset < samples.length; offset += SPEAKER_VISION_BATCH_SIZE) {
    const batch = samples.slice(offset, offset + SPEAKER_VISION_BATCH_SIZE);
    const batchIndex = Math.floor(offset / SPEAKER_VISION_BATCH_SIZE);
    onProgress({
      completedBatches: batchIndex,
      totalBatches,
      message: translate(locale, "readFrames", {
        current: batchIndex + 1,
        total: totalBatches
      })
    });
    observations.push(...await identifySpeakerFrameBatch({
      samples: batch,
      apiKey,
      signal,
      fetchImpl,
      onRetry,
      locale
    }));
  }
  return observations;
}

function parseMeetingBoundaries(payload, locale = "ru") {
  let parsed;
  try {
    parsed = JSON.parse(extractResponseText(payload, locale));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(translate(locale, "invalidBoundaryResponse"), {
      code: "INVALID_BOUNDARY_RESPONSE"
    });
  }
  if (!Array.isArray(parsed?.meetings)) {
    throw new ApiError(translate(locale, "missingBoundaryMeetings"), {
      code: "INVALID_BOUNDARY_RESPONSE"
    });
  }
  return parsed.meetings;
}

async function detectMeetingBoundaries({
  utterances,
  apiKey,
  signal,
  fetchImpl = fetch,
  onRetry,
  locale = "ru"
}) {
  if (!Array.isArray(utterances) || utterances.length === 0) return [];
  const indexedTranscript = buildBoundaryInput(utterances, locale);
  const payload = await requestWithRetry({
    url: `${API_BASE_URL}/responses`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
    locale,
    headers: { "Content-Type": "application/json" },
    bodyFactory: () => JSON.stringify({
      model: MEETING_BOUNDARY_MODEL,
      instructions: normalizeLocale(locale) === "en"
        ? ENGLISH_MEETING_BOUNDARY_INSTRUCTIONS
        : MEETING_BOUNDARY_INSTRUCTIONS,
      input: `${translate(locale, "boundaryInputIntro")}\n${translate(locale, "boundaryLastId", {
        id: utterances.at(-1).id
      })}\n\n<segments>\n${indexedTranscript}\n</segments>`,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "meeting_boundaries",
          strict: true,
          schema: MEETING_BOUNDARIES_SCHEMA
        },
        verbosity: "low"
      },
      max_output_tokens: 4_000,
      store: false
    })
  });
  return parseMeetingBoundaries(payload, locale);
}

function splitLongText(text, maximumCharacters = NOTES_CHUNK_CHARACTERS) {
  const lines = String(text).split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (line.length > maximumCharacters) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < line.length; index += maximumCharacters) {
        chunks.push(line.slice(index, index + maximumCharacters));
      }
      continue;
    }
    const addition = current ? `\n${line}` : line;
    if (current && current.length + addition.length > maximumCharacters) {
      chunks.push(current);
      current = line;
      continue;
    }
    current += addition;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function summarizeTranscript({
  transcript,
  summaryDetail = "standard",
  apiKey,
  signal,
  fetchImpl = fetch,
  onProgress = () => {},
  progressStart = 76,
  progressEnd = 97,
  label,
  locale = "ru"
}) {
  const normalizedLocale = normalizeLocale(locale);
  const instructions = `${getSummaryInstructions(normalizedLocale)}\n\n${detailInstructions(transcript, summaryDetail, normalizedLocale)}`;
  const maxOutputTokens = Math.min(24000, Math.max(2000, Math.ceil(summaryBudget(transcript, summaryDetail).max * 0.8) + 1000));
  const summaryLabel = label || translate(normalizedLocale, "summaryLabelOne");
  let currentPercent = progressStart;
  const emit = (fraction, message) => {
    currentPercent = Math.round(progressStart + Math.max(0, Math.min(1, fraction)) * (progressEnd - progressStart));
    onProgress({ stage: "summary", percent: currentPercent, message });
  };
  const onRetry = ({ nextAttempt, maxAttempts, delayMs }) => {
    onProgress({
      stage: "network-retry",
      percent: currentPercent,
      message: translate(normalizedLocale, "networkRetry", {
        subject: translate(normalizedLocale, "retrySummary"),
        next: nextAttempt,
        max: maxAttempts,
        seconds: Math.max(1, Math.ceil((delayMs || 0) / 1000))
      })
    });
  };

  if (transcript.length <= MAX_DIRECT_SUMMARY_CHARACTERS) {
    emit(0.12, translate(normalizedLocale, "summaryDetailed", { label: summaryLabel }));
    return createTextResponse({
      apiKey,
      instructions,
      input: wrapTranscript(transcript, normalizedLocale),
      maxOutputTokens,
      signal,
      fetchImpl,
      onRetry,
      locale: normalizedLocale
    });
  }

  const chunks = splitLongText(transcript);
  const notes = [];
  for (let index = 0; index < chunks.length; index += 1) {
    emit(
      ((index + 1) / (chunks.length + 1)) * 0.82,
      translate(normalizedLocale, "summaryLongPart", {
        current: index + 1,
        total: chunks.length
      })
    );
    notes.push(await createTextResponse({
      apiKey,
      instructions: getExtractionInstructions(normalizedLocale),
      input: wrapTranscript(chunks[index], normalizedLocale),
      maxOutputTokens: 16_000,
      signal,
      fetchImpl,
      onRetry,
      locale: normalizedLocale
    }));
  }

  emit(0.9, translate(normalizedLocale, "summaryFinal", { label: summaryLabel }));
  return createTextResponse({
    apiKey,
    instructions,
    input: `${translate(normalizedLocale, "longNotesIntro")}\n\n${notes.map((note, index) => (
      `${translate(normalizedLocale, "longNotesPart", { number: index + 1 })}\n${note}`
    )).join("\n\n")}`,
    maxOutputTokens,
    signal,
    fetchImpl,
    onRetry,
    locale: normalizedLocale
  });
}

module.exports = {
  API_BASE_URL,
  MAX_DIRECT_SUMMARY_CHARACTERS,
  MEETING_BOUNDARIES_SCHEMA,
  MEETING_BOUNDARY_MODEL,
  NOTES_CHUNK_CHARACTERS,
  REQUEST_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  MAX_RETRY_DELAY_MS,
  SPEAKER_OBSERVATIONS_SCHEMA,
  SPEAKER_VISION_BATCH_SIZE,
  SPEAKER_VISION_MODEL,
  SUMMARY_MODEL,
  TRANSCRIPTION_MODEL,
  createTextResponse,
  detectMeetingBoundaries,
  extractResponseText,
  identifySpeakerFrameBatch,
  identifySpeakersFromFrames,
  identifySpeakersFromContext,
  isRetryableStatus,
  normalizeRequestError,
  parseMeetingBoundaries,
  parseSpeakerObservations,
  requestWithRetry,
  retryDelayMs,
  splitLongText,
  summarizeTranscript,
  transcribeAudioFile
};
