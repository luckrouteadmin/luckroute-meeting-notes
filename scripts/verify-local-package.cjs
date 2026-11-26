"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { assertStaticRuntime } = require("./verify-pe-runtime.cjs");
module.exports = async function verifyLocalPackage(context) {
  const platform = context.electronPlatformName;
  const architecture = require("builder-util").Arch[context.arch];
  const directory = path.resolve(__dirname, "../resources/local", `${platform}-${architecture}`);
  const extension = platform === "win32" ? ".exe" : "";
  for (const file of ["whisper-cli" + extension, "llama-completion" + extension, "whisper-LICENSE.txt", "llama-LICENSE.txt", "versions.json"]) {
    const stat = await fs.stat(path.join(directory, file)).catch(() => null);
    if (!stat?.isFile() || !stat.size) throw new Error(`Bundled local engine file is missing: ${file}. Run npm run build:local before packaging.`);
  }
  if (platform === "win32") {
    await assertStaticRuntime(path.join(directory, "whisper-cli.exe"));
    await assertStaticRuntime(path.join(directory, "llama-completion.exe"));
  }
};
