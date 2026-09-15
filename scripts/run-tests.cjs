"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const directory = path.resolve(__dirname, "../test");
const files = fs.readdirSync(directory).filter((name) => name.endsWith(".test.cjs")).sort().map((name) => path.join(directory, name));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status === 0 ? 0 : 1;
