"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { formatFullTranscript, formatTimestamp, speakerName } = require("../src/core/transcript.cjs");

test("таймкоды форматируются с часами", () => {
  assert.equal(formatTimestamp(0), "00:00:00");
  assert.equal(formatTimestamp(3661.9), "01:01:01");
});

test("метка спикера переводится, но имя не выдумывается", () => {
  assert.equal(speakerName("A"), "Спикер A");
  assert.equal(speakerName("speaker 2"), "Спикер 2");
});

test("таймкоды второй части продолжаются от начала записи", () => {
  const transcript = formatFullTranscript([
    { offsetSeconds: 1200, segments: [{ start: 2, end: 5, speaker: "B", text: "  Добрый день  " }] }
  ], { sourceName: "call.mp4", createdAt: new Date("2026-09-02T10:00:00Z") });
  assert.match(transcript, /\[00:20:02–00:20:05\] Спикер B: Добрый день/);
});

test("подтверждённое имя выводится вместо служебной метки спикера", () => {
  const transcript = formatFullTranscript([
    {
      offsetSeconds: 0,
      segments: [{ start: 2, end: 5, speaker: "A", speakerName: "Анастасия", text: "Добрый день" }]
    }
  ], { sourceName: "call.mp4", createdAt: new Date("2026-09-02T10:00:00Z") });
  assert.match(transcript, /Определённые участники: Анастасия/);
  assert.match(transcript, /Анастасия: Добрый день/);
  assert.doesNotMatch(transcript, /Спикер A: Добрый день/);
});
