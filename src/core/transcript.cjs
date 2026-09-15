"use strict";

const { translate } = require("./locale.cjs");

function formatTimestamp(totalSeconds) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function speakerName(value, locale = "ru") {
  const raw = String(value || "").trim();
  const label = translate(locale, "speaker");
  if (!raw) return label;
  if (/^(?:speaker|спикер)\s+/i.test(raw)) {
    return `${label} ${raw.replace(/^(?:speaker|спикер)\s+/i, "")}`;
  }
  return `${label} ${raw}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatPart(part, locale = "ru") {
  const offset = Number(part.sourceOffsetSeconds ?? part.offsetSeconds) || 0;
  const segments = Array.isArray(part.segments) ? part.segments : [];
  if (segments.length > 0) {
    return segments
      .filter((segment) => normalizeText(segment.text))
      .map((segment) => {
        const start = formatTimestamp(offset + (Number(segment.start) || 0));
        const end = formatTimestamp(offset + (Number(segment.end) || Number(segment.start) || 0));
        const label = normalizeText(segment.speakerName) || speakerName(segment.speaker, locale);
        return `[${start}–${end}] ${label}: ${normalizeText(segment.text)}`;
      })
      .join("\n");
  }

  const text = normalizeText(part.text);
  return text ? `[${formatTimestamp(offset)}] ${text}` : "";
}

function flattenTranscriptParts(parts, { locale = "ru" } = {}) {
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
          speakerLabel: identifiedName || speakerName(segment?.speaker, locale),
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
        speakerLabel: translate(locale, "speaker"),
        identifiedName: null,
        text
      });
    }
  }
  return utterances;
}

function sourceHeader(sourceNames, locale = "ru") {
  const names = (Array.isArray(sourceNames) ? sourceNames : [sourceNames]).filter(Boolean);
  if (names.length <= 1) {
    return [translate(locale, "sourceFile", {
      name: names[0] || translate(locale, "notSpecified")
    })];
  }
  return [
    translate(locale, "sourceFiles"),
    ...names.map((name, index) => `${index + 1}. ${name}`)
  ];
}

function formatTranscriptUtterances(utterances, {
  sourceNames,
  title,
  createdAt = new Date(),
  locale = "ru",
  mode = "openai"
}) {
  const identifiedNames = [...new Set(utterances
    .map((utterance) => normalizeText(utterance.identifiedName))
    .filter(Boolean))];
  const header = [
    translate(locale, "fullTranscriptTitle"),
    ...(mode === "local" ? [locale === "en"
      ? "Processed locally. Voices and participant names are not identified. “Speaker” is a generic label, not a single person."
      : "Обработано локально. Голоса и имена участников не определяются. «Спикер» — общая метка, а не один человек."] : []),
    ...(title ? [translate(locale, "titleLabel", { title })] : []),
    ...sourceHeader(sourceNames, locale),
    translate(locale, "createdLabel", {
      date: createdAt.toLocaleString(translate(locale, "dateLocale"))
    }),
    ...(identifiedNames.length > 0
      ? [
        translate(locale, "identifiedNames", { names: identifiedNames.join(", ") }),
        translate(locale, "identifiedNamesNote")
      ]
      : [translate(locale, "neutralNamesNote")])
  ];

  const body = [];
  let previousSource = null;
  const multipleSources = new Set(utterances.map((utterance) => utterance.sourceIndex)).size > 1;
  for (const utterance of utterances) {
    if (multipleSources && utterance.sourceIndex !== previousSource) {
      const number = utterance.sourceIndex + 1;
      const visibleName = sourceNames?.[utterance.sourceIndex]
        || utterance.sourceName
        || translate(locale, "fileFallback", { number });
      body.push("", translate(locale, "fileSection", { number, name: visibleName }));
      previousSource = utterance.sourceIndex;
    }
    const start = formatTimestamp(utterance.startSeconds);
    const end = formatTimestamp(utterance.endSeconds);
    body.push(`[${start}–${end}] ${utterance.speakerLabel}: ${utterance.text}`);
  }
  return `${header.join("\n")}\n${body.join("\n")}\n`;
}

function formatFullTranscript(parts, { sourceName, createdAt = new Date(), locale = "ru" }) {
  return formatTranscriptUtterances(flattenTranscriptParts(parts, { locale }), {
    sourceNames: [sourceName],
    createdAt,
    locale
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
