"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { CancelledError } = require("./errors.cjs");

const AUDIO_CHUNK_SECONDS = 10 * 60;

function resolveFfmpegPath() {
  if (process.env.MEETING_NOTES_FFMPEG_PATH) {
    return process.env.MEETING_NOTES_FFMPEG_PATH;
  }
  let binary = require("ffmpeg-static");
  if (binary.includes("app.asar")) {
    binary = binary.replace("app.asar", "app.asar.unpacked");
  }
  return binary;
}

function buildFfmpegArgs(inputPath, outputPattern, format = "mp3") {
  return [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    ...(format === "wav" ? ["-codec:a", "pcm_s16le"] : ["-codec:a", "libmp3lame", "-b:a", "48k"]),
    "-f", "segment",
    "-segment_time", String(AUDIO_CHUNK_SECONDS),
    "-reset_timestamps", "1",
    outputPattern
  ];
}

async function splitAudio({ inputPath, outputDirectory, ffmpegPath = resolveFfmpegPath(), signal, format = "mp3" }) {
  if (!["mp3", "wav"].includes(format)) throw new Error("Unsupported audio format");
  if (signal?.aborted) throw new CancelledError();
  const outputPattern = path.join(outputDirectory, `audio-%03d.${format}`);
  const args = buildFfmpegArgs(inputPath, outputPattern, format);

  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(reject, new CancelledError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16000);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (code === 0) return finish(resolve);
      const error = new Error(stderr.trim() || `FFmpeg завершился с кодом ${code}.`);
      if (/matches no streams|stream map.*matches no streams|does not contain any stream/i.test(stderr)) {
        error.code = "NO_AUDIO";
      } else {
        error.code = "FFMPEG_ERROR";
      }
      finish(reject, error);
    });
  });

  const entries = await fs.readdir(outputDirectory);
  const chunks = entries
    .filter((name) => new RegExp(`^audio-\\d{3,}\\.${format}$`).test(name))
    .sort()
    .map((name) => path.join(outputDirectory, name));

  if (chunks.length === 0) {
    const error = new Error("Не удалось извлечь аудио из видео.");
    error.code = "NO_AUDIO";
    throw error;
  }
  return chunks;
}

module.exports = {
  AUDIO_CHUNK_SECONDS,
  buildFfmpegArgs,
  resolveFfmpegPath,
  splitAudio
};
