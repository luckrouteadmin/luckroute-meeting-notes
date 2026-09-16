"use strict";

// Release gate: run the actual pinned summary model with the bundled executable.
// Synthetic content only. Unit tests do not establish native model compatibility.
const assert = require("node:assert/strict");
const path = require("node:path");
const { MODELS, downloadModels, requireModels } = require("../src/core/local-models.cjs");
const { createLocalEngine } = require("../src/core/local-engine.cjs");

async function main() {
  const modelDirectory = path.resolve(".native-cache", "smoke-models");
  const models = [MODELS[1]];
  console.log("Preparing the pinned local summary model for native verification.");
  await downloadModels({ directory: modelDirectory, models, locale: "en" });
  const engine = await createLocalEngine({ modelDirectory, binaryDirectory: path.resolve("resources/local", `${process.platform}-${process.arch}`), locale: "en",
    verify: (directory, options) => requireModels(directory, { ...options, models }) });
  const transcript = [
    "[00:00:00–00:00:30] Speaker: Cedar project: we agreed to ship the pilot on Monday. Maya will test the sample on Friday.",
    "[00:00:30–00:01:00] Speaker: For Cedar, order 600 units if the sample passes; otherwise order 300 units. Keep both conditions in the plan.",
    "[00:01:00–00:01:30] Speaker: Willow project: the warehouse quote is still missing. Omar will request the quote tomorrow.",
    "[00:01:30–00:02:00] Speaker: We have not approved Willow's budget. Wait for the quote before deciding."
  ].join("\n");
  const summary = await engine.summarizeTranscript({ transcript, summaryDetail: "detailed" });
  for (const expected of [/Cedar/i, /Willow/i, /600/, /300/, /DECISIONS/, /ACTION ITEMS BY OWNER/]) assert.match(summary, expected);
  console.log(`Native summary verification passed (${summary.length} characters).`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
