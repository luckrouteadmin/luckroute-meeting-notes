"use strict";

const { spawn } = require("node:child_process");
const { CancelledError } = require("./errors.cjs");
const { localError } = require("./local-models.cjs");

// Do not pass API keys, proxy settings, or LLAMA_ARG_* overrides to bundled engines.
function engineEnvironment(source = process.env) {
  const result = {};
  const allowed = /^(PATH|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|LANG|LC_ALL)$/i;
  for (const [key, value] of Object.entries(source)) if (allowed.test(key)) result[key] = value;
  result.GGML_METAL_PATH_RESOURCES = "";
  return result;
}

function runLocalProcess(binary, args, { signal, cwd, locale = "ru", timeoutMs = 30 * 60 * 1000, maxOutputBytes = 8 * 1024 * 1024, onWhisperProgress, spawnImpl = spawn } = {}) {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, args, { cwd, windowsHide: true, shell: false,
      env: engineEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let stoppedError = null;
    let settled = false;
    let deadline;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => { stoppedError = new CancelledError(); child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (timeoutMs > 0) {
      deadline = setTimeout(() => {
        if (settled || stoppedError) return;
        stoppedError = localError("LOCAL_ENGINE_TIMEOUT",
          "Локальный движок слишком долго обрабатывает фрагмент. Закройте тяжёлые приложения и повторите обработку.",
          "The local engine took too long to process a fragment. Close memory-intensive apps and retry.", locale);
        // Resolve only on close: a CPU retry must not overlap the old process.
        child.kill("SIGKILL");
      }, timeoutMs);
      deadline.unref?.();
    }
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        stoppedError = localError("LOCAL_OUTPUT_LIMIT", "Локальная модель вернула слишком большой ответ.", "Local model output exceeded its limit.", locale);
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    // Engines may echo private source text. Only expose the recognizer's numeric
    // progress protocol, never arbitrary diagnostics or incomplete stderr lines.
    let pendingDiagnostic = "", lastProgress = -1;
    child.stderr.on("data", chunk => {
      if (!onWhisperProgress || stoppedError || settled) return;
      pendingDiagnostic += chunk.toString("utf8");
      const lines = pendingDiagnostic.split(/\r?\n/);
      pendingDiagnostic = lines.pop().slice(-1024);
      for (const line of lines) {
        const match = /^whisper_print_progress_callback: progress =\s*(\d{1,3})%$/.exec(line);
        const percent = match ? Number(match[1]) : -1;
        if (percent > lastProgress && percent <= 100) {
          lastProgress = percent;
          try { onWhisperProgress(percent); }
          catch (error) {
            stoppedError = error;
            child.kill("SIGKILL");
            break;
          }
        }
      }
    });
    child.once("error", () => finish(localError("LOCAL_ENGINE_MISSING",
      "Не удалось запустить встроенный локальный движок. Переустановите программу.",
      "The bundled local engine could not start. Reinstall the app.", locale)));
    child.once("close", (code) => {
      if (signal?.aborted || stoppedError) return finish(stoppedError || new CancelledError());
      if (code !== 0) return finish(localError("LOCAL_ENGINE_FAILED",
        `Локальный движок завершился с кодом ${code}. Закройте тяжёлые приложения и повторите.`,
        `Local engine exited with code ${code}. Close memory-intensive apps and retry.`, locale));
      finish(null, Buffer.concat(chunks).toString("utf8"));
    });
  });
}

module.exports = { engineEnvironment, runLocalProcess };
