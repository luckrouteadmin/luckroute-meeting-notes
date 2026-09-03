"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { resolveFfmpegPath } = require("./audio.cjs");
const { CancelledError } = require("./errors.cjs");

const FRAME_CONCURRENCY = 3;

function buildFrameArgs(inputPath, timestampSeconds, outputPath) {
  return [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-ss", Math.max(0, Number(timestampSeconds) || 0).toFixed(3),
    "-i", inputPath,
    "-map", "0:v:0",
    "-frames:v", "1",
    "-vf", "scale=1920:-2:force_original_aspect_ratio=decrease",
    "-q:v", "2",
    outputPath
  ];
}

async function extractFrame({ inputPath, outputPath, timestampSeconds, ffmpegPath, signal }) {
  if (signal?.aborted) throw new CancelledError();
  const args = buildFrameArgs(inputPath, timestampSeconds, outputPath);
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
      stderr = `${stderr}${chunk}`.slice(-8000);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (code === 0) return finish(resolve);
      const error = new Error(stderr.trim() || `FFmpeg завершился с кодом ${code}.`);
      error.code = "FRAME_EXTRACTION_ERROR";
      finish(reject, error);
    });
  });
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size === 0) throw new Error("FFmpeg не создал кадр.");
}

async function extractSpeakerFrames({
  inputPath,
  samples,
  outputDirectory,
  ffmpegPath = resolveFfmpegPath(),
  signal,
  concurrency = FRAME_CONCURRENCY
}) {
  const extracted = [];
  for (let offset = 0; offset < samples.length; offset += concurrency) {
    if (signal?.aborted) throw new CancelledError();
    const batch = samples.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (sample) => {
      const framePath = path.join(outputDirectory, `${sample.sampleId}.jpg`);
      try {
        await extractFrame({
          inputPath,
          outputPath: framePath,
          timestampSeconds: sample.timestampSeconds,
          ffmpegPath,
          signal
        });
        return { ...sample, framePath };
      } catch (error) {
        if (signal?.aborted || error instanceof CancelledError) throw new CancelledError();
        await fs.rm(framePath, { force: true }).catch(() => {});
        return null;
      }
    }));
    extracted.push(...results.filter(Boolean));
  }
  return extracted;
}

module.exports = {
  FRAME_CONCURRENCY,
  buildFrameArgs,
  extractSpeakerFrames
};
