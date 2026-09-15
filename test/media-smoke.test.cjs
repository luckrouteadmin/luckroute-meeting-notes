"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { splitAudio, resolveFfmpegPath } = require("../src/core/audio.cjs");
const exec = promisify(execFile);

test("встроенный FFmpeg реально читает десять аудиоформатов и AMR-декодер", { timeout: 60000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "media-smoke-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = resolveFfmpegPath();
  const formats = { mp3: "libmp3lame", wav: "pcm_s16le", m4a: "aac", aac: "aac", flac: "flac", ogg: "libvorbis", opus: "libopus", wma: "wmav2", aiff: "pcm_s16be", aif: "pcm_s16be" };
  for (const [extension, codec] of Object.entries(formats)) {
    const inputPath = path.join(directory, `Запись с пробелами.${extension}`);
    await exec(binary, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", "-codec:a", codec, inputPath]);
    const outputDirectory = path.join(directory, extension); await fs.mkdir(outputDirectory);
    const chunks = await splitAudio({ inputPath, outputDirectory, format: "wav" });
    assert.equal(chunks.length, 1); assert.ok((await fs.stat(chunks[0])).size > 1000);
  }
  // AMR encoding is not bundled; check native decoding support without inventing a fixture.
  const { stdout } = await exec(binary, ["-hide_banner", "-decoders"]);
  assert.match(stdout, /amrnb/); assert.match(stdout, /amrwb/);
});
