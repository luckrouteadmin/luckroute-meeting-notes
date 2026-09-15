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

function runLocalProcess(binary, args, { signal, cwd, locale = "ru", maxOutputBytes = 8 * 1024 * 1024, spawnImpl = spawn } = {}) {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, args, { cwd, windowsHide: true, shell: false,
      env: engineEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let stoppedError = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => { stoppedError = new CancelledError(); child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        stoppedError = localError("LOCAL_OUTPUT_LIMIT", "Локальная модель вернула слишком большой ответ.", "Local model output exceeded its limit.", locale);
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    // Engines may echo transcript/prompt text to stderr. Drain but never log it.
    child.stderr.on("data", () => {});
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
