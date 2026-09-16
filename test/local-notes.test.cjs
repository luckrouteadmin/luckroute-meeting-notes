"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { transcriptRows, splitRows, parseNotes, renderNotes, summarizeLocalNotes } = require("../src/core/local-notes.cjs");
const fact = (ids, text = "The sample needs testing.", kind = "discussion", owner = null) =>
  ({ topic: "Sample", text, kind, source_ids: ids, owner });
const output = (...items) => JSON.stringify({ items });

test("local source parsing excludes metadata and keeps all timed text across UTF-8 windows", () => {
  const rows = transcriptRows("Meeting with Invented Owner\n[00:00:00–00:00:05] Спикер: Привет 🦆.\n[00:00:05–00:01:00] Спикер: " + "Решение. ".repeat(800));
  assert.ok(rows.every(row => !row.text.includes("Invented Owner")));
  assert.ok(rows.every(row => !row.text.includes("�")));
  assert.deepEqual(splitRows(rows).flat(), rows);
  assert.equal(rows.map(row => row.text).join(" ").match(/Решение/g).length, 800);
});

test("notes reject nonexistent evidence and do not promote overlap-only facts or pronouns to owners", () => {
  const rows = [{ id: 1, text: "I will check the sample. Alex, can you hear me?" }, { id: 2, text: "Goodbye." }];
  assert.throws(() => parseNotes(output(fact([99])), rows));
  assert.deepEqual(parseNotes(output(fact([2])), rows, [rows[0]]), []);
  assert.equal(parseNotes(output(fact([1], "Check the sample.", "task", "I")), rows)[0].owner, null);
  assert.equal(parseNotes(output(fact([1], "Check the sample.", "task", "Invented")), rows)[0].owner, null);
});

test("long local summaries process every source window once without a final model compression", async () => {
  const lines = Array.from({ length: 70 }, (_, i) => `Topic ${i}: ${"A distinct product requirement. ".repeat(8)}`);
  const seen = [], progress = [];
  const result = await summarizeLocalNotes({ transcript: lines.join("\n"), locale: "en", summaryDetail: "detailed",
    onProgress: event => progress.push(event.percent),
    generate: async (_instructions, input, options) => {
      const { lines: rows } = JSON.parse(input); seen.push(...rows.map(row => row.id));
      assert.ok(options.schema); assert.equal(options.compact, true);
      return output(fact(rows.map(row => row.id).slice(-1), `Preserved last fact ${rows.at(-1).id}.`, "decision"));
    } });
  assert.deepEqual(seen, lines.map((_, i) => i + 1));
  assert.match(result, /Preserved last fact 70/);
  assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
});

test("malformed local output gets a bounded smaller-window retry and cannot silently disappear", async () => {
  let calls = 0;
  const result = await summarizeLocalNotes({ transcript: "First fact.\nSecond fact.", locale: "en",
    generate: async (_instructions, input) => {
      calls++;
      if (calls === 1) return "{truncated";
      const rows = JSON.parse(input).lines;
      return output(fact([rows[0].id], rows[0].text, "decision"));
    } });
  assert.equal(calls, 3); assert.match(result, /First fact/); assert.match(result, /Second fact/);
  calls = 0;
  await assert.rejects(summarizeLocalNotes({ transcript: "First fact.\nSecond fact.", generate: async () => { calls++; return "broken"; } }), { code: "LOCAL_INVALID_NOTES" });
  assert.equal(calls, 2);
});

test("empty substantive blocks are retried and cancellation stops the remaining local work", async () => {
  let calls = 0;
  await assert.rejects(summarizeLocalNotes({ transcript: "Some business fact. ".repeat(180), generate: async () => { calls++; return output(); } }), { code: "LOCAL_EMPTY_SUMMARY" });
  assert.ok(calls > 1 && calls < 10);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(summarizeLocalNotes({ transcript: "Some fact. ".repeat(900), signal: controller.signal,
    generate: async () => { calls++; controller.abort(); return output(); } }), { code: "CANCELLED" });
  assert.equal(calls, 1);
});

test("detail selection retains commitments and draws supporting facts from different topics", () => {
  const notes = Array.from({ length: 18 }, (_, i) => ({ kind: "discussion", topic: `Topic ${i % 3}`, text: `${i}: ${"Supporting fact. ".repeat(20)}`, owner: null }));
  notes.push({ kind: "decision", topic: "Final decision", text: "Order 600 if approved; otherwise order 300.", owner: null });
  const brief = renderNotes(notes, "en", { level: "brief", max: 1200 });
  const detailed = renderNotes(notes, "en", { level: "detailed", max: 10000 });
  assert.ok(detailed.length > brief.length);
  for (const text of ["Topic 0", "Topic 1", "Topic 2", "Order 600 if approved; otherwise order 300."]) assert.ok(brief.includes(text));
});
