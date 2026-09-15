"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { downloadModels, requireModels, getModelStatus } = require("../src/core/local-models.cjs");

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("a model with проверка integrity");
  const model = { id: "test", file: "model.bin", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), url: "https://example.invalid/model" };
  return { directory, bytes, model };
}
test("model download verifies SHA-256 and completed downloads never call network again", async (t) => {
  const { directory, bytes, model } = await fixture(t);
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response(bytes); };
  assert.equal((await downloadModels({ directory, models: [model], fetchImpl })).ready, true);
  await downloadModels({ directory, models: [model], fetchImpl });
  assert.equal(requests, 1);
  await requireModels(directory, { models: [model] });
});
test("partial model downloads resume at the verified HTTP range", async (t) => {
  const { directory, bytes, model } = await fixture(t);
  await fs.writeFile(path.join(directory, "model.bin.part"), bytes.subarray(0, 7));
  await downloadModels({ directory, models: [model], fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Range, "bytes=7-");
    return new Response(bytes.subarray(7), { status: 206, headers: { "content-range": `bytes 7-${bytes.length - 1}/${bytes.length}` } });
  } });
  assert.deepEqual(await fs.readFile(path.join(directory, "model.bin")), bytes);
});
test("server ignoring Range restarts instead of corrupting the model", async (t) => {
  const { directory, bytes, model } = await fixture(t);
  await fs.writeFile(path.join(directory, "model.bin.part"), bytes.subarray(0, 7));
  await downloadModels({ directory, models: [model], fetchImpl: async () => new Response(bytes) });
  await requireModels(directory, { models: [model] });
});
test("wrong hash is rejected, and a same-sized tampered installed model cannot run", async (t) => {
  const { directory, bytes, model } = await fixture(t);
  await assert.rejects(downloadModels({ directory, models: [model], fetchImpl: async () => new Response(Buffer.alloc(bytes.length)) }), { code: "LOCAL_MODEL_CHECKSUM" });
  assert.equal((await getModelStatus(directory, [model])).ready, false);
  await fs.writeFile(path.join(directory, "model.bin"), Buffer.alloc(bytes.length));
  await assert.rejects(requireModels(directory, { models: [model] }), { code: "LOCAL_MODELS_REQUIRED" });
});
test("wrong range is rejected without modifying the existing partial model", async (t) => {
  const { directory, bytes, model } = await fixture(t);
  const partial = path.join(directory, "model.bin.part");
  await fs.writeFile(partial, bytes.subarray(0, 7));
  await assert.rejects(downloadModels({ directory, models: [model], fetchImpl: async () => new Response(bytes, { status: 206, headers: { "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}` } }) }), { code: "LOCAL_DOWNLOAD_FAILED" });
  assert.deepEqual(await fs.readFile(partial), bytes.subarray(0, 7));
});
test("a cancelled download never begins a network request", async (t) => {
  const { directory, model } = await fixture(t);
  await assert.rejects(downloadModels({ directory, models: [model], signal: AbortSignal.abort(), fetchImpl: () => assert.fail("network") }), { code: "CANCELLED" });
});
test("download interruption retains partial bytes for the next attempt", async (t) => {
  const { directory, bytes, model } = await fixture(t);
  let reads = 0;
  const body = new ReadableStream({ pull(controller) { if (reads++ === 0) controller.enqueue(bytes.subarray(0, 7)); else controller.error(new Error("disconnected")); } });
  await assert.rejects(downloadModels({ directory, models: [model], fetchImpl: async () => new Response(body) }));
  assert.deepEqual(await fs.readFile(path.join(directory, "model.bin.part")), bytes.subarray(0, 7));
});
