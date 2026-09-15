"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLocale, translate } = require("../src/core/locale.cjs");

test("локаль определяется по системному значению и ограничена RU/EN", () => {
  assert.equal(normalizeLocale("ru-RU"), "ru");
  assert.equal(normalizeLocale("en-GB"), "en");
  assert.equal(normalizeLocale("de-DE"), "en");
});

test("переводы подставляют параметры", () => {
  assert.equal(translate("en", "tooManyVideos", { max: 20 }), "You can select no more than 20 files per run.");
  assert.equal(translate("ru", "defaultMeetingNumber", { number: 2 }), "Созвон 2");
});
