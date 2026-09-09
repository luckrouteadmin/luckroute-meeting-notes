"use strict";

const { normalizeText, formatTimestamp } = require("./transcript.cjs");

const MAX_BOUNDARY_SEGMENT_CHARACTERS = 320;

function sanitizeMeetingTitle(value, fallback) {
  const title = normalizeText(value)
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70)
    .replace(/[. ]+$/g, "");
  return title || fallback;
}

function buildBoundaryInput(utterances) {
  return utterances.map((utterance) => {
    const source = Number(utterance.sourceIndex) + 1;
    const timestamp = formatTimestamp(utterance.startSeconds);
    const speaker = normalizeText(utterance.speakerLabel) || "Спикер";
    let text = normalizeText(utterance.text);
    if (text.length > MAX_BOUNDARY_SEGMENT_CHARACTERS) {
      text = `${text.slice(0, MAX_BOUNDARY_SEGMENT_CHARACTERS - 1).trimEnd()}…`;
    }
    return `[ID ${utterance.id}][Файл ${source}][${timestamp}] ${speaker}: ${text}`;
  }).join("\n");
}

function normalizeMeetingRanges(rawMeetings, totalUtterances) {
  const total = Math.max(0, Math.trunc(Number(totalUtterances) || 0));
  if (total === 0) return [];
  const fallback = [{ title: "Созвон", startSegmentId: 1, endSegmentId: total }];
  if (!Array.isArray(rawMeetings) || rawMeetings.length === 0) return fallback;

  const normalized = rawMeetings.map((meeting, index) => ({
    title: sanitizeMeetingTitle(meeting?.title, `Созвон ${index + 1}`),
    startSegmentId: Math.trunc(Number(meeting?.start_segment_id)),
    endSegmentId: Math.trunc(Number(meeting?.end_segment_id))
  })).sort((left, right) => left.startSegmentId - right.startSegmentId);

  let expectedStart = 1;
  for (const meeting of normalized) {
    if (
      !Number.isInteger(meeting.startSegmentId)
      || !Number.isInteger(meeting.endSegmentId)
      || meeting.startSegmentId !== expectedStart
      || meeting.endSegmentId < meeting.startSegmentId
      || meeting.endSegmentId > total
    ) return fallback;
    expectedStart = meeting.endSegmentId + 1;
  }
  if (expectedStart !== total + 1) return fallback;
  return normalized;
}

function splitUtterancesByMeetings(utterances, ranges) {
  return ranges.map((range, index) => ({
    index,
    title: range.title,
    utterances: utterances.filter((utterance) => (
      utterance.id >= range.startSegmentId && utterance.id <= range.endSegmentId
    ))
  })).filter((meeting) => meeting.utterances.length > 0);
}

module.exports = {
  MAX_BOUNDARY_SEGMENT_CHARACTERS,
  buildBoundaryInput,
  normalizeMeetingRanges,
  sanitizeMeetingTitle,
  splitUtterancesByMeetings
};
