"use strict";

// Release gate: run the actual pinned summary model with the bundled executable.
// Synthetic content only. Unit tests do not establish native model compatibility.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { MODELS, downloadModels, requireModels } = require("../src/core/local-models.cjs");
const { createLocalEngine } = require("../src/core/local-engine.cjs");

async function main() {
  // Exercise real Unicode model paths too, particularly the Windows loader.
  const modelDirectory = path.resolve(".native-cache", "smoke-models", "проверка-模型");
  const models = [MODELS[1]];
  console.log(`Native host: ${process.platform}/${process.arch}, ${Math.round(os.totalmem() / 1024 ** 3)} GiB RAM.`);
  console.log("Preparing the pinned local summary model for native verification.");
  let lastProgress = -10;
  await downloadModels({ directory: modelDirectory, models, locale: "en", onProgress: ({ downloaded, total, verifying }) => {
    const percent = Math.floor(downloaded / total * 100);
    if (percent >= lastProgress + 10 || verifying) {
      console.log(verifying ? "Verifying downloaded model SHA-256." : `Model download: ${percent}%.`);
      lastProgress = percent;
    }
  } });
  console.log("Model download and integrity verification complete.");
  const engine = await createLocalEngine({ modelDirectory, binaryDirectory: path.resolve("resources/local", `${process.platform}-${process.arch}`), locale: "en",
    verify: (directory, options) => requireModels(directory, { ...options, models }) });
  const transcript = [
    "[00:00:00–00:00:30] Speaker: Cedar project: we agreed to ship the pilot on Monday. Maya will test the sample on Friday.",
    "[00:00:30–00:01:00] Speaker: For Cedar, order 600 units if the sample passes; otherwise order 300 units. Keep both conditions in the plan.",
    "[00:01:00–00:01:30] Speaker: Willow project: the warehouse quote is still missing. Omar will request the quote tomorrow.",
    "[00:01:30–00:02:00] Speaker: We have not approved Willow's budget. Wait for the quote before deciding.",
    "[00:02:00–00:02:20] Speaker: Did a rival already buy this design? Let me check the message.",
    "[00:02:20–00:02:40] Speaker: Correction: the rival only plans to order the product. No acquisition occurred, and no order is confirmed."
  ].join("\n");
  console.log("Starting native inference.");
  const summary = await engine.summarizeTranscript({ transcript, summaryDetail: "detailed", onProgress: event => console.log(event.message) });
  for (const expected of [/Cedar/i, /Willow/i, /600/, /300/, /plan(?:s|ned|ning)?\b/i, /DECISIONS/, /ACTION ITEMS BY OWNER/]) assert.match(summary, expected);
  // This is generated only from the synthetic fixture above, never user data.
  console.log(summary);
  console.log(`Native summary verification passed (${summary.length} characters).`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
