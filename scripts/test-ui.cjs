"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const result = spawnSync(require("electron"), [path.join(__dirname, "ui-test-main.cjs")], {
  stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" }, timeout: 120000
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
