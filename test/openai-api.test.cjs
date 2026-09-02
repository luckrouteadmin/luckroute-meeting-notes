"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createTextResponse,
  extractResponseText,
  splitLongText,
  transcribeAudioFile
} = require("../src/core/openai-api.cjs");

test("текст извлекается из обычного JSON Responses API", () => {
  const payload = {
    output: [{
      type: "message",
      content: [
        { type: "output_text", text: "Первая часть" },
        { type: "output_text", text: "Вторая часть" }
      ]
    }]
  };
  assert.equal(extractResponseText(payload), "Первая часть\nВторая часть");
});

test("длинный текст разбивается без потери символов", () => {
  const source = `${"А".repeat(23)}\n${"Б".repeat(8)}`;
  const chunks = splitLongText(source, 10);
  assert.ok(chunks.every((chunk) => chunk.length <= 10));
  assert.equal(chunks.join("").replace(/\n/g, ""), source.replace(/\n/g, ""));
});

test("запрос расшифровки использует диаризацию и автоматическое деление речи", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-api-test-"));
  const audioPath = path.join(directory, "audio.mp3");
  await fs.writeFile(audioPath, "audio bytes");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const result = await transcribeAudioFile({
    filePath: audioPath,
    apiKey: "secret-key-for-test-only",
    fetchImpl: async (url, options) => {
      assert.match(url, /\/audio\/transcriptions$/);
      assert.equal(options.headers.Authorization, "Bearer secret-key-for-test-only");
      assert.equal(options.body.get("model"), "gpt-4o-transcribe-diarize");
      assert.equal(options.body.get("response_format"), "diarized_json");
      assert.equal(options.body.get("chunking_strategy"), "auto");
      return new Response(JSON.stringify({ text: "Привет", segments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(result.text, "Привет");
});

test("запрос сводки отключает хранение ответа и использует Responses API", async () => {
  const result = await createTextResponse({
    apiKey: "secret-key-for-test-only",
    instructions: "Инструкция",
    input: "Текст",
    maxOutputTokens: 1000,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/responses$/);
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-5-mini");
      assert.equal(body.store, false);
      assert.equal(body.instructions, "Инструкция");
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "Сводка" }] }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result, "Сводка");
});
