"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SUMMARY_INSTRUCTIONS,
  getSummaryInstructions,
  wrapTranscript
} = require("../src/core/prompt.cjs");

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
  assert.match(SUMMARY_INSTRUCTIONS, /личные моменты/i);
  assert.match(SUMMARY_INSTRUCTIONS, /аргументы и возражения/i);
  assert.match(SUMMARY_INSTRUCTIONS, /5–10 содержательных предложений/i);
});

test("расшифровка явно отделяется от инструкций", () => {
  assert.equal(wrapTranscript("текст").endsWith("<transcript>\nтекст\n</transcript>"), true);
});

test("английский режим использует полный английский шаблон сводки", () => {
  const instructions = getSummaryInstructions("en");
  for (const heading of [
    "EXECUTIVE SUMMARY",
    "DISCUSSION BY TOPIC",
    "DECISIONS",
    "ACTION ITEMS BY OWNER",
    "OPEN QUESTIONS",
    "OUTCOME"
  ]) assert.match(instructions, new RegExp(heading));
  assert.match(wrapTranscript("hello", "en"), /The transcript is below/);
});
