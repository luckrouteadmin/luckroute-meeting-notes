"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { getPEImports, assertStaticRuntime } = require("../scripts/verify-pe-runtime.cjs");

function fixture(name) {
  const b = Buffer.alloc(1024);
  b.writeUInt16LE(0x5a4d, 0); b.writeUInt32LE(0x80, 0x3c); b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(1, 0x86); b.writeUInt16LE(240, 0x94); b.writeUInt16LE(0x20b, 0x98);
  b.writeUInt32LE(512, 0x98 + 60);
  b.writeUInt32LE(0x1000, 0x98 + 112 + 8); b.writeUInt32LE(40, 0x98 + 112 + 12);
  const section = 0x98 + 240;
  b.writeUInt32LE(512, section + 8); b.writeUInt32LE(0x1000, section + 12);
  b.writeUInt32LE(512, section + 16); b.writeUInt32LE(512, section + 20);
  b.writeUInt32LE(0x1080, 512 + 12); b.write(name + "\0", 640, "ascii");
  return b;
}

test("native PE check reads system imports and rejects malformed binaries", () => {
  assert.deepEqual(getPEImports(fixture("KERNEL32.dll")), ["KERNEL32.dll"]);
  assert.throws(() => getPEImports(Buffer.alloc(8)), /Invalid native PE/);
});

test("packaging rejects separate Visual C++ runtime dependencies", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luckroute-pe-test-"));
  try {
    const file = path.join(directory, "engine.exe");
    await fs.writeFile(file, fixture("MSVCP140.dll"));
    await assert.rejects(assertStaticRuntime(file), /unbundled runtime/);
    await fs.writeFile(file, fixture("KERNEL32.dll"));
    assert.deepEqual(await assertStaticRuntime(file), ["KERNEL32.dll"]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
