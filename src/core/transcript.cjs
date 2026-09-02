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
  const offset = Number(part.offsetSeconds) || 0;
  const segments = Array.isArray(part.segments) ? part.segments : [];
  if (segments.length > 0) {
    return segments
      .filter((segment) => normalizeText(segment.text))
      .map((segment) => {
        const start = formatTimestamp(offset + (Number(segment.start) || 0));
        const end = formatTimestamp(offset + (Number(segment.end) || Number(segment.start) || 0));
        return `[${start}–${end}] ${speakerName(segment.speaker)}: ${normalizeText(segment.text)}`;
      })
      .join("\n");
  }

  const text = normalizeText(part.text);
  return text ? `[${formatTimestamp(offset)}] ${text}` : "";
}

function formatFullTranscript(parts, { sourceName, createdAt = new Date() }) {
  const header = [
    "ПОЛНАЯ РАСШИФРОВКА СОЗВОНА",
    `Исходный файл: ${sourceName}`,
    `Создано: ${createdAt.toLocaleString("ru-RU")}`,
    "Примечание: при длинной записи обозначения спикеров могут начинаться заново в каждой части."
  ].join("\n");

  const body = parts
    .map((part, index) => {
      const formatted = formatPart(part);
      if (!formatted) return "";
      return `\nЧАСТЬ ${index + 1}\n${formatted}`;
    })
    .filter(Boolean)
    .join("\n");

  return `${header}\n${body}\n`;
}

module.exports = {
  formatFullTranscript,
  formatPart,
  formatTimestamp,
  normalizeText,
  speakerName
};

