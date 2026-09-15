"use strict";

// Build native engines as part of the installer. End users never compile or install tools.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { assertStaticRuntime } = require("./verify-pe-runtime.cjs");

const SOURCES = Object.freeze([
  { name: "whisper", repository: "https://github.com/ggml-org/whisper.cpp.git",
    commit: "927cfce34f31707e17f2bff35c349632fb9e2c3a", target: "whisper-cli" },
  { name: "llama", repository: "https://github.com/ggml-org/llama.cpp.git",
    commit: "b29c606e28a01b1bc8c1351026a0fa6e616bf6c4", target: "llama-completion" }
]);

function command(binary, args, cwd, capture = false) {
  return execFileSync(binary, args, { cwd, stdio: capture ? "pipe" : "inherit", encoding: "utf8", windowsHide: true });
}

async function enableWindowsUtf8(binary, root, buildDirectory) {
  // Whisper's model loader expects UTF-8 but its CLI otherwise receives ANSI argv.
  // Set the code page per process, without changing the user's Windows settings.
  const cache = await fs.readFile(path.join(buildDirectory, "CMakeCache.txt"), "utf8");
  const cmakeMt = cache.match(/^CMAKE_MT:[^=]+=(.+)$/m)?.[1]?.trim();
  const candidates = cmakeMt && path.isAbsolute(cmakeMt) ? [cmakeMt] : [];
  const sdk = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const versions = (await fs.readdir(sdk).catch(() => [])).filter(name => /^10\./.test(name)).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  for (const version of versions) candidates.push(path.join(sdk, version, "x64", "mt.exe"));
  let mt;
  for (const candidate of candidates) if (await fs.stat(candidate).catch(() => null)) { mt = candidate; break; }
  if (!mt) throw new Error("Windows SDK manifest tool (mt.exe) is required to package UTF-8 native engines");
  command(mt, ["-nologo", `-inputresource:${binary};#1`, "-manifest", path.join(root, "build", "native-utf8.manifest"), `-outputresource:${binary};#1`], buildDirectory);
  const extracted = path.join(buildDirectory, "luckroute-verified.manifest");
  command(mt, ["-nologo", `-inputresource:${binary};#1`, `-out:${extracted}`], buildDirectory);
  if (!/activeCodePage[^>]*>UTF-8</.test(await fs.readFile(extracted, "utf8"))) throw new Error("Native UTF-8 manifest verification failed");
}

async function verifyWhisperUnicode(binary, directory) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "luckroute-native-test-"));
  try {
    const model = path.join(temporary, "проверка-模型.bin");
    await fs.writeFile(model, Buffer.alloc(16));
    let diagnostics = "";
    try { command(binary, ["-m", model, "-f", path.join(directory, "samples", "jfk.wav"), "-ng"], temporary, true); }
    catch (error) { diagnostics = String(error.stderr || ""); }
    // Reaching the magic check proves the exact Unicode file could be opened.
    if (!diagnostics.includes("bad magic")) throw new Error("Native Unicode model-path smoke test failed");
    console.log("Native Unicode model-path smoke test passed");
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "resources", "local", `${process.platform}-${process.arch}`);
  const cache = path.join(root, ".native-cache");
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  for (const source of SOURCES) {
    const directory = path.join(cache, `${source.name}-${source.commit}`);
    if (!await fs.stat(directory).catch(() => null)) {
      await fs.mkdir(directory);
      command("git", ["init", "--quiet"], directory);
      command("git", ["remote", "add", "origin", source.repository], directory);
    }
    let actual = "";
    try { actual = command("git", ["rev-parse", "HEAD"], directory, true).trim(); } catch {}
    if (actual !== source.commit) {
      command("git", ["fetch", "--depth", "1", "origin", source.commit], directory);
      command("git", ["-c", "core.longpaths=true", "switch", "--detach", "FETCH_HEAD"], directory);
    }
    if (command("git", ["rev-parse", "HEAD"], directory, true).trim() !== source.commit) throw new Error("Native source pin mismatch");
    const flags = ["-S", directory, "-B", path.join(directory, "build"), "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF", "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF",
      "-DGGML_METAL=" + (process.platform === "darwin" ? "ON" : "OFF"),
      "-DGGML_METAL_EMBED_LIBRARY=ON", "-DGGML_CUDA=OFF", "-DGGML_VULKAN=OFF",
      "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_BUILD_SERVER=OFF",
      "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF", "-DLLAMA_BUILD_SERVER=OFF",
      "-DLLAMA_BUILD_APP=OFF", "-DLLAMA_BUILD_UI=OFF", "-DLLAMA_OPENSSL=OFF"];
    if (process.arch === "x64") flags.push("-DGGML_BMI2=OFF", "-DGGML_AVX2=OFF", "-DGGML_AVX512=OFF", "-DGGML_FMA=OFF", "-DGGML_F16C=OFF");
    if (process.platform === "win32") flags.push("-A", "x64", "-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
    if (process.platform === "darwin") flags.push("-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0");
    command("cmake", flags, directory);
    command("cmake", ["--build", path.join(directory, "build"), "--config", "Release", "--parallel", String(Math.min(4, os.cpus().length)), "--target", source.target], directory);
    const extension = process.platform === "win32" ? ".exe" : "";
    const candidates = [path.join(directory, "build", "bin", "Release", source.target + extension), path.join(directory, "build", "bin", source.target + extension)];
    const binary = (await Promise.all(candidates.map(async (file) => await fs.stat(file).catch(() => null) ? file : null))).find(Boolean);
    if (!binary) throw new Error(`Missing native binary: ${source.target}`);
    const installed = path.join(output, source.target + extension);
    await fs.copyFile(binary, installed);
    await fs.chmod(installed, 0o755);
    if (process.platform === "win32") {
      await enableWindowsUtf8(installed, root, path.join(directory, "build"));
      console.log("Native system-only DLL dependencies:", (await assertStaticRuntime(installed)).join(", "));
    }
    await fs.copyFile(path.join(directory, "LICENSE"), path.join(output, `${source.name}-LICENSE.txt`));
    command(installed, ["--help"], output, true);
    if (source.name === "whisper") await verifyWhisperUnicode(installed, directory);
  }
  await fs.writeFile(path.join(output, "versions.json"), JSON.stringify(SOURCES, null, 2) + "\n");
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { SOURCES };
