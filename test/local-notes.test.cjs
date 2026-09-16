"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { transcriptRows, splitRows, parseNotes, renderNotes, summarizeLocalNotes, applyCorrections } = require("../src/core/local-notes.cjs");
const item = (id, text, kind = "discussion", topic = "Project") => ({ kind, topic, text, source_ids: [id], owner: null });

test("local analysis preserves complete input and bounds long utterances in UTF-8", () => {
  const text = "Решение 🦆 ".repeat(1000);
  const rows = transcriptRows(`Private filename\n[00:00:00–00:20:00] Спикер: ${text}`);
  assert.equal(rows.map(row => row.text).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  assert.ok(rows.every(row => Buffer.byteLength(row.text) <= 1400));
  assert.ok(splitRows(rows, 4800).every(block => Buffer.byteLength(JSON.stringify(block)) < 5000));
  assert.ok(rows.every(row => !row.text.includes("Private filename")));
});

test("multi-part facts reach the final summary without an LLM compression stage", async () => {
  const transcript = Array.from({ length: 72 }, (_, i) => `[00:${String(i).padStart(2, "0")}:00–00:${String(i).padStart(2, "0")}:59] Спикер: Topic ${i + 1}: ${"A source fact. ".repeat(25)}`).join("\n");
  let calls = 0;
  const summary = await summarizeLocalNotes({ transcript, summaryDetail: "detailed", locale: "en", generate: async (_instructions, input, options) => {
    if (JSON.parse(input).notes) return '{"corrections":[]}';
    calls++;
    assert.equal(options.schema.type, "object");
    const rows = JSON.parse(input).lines;
    return JSON.stringify({ items: rows.map(row => item(row.id, `Decision ${row.id}: deliver if approved.`, "decision", `Topic ${row.id}`)) });
  } });
  assert.equal(calls, splitRows(transcriptRows(transcript)).length);
  assert.ok(calls > 1);
  for (let i = 1; i <= 72; i++) assert.match(summary, new RegExp(`Decision ${i}: deliver if approved\\.`));
});

test("invalid or empty fragment output is retried on smaller inputs, never silently skipped", async () => {
  let calls = 0;
  const summary = await summarizeLocalNotes({ transcript: "First fact.\nLast fact.", generate: async (_instructions, input) => {
    if (JSON.parse(input).notes) return '{"corrections":[]}';
    calls++;
    const rows = JSON.parse(input).lines;
    return rows.length > 1 ? '{"items":[]}' : JSON.stringify({ items: [item(rows[0].id, rows[0].text)] });
  } });
  assert.equal(calls, 3);
  assert.match(summary, /First fact/); assert.match(summary, /Last fact/);
  await assert.rejects(summarizeLocalNotes({ transcript: "Fact.", generate: async () => '{"items":[]}' }), { code: "LOCAL_SUMMARY_INCOMPLETE" });
});

test("source references must exist; generic owners and names without evidence are removed", () => {
  const rows = [{ id: 1, text: "I will send it. Alex is away." }];
  assert.throws(() => parseNotes(JSON.stringify({ items: [item(2, "Fact")] }), rows));
  for (const owner of ["I", "Speaker", "Taylor"]) {
    assert.equal(parseNotes(JSON.stringify({ items: [{ ...item(1, "Send it.", "task"), owner }] }), rows)[0].owner, null);
  }
});

test("detail selection keeps tasks and decisions and includes later topics", () => {
  const notes = Array.from({ length: 30 }, (_, index) => ({ kind: "discussion", topic: `Topic ${index % 3}`, text: `Fact ${index}. ${"Context. ".repeat(20)}`, owner: null }));
  notes.push({ kind: "task", topic: "Topic 2", text: "Choose an owner by Friday; no delivery deadline agreed.", owner: null });
  const brief = renderNotes(notes, "en", { level: "brief", max: 1000 });
  const detailed = renderNotes(notes, "en", { level: "detailed", max: 20000 });
  assert.ok(detailed.length > brief.length * 2);
  for (const text of ["Topic 0", "Topic 1", "Topic 2", "Choose an owner by Friday"]) assert.ok(brief.includes(text));
});

test("cancellation after generation prevents publishing a partial local result", async () => {
  const controller = new AbortController();
  await assert.rejects(summarizeLocalNotes({ transcript: "Fact.", signal: controller.signal, generate: async () => {
    controller.abort(); return JSON.stringify({ items: [item(1, "Fact.")] });
  } }), { code: "CANCELLED" });
});

test("source review corrects a condition and preserves unrelated facts", () => {
  const rows = [{ id: 1, text: "Order 300 if delivery is on time, otherwise 100." }, { id: 2, text: "Alex will request the invoice." }];
  const notes = parseNotes(JSON.stringify({ items: [item(1, "Order 300 if late.", "decision"), item(2, "Request the invoice.", "task")] }), rows);
  const corrections = { corrections: [{ item_id: 1, replacement: item(1, rows[0].text, "decision") }] };
  const corrected = applyCorrections(JSON.stringify(corrections), notes, rows);
  assert.equal(corrected[0].text, rows[0].text);
  assert.deepEqual(corrected[1], notes[1]);
  assert.throws(() => applyCorrections('{"corrections":[{"item_id":3,"replacement":null}]}', notes, rows));
  assert.throws(() => applyCorrections(JSON.stringify({ corrections: [{ item_id: 1, replacement: item(999, "Unfounded") }] }), notes, rows));
});

test("cancelling source review stops output without a fragment retry", async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(summarizeLocalNotes({ transcript: "Fact.", signal: controller.signal, generate: async (_instructions, input) => {
    calls++;
    if (JSON.parse(input).notes) { controller.abort(); return '{"corrections":[]}'; }
    return JSON.stringify({ items: [item(1, "Fact.")] });
  } }), { code: "CANCELLED" });
  assert.equal(calls, 2);
});
