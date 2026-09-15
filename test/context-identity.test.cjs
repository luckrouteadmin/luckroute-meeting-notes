"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { contextRows, buildContextWindows, resolveContextObservations, applyContextIdentities } = require("../src/core/context-identity.cjs");
const { flattenTranscriptParts, formatTranscriptUtterances } = require("../src/core/transcript.cjs");
const makeParts = (...segments) => [{ sourceName: "call.mp3", segments: segments.map(([speaker, text]) => ({ speaker, text, start: 0, end: 2 })) }];
const observation = (rows, values = {}) => ({ speaker_key: "0:A", name: "Мария", role: null, role_category: "unknown", confidence: "high", basis: "self_introduction", evidence: rows.map(row => ({ segment_id: row.id, quote: row.text })), ...values });

test("имя принимается только с проверяемым самопредставлением", () => {
  const rows = contextRows(makeParts(["A", "Всем привет, меня зовут Мария."]));
  assert.equal(resolveContextObservations(rows, [observation(rows)])["0:A"].name, "Мария");
  for (const text of ["Я передам отчёт: Мария ждёт его завтра.", "Я не Мария, вы ошиблись.", "Мария подготовит отчёт."]) {
    const source = contextRows(makeParts(["A", text]));
    assert.deepEqual(resolveContextObservations(source, [observation(source)]), {});
  }
  assert.deepEqual(resolveContextObservations(rows, [observation(rows, { confidence: "medium" })]), {});
  assert.deepEqual(resolveContextObservations(rows, [observation(rows, { evidence: [{ segment_id: rows[0].id, quote: "Меня зовут Иван." }] })]), {});
});

test("нужны две пары обращение–ответ в одном фрагменте, без пропущенных реплик", () => {
  const parts = makeParts(["B", "Мария, расскажи о продажах."], ["A", "Мы закрыли три сделки."], ["B", "Мария, какие следующие шаги?"], ["A", "Я подготовлю новый отчёт."]);
  const rows = contextRows(parts), obs = observation(rows, { basis: "address_response" });
  assert.equal(resolveContextObservations(rows, [obs])["0:A"].name, "Мария");
  assert.deepEqual(resolveContextObservations(rows, [observation(rows.slice(0, 2), { basis: "address_response" })]), {});
  const interrupted = contextRows(makeParts(["B", rows[0].text], [null, "Подождите, я сначала добавлю."], ["A", rows[1].text], ["B", rows[2].text], ["A", rows[3].text]));
  assert.deepEqual(resolveContextObservations(interrupted, [observation(interrupted, { basis: "address_response" })]), {});
});

test("подписи голосов не переносятся между частями, конфликтующие имена отклоняются", () => {
  const rows = contextRows([...makeParts(["A", "Меня зовут Мария."]), ...makeParts(["A", "Продолжим обсуждение продаж."])]);
  assert.deepEqual(resolveContextObservations(rows, [observation([rows[0]], { speaker_key: "1:A" })]), {});
  const conflicts = contextRows(makeParts(["A", "Меня зовут Мария."], ["A", "Меня зовут Анна."]));
  assert.deepEqual(resolveContextObservations(conflicts, [observation([conflicts[0]]), observation([conflicts[1]], { name: "Анна" })]), {});
});

test("точная должность требует собственного утверждения, контекстная роль явно маркируется", () => {
  const explicit = contextRows(makeParts(["A", "Я — директор по продажам."]));
  assert.equal(resolveContextObservations(explicit, [observation(explicit, { name: null, role: "директор по продажам", basis: "role_statement" })])["0:A"].roleInferred, false);
  for (const text of ["My boss is CFO and I report to him.", "Я попросил директора по продажам прислать отчёт."]) {
    const rows = contextRows(makeParts(["A", text]));
    assert.deepEqual(resolveContextObservations(rows, [observation(rows, { name: null, role: text.startsWith("My") ? "CFO" : "директора по продажам", basis: "role_statement" })]), {});
  }
  const parts = makeParts(["A", "Я веду переговоры с клиентами."], ["A", "Я готовлю коммерческие предложения."]);
  const rows = contextRows(parts), obs = observation(rows, { name: null, basis: "role_context", role_category: "sales", confidence: "medium" });
  const mappings = resolveContextObservations(rows, [obs]);
  assert.equal(mappings["0:A"].role, "Продажи"); assert.equal(mappings["0:A"].roleInferred, true);
  assert.deepEqual(resolveContextObservations(rows, [{ ...obs, evidence: obs.evidence.slice(0, 1) }]), {});
  assert.deepEqual(resolveContextObservations(rows, [{ ...obs, role_category: "CEO" }]), {});
  const transcript = formatTranscriptUtterances(flattenTranscriptParts(applyContextIdentities(parts, mappings)), { sourceNames: ["call.mp3"] });
  assert.match(transcript, /Продажи \(предположительная роль\)/);
  assert.match(transcript, /Я веду переговоры с клиентами/);
  assert.match(transcript, /контекст; основание/);
});

test("контекст не перезаписывает противоречащую подпись видео", () => {
  const parts = [{ segments: [{ speaker: "A", speakerName: "Иван", identitySource: "video", text: "Привет" }] }];
  assert.deepEqual(applyContextIdentities(parts, { "0:A": { name: "Мария", role: "Sales", evidence: [] } }), parts);
});

test("окна контекста сохраняют все реплики", () => {
  const rows = contextRows(makeParts(...Array.from({ length: 100 }, (_, i) => ["A", `Реплика ${i}: ${"текст ".repeat(20)}`])));
  const windows = buildContextWindows(rows, 2000);
  assert.ok(windows.length > 1);
  assert.deepEqual(new Set(windows.flat().map(row => row.id)), new Set(rows.map(row => row.id)));
});
