"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ApiError, CancelledError } = require("./errors.cjs");
const {
  EXTRACTION_INSTRUCTIONS,
  SUMMARY_INSTRUCTIONS,
  wrapTranscript
} = require("./prompt.cjs");

const API_BASE_URL = "https://api.openai.com/v1";
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const SUMMARY_MODEL = "gpt-5-mini";
const MAX_DIRECT_SUMMARY_CHARACTERS = 700_000;
const NOTES_CHUNK_CHARACTERS = 240_000;

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(parentSignal.reason);
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  };
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

async function requestWithRetry({ url, apiKey, bodyFactory, headers = {}, signal, fetchImpl = fetch }) {
  const retryableStatuses = new Set([408, 409, 429, 500, 502, 503, 504]);
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw new CancelledError();
    const timed = timeoutSignal(signal, 15 * 60 * 1000);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, ...headers },
        body: bodyFactory(),
        signal: timed.signal
      });
      if (retryableStatuses.has(response.status) && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.text();
        timed.cleanup();
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1200 * 2 ** attempt, signal);
        continue;
      }
      return await parseApiResponse(response);
    } catch (error) {
      if (signal?.aborted) throw new CancelledError();
      lastError = error;
      if (error instanceof ApiError || attempt === 3) throw error;
      await sleep(1200 * 2 ** attempt, signal);
    } finally {
      timed.cleanup();
    }
  }
  throw lastError;
}

async function transcribeAudioFile({ filePath, apiKey, signal, fetchImpl = fetch }) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length > 25 * 1024 * 1024) {
    throw new ApiError("Фрагмент превышает 25 МБ.", { status: 413, code: "FILE_TOO_LARGE" });
  }

  return requestWithRetry({
    url: `${API_BASE_URL}/audio/transcriptions`,
    apiKey,
    signal,
    fetchImpl,
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

async function createTextResponse({ apiKey, instructions, input, maxOutputTokens, signal, fetchImpl = fetch }) {
  const payload = await requestWithRetry({
    url: `${API_BASE_URL}/responses`,
    apiKey,
    signal,
    fetchImpl,
    headers: { "Content-Type": "application/json" },
    bodyFactory: () => JSON.stringify({
      model: SUMMARY_MODEL,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      store: false
    })
  });
  return extractResponseText(payload);
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

async function summarizeTranscript({ transcript, apiKey, signal, fetchImpl = fetch, onProgress = () => {} }) {
  if (transcript.length <= MAX_DIRECT_SUMMARY_CHARACTERS) {
    onProgress({ stage: "summary", percent: 78, message: "Формирую сводку созвона…" });
    return createTextResponse({
      apiKey,
      instructions: SUMMARY_INSTRUCTIONS,
      input: wrapTranscript(transcript),
      maxOutputTokens: 12_000,
      signal,
      fetchImpl
    });
  }

  const chunks = splitLongText(transcript);
  const notes = [];
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress({
      stage: "summary",
      percent: 65 + Math.round(((index + 1) / (chunks.length + 1)) * 24),
      message: `Анализирую длинную запись: часть ${index + 1} из ${chunks.length}…`
    });
    notes.push(await createTextResponse({
      apiKey,
      instructions: EXTRACTION_INSTRUCTIONS,
      input: wrapTranscript(chunks[index]),
      maxOutputTokens: 10_000,
      signal,
      fetchImpl
    }));
  }

  onProgress({ stage: "summary", percent: 92, message: "Собираю итоговую сводку…" });
  return createTextResponse({
    apiKey,
    instructions: SUMMARY_INSTRUCTIONS,
    input: `Ниже фактические заметки по последовательным частям одной записи.\n\n${notes.map((note, index) => `ЧАСТЬ ${index + 1}\n${note}`).join("\n\n")}`,
    maxOutputTokens: 12_000,
    signal,
    fetchImpl
  });
}

module.exports = {
  API_BASE_URL,
  MAX_DIRECT_SUMMARY_CHARACTERS,
  NOTES_CHUNK_CHARACTERS,
  SUMMARY_MODEL,
  TRANSCRIPTION_MODEL,
  createTextResponse,
  extractResponseText,
  splitLongText,
  summarizeTranscript,
  transcribeAudioFile
};
