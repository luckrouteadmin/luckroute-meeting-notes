"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getLocalSummaryInstructions } = require("../src/core/local-prompt.cjs");
test("локальный шаблон сохраняет структуру и запрещает выдуманные голоса", () => {
  const ru = getLocalSummaryInstructions("ru"), en = getLocalSummaryInstructions("en");
  for (const heading of ["КРАТКОЕ РЕЗЮМЕ", "ОБСУЖДЕНИЕ ПО ТЕМАМ", "ПРИНЯТЫЕ РЕШЕНИЯ", "ЗАДАЧИ ПО ОТВЕТСТВЕННЫМ", "ОТКРЫТЫЕ ВОПРОСЫ", "ИТОГИ"]) assert.ok(ru.includes(heading));
  assert.match(ru, /голоса НЕ разделены/); assert.match(ru, /предположительная роль/);
  assert.match(en, /does NOT distinguish voices/); assert.match(en, /inferred role/);
});
