"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SUMMARY_INSTRUCTIONS, wrapTranscript } = require("../src/core/prompt.cjs");

test("шаблон сохраняет согласованную структуру сводки", () => {
  const headings = [
    "КРАТКОЕ РЕЗЮМЕ",
    "ОБСУЖДЕНИЕ ПО ТЕМАМ",
    "ПРИНЯТЫЕ РЕШЕНИЯ",
    "ЗАДАЧИ ПО ОТВЕТСТВЕННЫМ",
    "ОТКРЫТЫЕ ВОПРОСЫ",
    "ИТОГИ"
  ];
  for (const heading of headings) assert.match(SUMMARY_INSTRUCTIONS, new RegExp(heading));
  assert.match(SUMMARY_INSTRUCTIONS, /несколько самостоятельных созвонов/i);
  assert.match(SUMMARY_INSTRUCTIONS, /личные моменты/i);
});

test("расшифровка явно отделяется от инструкций", () => {
  assert.equal(wrapTranscript("текст").endsWith("<transcript>\nтекст\n</transcript>"), true);
});

