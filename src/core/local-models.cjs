"use strict";

const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CancelledError } = require("./errors.cjs");

// Immutable revisions, sizes and SHA-256 values from the model publishers.
const MODELS = Object.freeze([
  Object.freeze({
    id: "whisper-small", file: "ggml-small.bin", size: 487601967,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin"
  }),
  Object.freeze({
    id: "qwen35-9b", file: "Qwen3.5-9B-Q4_K_M.gguf", size: 5680522464,
    sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
    url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf"
  })
]);

const RETIRED_SUMMARY_MODEL = Object.freeze({ file: "Qwen3-4B-Q4_K_M.gguf", size: 2497280256,
  sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5" });

function localError(code, ru, en, locale = "ru") {
  return Object.assign(new Error(locale === "en" ? en : ru), { code });
}

async function fileSize(file) {
  try { const stat = await fs.stat(file); return stat.isFile() ? stat.size : 0; }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
}

async function verifyModel(file, model, signal) {
  if (signal?.aborted) throw new CancelledError();
  if (await fileSize(file) !== model.size) return false;
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(file, { highWaterMark: 4 * 1024 * 1024, signal });
  try {
    for await (const chunk of stream) hash.update(chunk);
  } catch (error) {
    if (signal?.aborted) throw new CancelledError();
    throw error;
  }
  return hash.digest("hex") === model.sha256;
}

async function getModelStatus(directory, models = MODELS) {
  const entries = await Promise.all(models.map(async (model) => ({
    id: model.id,
    ready: await fileSize(path.join(directory, model.file)) === model.size
  })));
  return { ready: entries.every((entry) => entry.ready), totalBytes: models.reduce((n, m) => n + m.size, 0) };
}

async function requireModels(directory, { signal, locale = "ru", models = MODELS } = {}) {
  for (const model of models) {
    if (!await verifyModel(path.join(directory, model.file), model, signal)) {
      throw localError("LOCAL_MODELS_REQUIRED",
        "Локальные модели не установлены или повреждены. Нажмите «Скачать модели».",
        "Local models are missing or damaged. Click “Download models”.", locale);
    }
  }
}

async function downloadModels({ directory, signal, fetchImpl = fetch, onProgress = () => {}, locale = "ru", models = MODELS }) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const total = models.reduce((sum, model) => sum + model.size, 0);
  let completed = 0;
  for (const model of models) {
    if (signal?.aborted) throw new CancelledError();
    const destination = path.join(directory, model.file);
    if (await verifyModel(destination, model, signal)) {
      completed += model.size;
      onProgress({ downloaded: completed, total });
      continue;
    }
    const partial = `${destination}.part`;
    let offset = await fileSize(partial);
    if (offset > model.size) { await fs.truncate(partial, 0); offset = 0; }
    if (offset < model.size) {
      const timeout = AbortSignal.timeout(2 * 60 * 60 * 1000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetchImpl(model.url, {
        method: "GET", signal: requestSignal,
        headers: offset ? { Range: `bytes=${offset}-`, "Accept-Encoding": "identity" } : { "Accept-Encoding": "identity" }
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw localError("LOCAL_DOWNLOAD_FAILED", `Не удалось скачать модели (HTTP ${response.status}). Повторите загрузку.`, `Model download failed (HTTP ${response.status}). Retry the download.`, locale);
      }
      if (response.status === 206) {
        const range = response.headers.get("content-range") || "";
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
        if (!match || Number(match[1]) !== offset || Number(match[3]) !== model.size) {
          await response.body.cancel();
          throw localError("LOCAL_DOWNLOAD_FAILED", "Сервер вернул неверный диапазон модели.", "Invalid model download range.", locale);
        }
      } else if (response.status === 200) {
        offset = 0; // A server may ignore Range; never append a full response.
      } else {
        await response.body.cancel();
        throw localError("LOCAL_DOWNLOAD_FAILED", "Некорректный ответ при загрузке модели.", "Unexpected model download response.", locale);
      }
      const handle = await fs.open(partial, offset ? "a" : "w", 0o600);
      const reader = response.body.getReader();
      let lastUpdate = 0;
      try {
        while (true) {
          if (signal?.aborted) throw new CancelledError();
          const { done, value } = await reader.read();
          if (done) break;
          if (offset + value.byteLength > model.size) throw new Error("Model download exceeds expected size");
          let written = 0;
          while (written < value.byteLength) {
            const result = await handle.write(value, written, value.byteLength - written);
            if (!result.bytesWritten) throw new Error("Model file write failed");
            written += result.bytesWritten;
          }
          offset += value.byteLength;
          if (Date.now() - lastUpdate > 200) {
            onProgress({ downloaded: completed + offset, total });
            lastUpdate = Date.now();
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        await handle.close();
      }
    }
    onProgress({ downloaded: completed + offset, total, verifying: true });
    if (!await verifyModel(partial, model, signal)) {
      // Only a download owned by this module is removed; installed models are left intact.
      await fs.rm(partial, { force: true });
      throw localError("LOCAL_MODEL_CHECKSUM", "Проверка модели не пройдена. Повторите загрузку.", "Model integrity check failed. Retry the download.", locale);
    }
    await fs.rename(partial, destination);
    completed += model.size;
    onProgress({ downloaded: completed, total });
  }
  if (models === MODELS) {
    const retired = path.join(directory, RETIRED_SUMMARY_MODEL.file);
    // Remove only the exact old weights, after replacement files passed verification.
    // A user-replaced or renamed model is never treated as our disposable cache.
    try {
      if (await verifyModel(retired, RETIRED_SUMMARY_MODEL, signal)) await fs.rm(retired);
    } catch { /* Cleanup must not invalidate successfully installed new models. */ }
  }
  return getModelStatus(directory, models);
}

module.exports = { MODELS, downloadModels, getModelStatus, requireModels, verifyModel, localError };
