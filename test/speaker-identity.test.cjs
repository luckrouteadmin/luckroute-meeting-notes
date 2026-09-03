"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateSpeakerNames,
  applySpeakerNames,
  cleanParticipantName,
  selectSpeakerSamples
} = require("../src/core/speaker-identity.cjs");

test("кадры выбираются отдельно для каждого спикера и учитывают смещение части", () => {
  const samples = selectSpeakerSamples([
    {
      offsetSeconds: 0,
      segments: [
        { speaker: "A", start: 0, end: 8 },
        { speaker: "A", start: 20, end: 25 },
        { speaker: "B", start: 9, end: 14 }
      ]
    },
    {
      offsetSeconds: 1200,
      segments: [
        { speaker: "A", start: 2, end: 10 },
        { speaker: "A", start: 30, end: 35 }
      ]
    }
  ], { framesPerSpeaker: 2, maxFrames: 10 });

  assert.deepEqual(new Set(samples.map((sample) => sample.speakerKey)), new Set(["0:A", "0:B", "1:A"]));
  assert.ok(samples.some((sample) => sample.speakerKey === "1:A" && sample.timestampSeconds > 1200));
  assert.equal(new Set(samples.map((sample) => sample.sampleId)).size, samples.length);
});

test("имя принимается только после двух совпадающих уверенных кадров", () => {
  const samples = [
    { sampleId: "frame-001", speakerKey: "0:A" },
    { sampleId: "frame-002", speakerKey: "0:A" },
    { sampleId: "frame-003", speakerKey: "0:A" },
    { sampleId: "frame-004", speakerKey: "0:B" },
    { sampleId: "frame-005", speakerKey: "0:B" }
  ];
  const visible = (sampleId, name, confidence = "high") => ({
    sample_id: sampleId,
    active_speaker_name: name,
    active_indicator_visible: true,
    name_label_visible: true,
    confidence
  });
  const mappings = aggregateSpeakerNames(samples, [
    visible("frame-001", "Анастасия"),
    visible("frame-001", "Анастасия"),
    visible("frame-002", "анастасия"),
    visible("frame-003", "Ольга"),
    visible("frame-004", "Максим"),
    visible("frame-005", "Максим", "medium")
  ]);

  assert.deepEqual(mappings, { "0:A": "Анастасия" });
});

test("имя без видимого индикатора говорящего не используется", () => {
  const samples = [
    { sampleId: "frame-001", speakerKey: "0:A" },
    { sampleId: "frame-002", speakerKey: "0:A" }
  ];
  const mappings = aggregateSpeakerNames(samples, samples.map((sample) => ({
    sample_id: sample.sampleId,
    active_speaker_name: "Максим",
    active_indicator_visible: false,
    name_label_visible: true,
    confidence: "high"
  })));
  assert.deepEqual(mappings, {});
});

test("обрезанные и служебные подписи участников отбрасываются", () => {
  assert.equal(cleanParticipantName("Анастасия"), "Анастасия");
  assert.equal(cleanParticipantName("  Иван   Петров "), "Иван Петров");
  assert.equal(cleanParticipantName("Спикер 1"), null);
  assert.equal(cleanParticipantName("Ана…"), null);
});

test("подтверждённое имя добавляется только к нужной части расшифровки", () => {
  const parts = [
    { segments: [{ speaker: "A", text: "Первая часть" }] },
    { segments: [{ speaker: "A", text: "Вторая часть" }] }
  ];
  const result = applySpeakerNames(parts, { "0:A": "Максим" });
  assert.equal(result[0].segments[0].speakerName, "Максим");
  assert.equal(result[1].segments[0].speakerName, undefined);
});
