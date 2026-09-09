"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFrameArgs } = require("../src/core/video.cjs");

test("FFmpeg извлекает один кадр в нужный момент без аудио", () => {
  const args = buildFrameArgs("meeting.mp4", 65.4321, "frame.jpg");
  assert.deepEqual(args.slice(0, 9), [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", "65.432", "-i", "meeting.mp4"
  ]);
  assert.ok(args.includes("scale=2560:-2:force_original_aspect_ratio=decrease"));
  assert.ok(args.includes("0:v:0"));
  assert.ok(args.includes("1"));
  assert.equal(args.at(-1), "frame.jpg");
});
