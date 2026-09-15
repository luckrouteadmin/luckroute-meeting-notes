"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const args = [...(process.platform === "linux" ? ["--no-sandbox"] : []), path.join(__dirname, "ui-test-main.cjs")];
const result = spawnSync(require("electron"), args, {
  stdio: "inherit", env: environment, timeout: 120000
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
