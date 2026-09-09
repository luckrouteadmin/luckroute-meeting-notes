"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ApiError, CancelledError } = require("./errors.cjs");
const {
  EXTRACTION_INSTRUCTIONS,
  SUMMARY_INSTRUCTIONS,
  wrapTranscript
} = require("./prompt.cjs");
const { buildBoundaryInput } = require("./meeting-boundaries.cjs");

const API_BASE_URL = "https://api.openai.com/v1";
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const SUMMARY_MODEL = "gpt-5.6";
const SPEAKER_VISION_MODEL = "gpt-5.4-mini";
const MEETING_BOUNDARY_MODEL = "gpt-5.6";
const MAX_DIRECT_SUMMARY_CHARACTERS = 700_000;
const NOTES_CHUNK_CHARACTERS = 220_000;
const REQUEST_TIMEOUT_MS = 8 * 60 * 1000;
const REQUEST_ATTEMPTS = 3;
const SPEAKER_VISION_BATCH_SIZE = 10;

const SPEAKER_VISION_INSTRUCTIONS = `Ты анализируешь кадры записи видеосозвона и читаешь только видимые элементы интерфейса Teams, Zoom, Google Meet или похожей программы.

Для каждого кадра:
1. Внимательно найди однозначный визуальный индикатор активного говорящего: цветную или яркую рамку, подсветку плитки, значок речи или микрофона, подпись активного спикера либо отдельный баннер программы.
2. Прочитай мелкую подпись с именем именно у выделенного участника. Учитывай, что имя может находиться в углу плитки, непосредственно под ней или в баннере поверх видео.
3. Не распознавай человека по лицу, не связывай имя с внешностью, голосом, содержанием речи, порядком плиток или предыдущими кадрами.
4. Если индикатор не виден, имя обрезано, подпись не читается или есть несколько возможных говорящих, верни пустое имя и confidence=low.
5. Сохраняй написание видимого имени без исправлений и дополнений.`;

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

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new CancelledError());
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

function normalizeRequestError(error, { timedOut = false } = {}) {
  if (error instanceof ApiError || error instanceof CancelledError) return error;
  if (timedOut) {
    return new ApiError("Превышено время ожидания ответа от OpenAI.", {
      code: "NETWORK_TIMEOUT",
      cause: error
    });
  }
  return new ApiError("Не удалось установить сетевое соединение с OpenAI.", {
    code: "NETWORK_ERROR",
    cause: error
  });
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
  onRetry = () => {}
}) {
  const retryableStatuses = new Set([408, 409, 429, 500, 502, 503, 504]);
  let lastError;

  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new CancelledError();
    const timed = timeoutSignal(signal, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, ...headers },
        body: bodyFactory(),
        signal: timed.signal
      });
      if (retryableStatuses.has(response.status) && attempt < REQUEST_ATTEMPTS - 1) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1200 * 2 ** attempt;
        await response.text();
        timed.cleanup();
        onRetry({
          nextAttempt: attempt + 2,
          maxAttempts: REQUEST_ATTEMPTS,
          delayMs,
          reason: `HTTP ${response.status}`
        });
        await sleep(delayMs, signal);
        continue;
      }
      return await parseApiResponse(response);
    } catch (error) {
      if (signal?.aborted) throw new CancelledError();
      lastError = normalizeRequestError(error, { timedOut: timed.didTimeOut() });
      if (error instanceof ApiError || attempt === REQUEST_ATTEMPTS - 1) throw lastError;
      const delayMs = 1200 * 2 ** attempt;
      onRetry({
        nextAttempt: attempt + 2,
        maxAttempts: REQUEST_ATTEMPTS,
        delayMs,
        reason: lastError.code
      });
      await sleep(delayMs, signal);
    } finally {
      timed.cleanup();
    }
  }
  throw lastError;
}

async function transcribeAudioFile({ filePath, apiKey, signal, fetchImpl = fetch, onRetry }) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length > 25 * 1024 * 1024) {
    throw new ApiError("Фрагмент превышает 25 МБ.", { status: 413, code: "FILE_TOO_LARGE" });
  }

  return requestWithRetry({
    url: `${API_BASE_URL}/audio/transcriptions`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
    bodyFactory: () => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "audio/mpeg" }), path.basename(filePath));
      form.append("model", TRANSCRIPTION_MODEL);
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", "auto");
      form.append("language", "ru");
      return form;
    }
  });
}

function extractResponseText(payload) {
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
  if (!result) throw new ApiError("Модель вернула пустой текст.", { code: "EMPTY_RESPONSE" });
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
  onRetry
}) {
  const payload = await requestWithRetry({
    url: `${API_BASE_URL}/responses`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
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
  return extractResponseText(payload);
}

function parseSpeakerObservations(payload) {
  let parsed;
  try {
    parsed = JSON.parse(extractResponseText(payload));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Не удалось прочитать результат анализа кадров.", {
      code: "INVALID_VISION_RESPONSE"
    });
  }
  if (!Array.isArray(parsed?.observations)) {
    throw new ApiError("Модель не вернула наблюдения по кадрам.", {
      code: "INVALID_VISION_RESPONSE"
    });
  }
  return parsed.observations;
}

async function identifySpeakerFrameBatch({ samples, apiKey, signal, fetchImpl, onRetry }) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const images = await Promise.all(samples.map(async (sample) => ({
    ...sample,
    base64: (await fs.readFile(sample.framePath)).toString("base64")
  })));
  const content = [{
    type: "input_text",
    text: "Далее идут пары из служебной метки и соответствующего кадра. Верни ровно одно наблюдение для каждого sample_id. Метка audio_speaker нужна только для сопоставления результата и не является подсказкой об имени."
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
    headers: { "Content-Type": "application/json" },
    bodyFactory: () => JSON.stringify({
      model: SPEAKER_VISION_MODEL,
      instructions: SPEAKER_VISION_INSTRUCTIONS,
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
  return parseSpeakerObservations(payload);
}

async function identifySpeakersFromFrames({
  samples,
  apiKey,
  signal,
  fetchImpl = fetch,
  onProgress = () => {},
  onRetry
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
      message: `Читаю имена на кадрах: пакет ${batchIndex + 1} из ${totalBatches}…`
    });
    observations.push(...await identifySpeakerFrameBatch({
      samples: batch,
      apiKey,
      signal,
      fetchImpl,
      onRetry
    }));
  }
  return observations;
}

function parseMeetingBoundaries(payload) {
  let parsed;
  try {
    parsed = JSON.parse(extractResponseText(payload));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Не удалось прочитать границы созвонов.", {
      code: "INVALID_BOUNDARY_RESPONSE"
    });
  }
  if (!Array.isArray(parsed?.meetings)) {
    throw new ApiError("Модель не вернула границы созвонов.", {
      code: "INVALID_BOUNDARY_RESPONSE"
    });
  }
  return parsed.meetings;
}

async function detectMeetingBoundaries({ utterances, apiKey, signal, fetchImpl = fetch, onRetry }) {
  if (!Array.isArray(utterances) || utterances.length === 0) return [];
  const indexedTranscript = buildBoundaryInput(utterances);
  const payload = await requestWithRetry({
    url: `${API_BASE_URL}/responses`,
    apiKey,
    signal,
    fetchImpl,
    onRetry,
    headers: { "Content-Type": "application/json" },
    bodyFactory: () => JSON.stringify({
      model: MEETING_BOUNDARY_MODEL,
      instructions: MEETING_BOUNDARY_INSTRUCTIONS,
      input: `Последний ID: ${utterances.at(-1).id}\n\n<segments>\n${indexedTranscript}\n</segments>`,
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
  return parseMeetingBoundaries(payload);
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
  apiKey,
  signal,
  fetchImpl = fetch,
  onProgress = () => {},
  progressStart = 76,
  progressEnd = 97,
  label = "созвона"
}) {
  let currentPercent = progressStart;
  const emit = (fraction, message) => {
    currentPercent = Math.round(progressStart + Math.max(0, Math.min(1, fraction)) * (progressEnd - progressStart));
    onProgress({ stage: "summary", percent: currentPercent, message });
  };
  const onRetry = ({ nextAttempt, maxAttempts }) => {
    onProgress({
      stage: "network-retry",
      percent: currentPercent,
      message: `Связь прервалась — повторяю запрос ${nextAttempt} из ${maxAttempts}…`
    });
  };

  if (transcript.length <= MAX_DIRECT_SUMMARY_CHARACTERS) {
    emit(0.12, `Формирую подробную сводку ${label}…`);
    return createTextResponse({
      apiKey,
      instructions: SUMMARY_INSTRUCTIONS,
      input: wrapTranscript(transcript),
      maxOutputTokens: 24_000,
      signal,
      fetchImpl,
      onRetry
    });
  }

  const chunks = splitLongText(transcript);
  const notes = [];
  for (let index = 0; index < chunks.length; index += 1) {
    emit(
      ((index + 1) / (chunks.length + 1)) * 0.82,
      `Анализирую длинную запись: часть ${index + 1} из ${chunks.length}…`
    );
    notes.push(await createTextResponse({
      apiKey,
      instructions: EXTRACTION_INSTRUCTIONS,
      input: wrapTranscript(chunks[index]),
      maxOutputTokens: 16_000,
      signal,
      fetchImpl,
      onRetry
    }));
  }

  emit(0.9, `Собираю итоговую сводку ${label}…`);
  return createTextResponse({
    apiKey,
    instructions: SUMMARY_INSTRUCTIONS,
    input: `Ниже фактические заметки по последовательным частям одной записи.\n\n${notes.map((note, index) => `ЧАСТЬ ${index + 1}\n${note}`).join("\n\n")}`,
    maxOutputTokens: 24_000,
    signal,
    fetchImpl,
    onRetry
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
  normalizeRequestError,
  parseMeetingBoundaries,
  parseSpeakerObservations,
  requestWithRetry,
  splitLongText,
  summarizeTranscript,
  transcribeAudioFile
};
