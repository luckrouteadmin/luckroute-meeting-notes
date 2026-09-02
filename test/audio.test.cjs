"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AUDIO_CHUNK_SECONDS, buildFfmpegArgs } = require("../src/core/audio.cjs");

test("FFmpeg получает пути отдельными аргументами и режет звук на 20 минут", () => {
  const input = "/tmp/video; name.mp4";
  const output = "/tmp/audio-%03d.mp3";
  const args = buildFfmpegArgs(input, output);
  assert.equal(args[args.indexOf("-i") + 1], input);
  assert.equal(args[args.indexOf("-segment_time") + 1], String(AUDIO_CHUNK_SECONDS));
  assert.equal(args.at(-1), output);
  assert.ok(args.includes("48k"));
});

