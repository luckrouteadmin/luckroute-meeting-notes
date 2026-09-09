"use strict";

function formatTimestamp(totalSeconds) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function speakerName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Спикер";
  if (/^speaker\s+/i.test(raw)) return raw.replace(/^speaker\s+/i, "Спикер ");
  if (/^спикер\s+/i.test(raw)) return raw;
  return `Спикер ${raw}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatPart(part) {
  const offset = Number(part.sourceOffsetSeconds ?? part.offsetSeconds) || 0;
  const segments = Array.isArray(part.segments) ? part.segments : [];
  if (segments.length > 0) {
    return segments
      .filter((segment) => normalizeText(segment.text))
      .map((segment) => {
        const start = formatTimestamp(offset + (Number(segment.start) || 0));
        const end = formatTimestamp(offset + (Number(segment.end) || Number(segment.start) || 0));
        const label = normalizeText(segment.speakerName) || speakerName(segment.speaker);
        return `[${start}–${end}] ${label}: ${normalizeText(segment.text)}`;
      })
      .join("\n");
  }

  const text = normalizeText(part.text);
  return text ? `[${formatTimestamp(offset)}] ${text}` : "";
}

function flattenTranscriptParts(parts) {
  const utterances = [];
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex] || {};
    const sourceOffsetSeconds = Number(part.sourceOffsetSeconds ?? part.offsetSeconds) || 0;
    const sourceIndex = Math.max(0, Math.trunc(Number(part.sourceIndex) || 0));
    const segments = Array.isArray(part.segments) ? part.segments : [];

    if (segments.length > 0) {
      for (const segment of segments) {
        const text = normalizeText(segment?.text);
        if (!text) continue;
        const relativeStart = Math.max(0, Number(segment?.start) || 0);
        const relativeEnd = Math.max(relativeStart, Number(segment?.end) || relativeStart);
        const identifiedName = normalizeText(segment?.speakerName);
        utterances.push({
          id: utterances.length + 1,
          partIndex,
          sourceIndex,
          sourceName: part.sourceName || "",
          startSeconds: sourceOffsetSeconds + relativeStart,
          endSeconds: sourceOffsetSeconds + relativeEnd,
          speakerLabel: identifiedName || speakerName(segment?.speaker),
          identifiedName: identifiedName || null,
          text
        });
      }
      continue;
    }

    const text = normalizeText(part.text);
    if (text) {
      utterances.push({
        id: utterances.length + 1,
        partIndex,
        sourceIndex,
        sourceName: part.sourceName || "",
        startSeconds: sourceOffsetSeconds,
        endSeconds: sourceOffsetSeconds,
        speakerLabel: "Спикер",
        identifiedName: null,
        text
      });
    }
  }
  return utterances;
}

function sourceHeader(sourceNames) {
  const names = (Array.isArray(sourceNames) ? sourceNames : [sourceNames]).filter(Boolean);
  if (names.length <= 1) return [`Исходный файл: ${names[0] || "не указан"}`];
  return [
    "Исходные файлы (в порядке обработки):",
    ...names.map((name, index) => `${index + 1}. ${name}`)
  ];
}

function formatTranscriptUtterances(utterances, {
  sourceNames,
  title,
  createdAt = new Date()
}) {
  const identifiedNames = [...new Set(utterances
    .map((utterance) => normalizeText(utterance.identifiedName))
    .filter(Boolean))];
  const header = [
    "ПОЛНАЯ РАСШИФРОВКА СОЗВОНА",
    ...(title ? [`Название: ${title}`] : []),
    ...sourceHeader(sourceNames),
    `Создано: ${createdAt.toLocaleString("ru-RU")}`,
    ...(identifiedNames.length > 0
      ? [
        `Имена, определённые по видео: ${identifiedNames.join(", ")}`,
        "Примечание: имена добавлены только при повторном совпадении читаемой подписи и видимого индикатора говорящего."
      ]
      : ["Примечание: нейтральные обозначения спикеров могут начинаться заново после каждого аудиофрагмента."])
  ];

  const body = [];
  let previousSource = null;
  const multipleSources = new Set(utterances.map((utterance) => utterance.sourceIndex)).size > 1;
  for (const utterance of utterances) {
    if (multipleSources && utterance.sourceIndex !== previousSource) {
      const visibleName = sourceNames?.[utterance.sourceIndex] || utterance.sourceName || `Файл ${utterance.sourceIndex + 1}`;
      body.push("", `ФАЙЛ ${utterance.sourceIndex + 1} — ${visibleName}`);
      previousSource = utterance.sourceIndex;
    }
    const start = formatTimestamp(utterance.startSeconds);
    const end = formatTimestamp(utterance.endSeconds);
    body.push(`[${start}–${end}] ${utterance.speakerLabel}: ${utterance.text}`);
  }
  return `${header.join("\n")}\n${body.join("\n")}\n`;
}

function formatFullTranscript(parts, { sourceName, createdAt = new Date() }) {
  return formatTranscriptUtterances(flattenTranscriptParts(parts), {
    sourceNames: [sourceName],
    createdAt
  });
}

module.exports = {
  flattenTranscriptParts,
  formatFullTranscript,
  formatPart,
  formatTimestamp,
  formatTranscriptUtterances,
  normalizeText,
  sourceHeader,
  speakerName
};
