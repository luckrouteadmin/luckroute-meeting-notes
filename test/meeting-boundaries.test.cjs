"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBoundaryInput,
  normalizeMeetingRanges,
  splitUtterancesByMeetings
} = require("../src/core/meeting-boundaries.cjs");

const utterances = [
  { id: 1, sourceIndex: 0, startSeconds: 0, speakerLabel: "Анна", text: "Начинаем продажи" },
  { id: 2, sourceIndex: 0, startSeconds: 15, speakerLabel: "Борис", text: "Согласен" },
  { id: 3, sourceIndex: 1, startSeconds: 0, speakerLabel: "Ирина", text: "Новый созвон" }
];

test("вход для поиска границ сохраняет ID, файл, время и говорящего", () => {
  const input = buildBoundaryInput(utterances);
  assert.match(input, /\[ID 1\]\[Файл 1\]\[00:00:00\] Анна/);
  assert.match(input, /\[ID 3\]\[Файл 2\]/);
});

test("валидные непрерывные диапазоны разделяют реплики", () => {
  const ranges = normalizeMeetingRanges([
    { title: "Продажи", start_segment_id: 1, end_segment_id: 2 },
    { title: "Новый проект", start_segment_id: 3, end_segment_id: 3 }
  ], utterances.length);
  const meetings = splitUtterancesByMeetings(utterances, ranges);
  assert.equal(meetings.length, 2);
  assert.deepEqual(meetings.map((meeting) => meeting.utterances.length), [2, 1]);
});

test("диапазоны с пробелом безопасно заменяются одним созвоном", () => {
  const ranges = normalizeMeetingRanges([
    { title: "Первый", start_segment_id: 1, end_segment_id: 1 },
    { title: "Второй", start_segment_id: 3, end_segment_id: 3 }
  ], utterances.length);
  assert.deepEqual(ranges, [{ title: "Созвон", startSegmentId: 1, endSegmentId: 3 }]);
});
