"use strict";

// Real native/model compatibility gate. Uses only synthetic public text.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { MODELS, downloadModels, requireModels } = require("../src/core/local-models.cjs");
const { createLocalEngine } = require("../src/core/local-engine.cjs");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luckroute-native-smoke-"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    await downloadModels({ directory, models: [MODELS[1]], signal: controller.signal });
    const engine = await createLocalEngine({ modelDirectory: directory,
      binaryDirectory: path.resolve("resources/local", `${process.platform}-${process.arch}`), locale: "en", signal: controller.signal,
      verify: (target, options) => requireModels(target, { ...options, models: [MODELS[1]] }) });
    const summary = await engine.summarizeTranscript({ transcript: "[00:00:00–00:01:00] Speaker: We agreed to ship the prototype on Monday. Alice will send the invoice on Friday. The packaging material is still undecided.", summaryDetail: "detailed" });
    for (const fact of [/Monday/i, /Friday/i, /invoice/i, /packaging/i]) assert.match(summary, fact);
    assert.match(summary, /DECISIONS/);
    console.log("Native model smoke passed: decisions, deadlines, action and open question are present.");
  } finally {
    clearTimeout(timeout);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
