"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fingerprintVideos, openCheckpoint } = require("../src/core/checkpoint.cjs");

test("контрольная точка восстанавливает успешную расшифровку и удаляется после завершения", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-checkpoint-test-"));
  const checkpointDirectory = path.join(directory, "checkpoints");
  const videoPath = path.join(directory, "call.mp4");
  await fs.writeFile(videoPath, "video");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const first = await openCheckpoint({ directory: checkpointDirectory, videoPaths: [videoPath] });
  await first.set("0:0", { text: "Готовая часть", segments: [] });

  const second = await openCheckpoint({ directory: checkpointDirectory, videoPaths: [videoPath] });
  assert.equal(second.get("0:0").text, "Готовая часть");
  await second.remove();

  const third = await openCheckpoint({ directory: checkpointDirectory, videoPaths: [videoPath] });
  assert.equal(third.get("0:0"), null);
  assert.equal((await fingerprintVideos([videoPath])).length, 64);
});
