"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CHECKPOINT_FORMAT = 1;
const CHECKPOINT_NAMESPACE = "meeting-notes-transcription-v1";

async function fingerprintVideos(videoPaths) {
  const files = [];
  for (const filePath of videoPaths) {
    const stat = await fs.stat(filePath);
    files.push({
      path: path.resolve(filePath),
      size: stat.size,
      modified: Math.trunc(stat.mtimeMs)
    });
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ namespace: CHECKPOINT_NAMESPACE, files }))
    .digest("hex");
}

function isTranscriptionResult(value) {
  return value
    && typeof value === "object"
    && typeof value.text === "string"
    && (value.segments === undefined || Array.isArray(value.segments));
}

async function readCheckpoint(filePath, checkpointId) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (
      parsed?.format !== CHECKPOINT_FORMAT
      || parsed?.checkpointId !== checkpointId
      || !parsed?.transcriptions
      || typeof parsed.transcriptions !== "object"
    ) return {};
    return Object.fromEntries(
      Object.entries(parsed.transcriptions).filter(([, value]) => isTranscriptionResult(value))
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.rename(temporary, filePath);
}

async function openCheckpoint({ directory, videoPaths }) {
  if (!directory) {
    const memory = {};
    return {
      get: (key) => memory[key] || null,
      set: async (key, value) => { memory[key] = value; },
      remove: async () => {},
      hasSavedParts: () => false
    };
  }

  const checkpointId = await fingerprintVideos(videoPaths);
  const filePath = path.join(directory, `${checkpointId}.json`);
  const transcriptions = await readCheckpoint(filePath, checkpointId);
  let savedPartCount = Object.keys(transcriptions).length;

  return {
    get(key) {
      return transcriptions[key] || null;
    },
    async set(key, value) {
      if (!isTranscriptionResult(value)) return;
      transcriptions[key] = value;
      savedPartCount = Object.keys(transcriptions).length;
      await atomicWriteJson(filePath, {
        format: CHECKPOINT_FORMAT,
        checkpointId,
        updatedAt: new Date().toISOString(),
        transcriptions
      });
    },
    async remove() {
      await fs.rm(filePath, { force: true });
    },
    hasSavedParts() {
      return savedPartCount > 0;
    }
  };
}

module.exports = {
  CHECKPOINT_FORMAT,
  CHECKPOINT_NAMESPACE,
  fingerprintVideos,
  isTranscriptionResult,
  openCheckpoint,
  readCheckpoint
};
