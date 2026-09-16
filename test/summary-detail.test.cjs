"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSummaryDetail, summaryBudget, detailInstructions } = require("../src/core/summary-detail.cjs");
const transcript = minutes => `[00:10:00–${String(Math.floor((minutes + 10) / 60)).padStart(2, "0")}:${String((minutes + 10) % 60).padStart(2, "0")}:00] Спикер: ${"Факт обсуждения. ".repeat(5000)}`;
test("character targets match the requested 45–60 minute reference and adapt to other lengths", () => {
  for (const minutes of [45, 60]) for (const [level, range] of Object.entries({ brief: [1000, 3000], standard: [3000, 10000], detailed: [10000, 30000] })) {
    const result = summaryBudget(transcript(minutes), level);
    assert.deepEqual([result.min, result.max], range);
  }
  assert.ok(summaryBudget(transcript(15), "detailed").max < 15000);
  assert.equal(summaryBudget(transcript(120), "brief").max, 6000);
  assert.equal(normalizeSummaryDetail("anything"), "standard");
});
test("sparse and short transcripts are not padded to the requested reference length", () => {
  assert.ok(summaryBudget("Decided to ship Monday.", "detailed").max < 1000);
  assert.match(detailInstructions(transcript(45), "brief", "en"), /Brief:.*1000–3000/s);
  assert.match(detailInstructions(transcript(45), "detailed", "ru"), /Подробная:.*10000–30000/s);
});
