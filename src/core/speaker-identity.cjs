"use strict";

const FRAMES_PER_SPEAKER = 3;
const MAX_SPEAKER_FRAMES = 36;
const MIN_SAMPLE_SPACING_SECONDS = 4;

function rawSpeaker(value) {
  return String(value ?? "").trim();
}

function makeSpeakerKey(partIndex, speaker) {
  const value = rawSpeaker(speaker);
  return value ? `${partIndex}:${value}` : null;
}

function selectSpeakerSamples(parts, {
  framesPerSpeaker = FRAMES_PER_SPEAKER,
  maxFrames = MAX_SPEAKER_FRAMES,
  minimumSpacingSeconds = MIN_SAMPLE_SPACING_SECONDS
} = {}) {
  const groups = new Map();

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex] || {};
    const offsetSeconds = Math.max(0, Number(part.offsetSeconds) || 0);
    for (const segment of Array.isArray(part.segments) ? part.segments : []) {
      const speaker = rawSpeaker(segment?.speaker);
      const speakerKey = makeSpeakerKey(partIndex, speaker);
      if (!speakerKey) continue;

      const start = Math.max(0, Number(segment?.start) || 0);
      const end = Math.max(start, Number(segment?.end) || start);
      const duration = end - start;
      const timestampSeconds = offsetSeconds + start + Math.max(0.1, duration / 2);
      const candidate = {
        partIndex,
        speaker,
        speakerKey,
        timestampSeconds,
        duration
      };
      if (!groups.has(speakerKey)) groups.set(speakerKey, []);
      groups.get(speakerKey).push(candidate);
    }
  }

  const selectedGroups = [];
  for (const candidates of groups.values()) {
    const ranked = [...candidates].sort((left, right) => (
      right.duration - left.duration || left.timestampSeconds - right.timestampSeconds
    ));
    const selected = [];
    for (const candidate of ranked) {
      if (selected.length >= framesPerSpeaker) break;
      if (selected.every((item) => Math.abs(item.timestampSeconds - candidate.timestampSeconds) >= minimumSpacingSeconds)) {
        selected.push(candidate);
      }
    }
    for (const candidate of ranked) {
      if (selected.length >= framesPerSpeaker) break;
      if (!selected.includes(candidate)) selected.push(candidate);
    }
    selectedGroups.push(selected);
  }

  const samples = [];
  for (let round = 0; round < framesPerSpeaker && samples.length < maxFrames; round += 1) {
    for (const group of selectedGroups) {
      if (group[round]) samples.push(group[round]);
      if (samples.length >= maxFrames) break;
    }
  }

  return samples.map((sample, index) => ({
    ...sample,
    sampleId: `frame-${String(index + 1).padStart(3, "0")}`
  }));
}

function cleanParticipantName(value) {
  const name = String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)) return null;
  if (/\.{3}|…/.test(name)) return null;
  if (/^(?:спикер|speaker|participant|участник|unknown|неизвестно|guest|гость|you|вы|я)(?:\s*\d+|\s*[a-zа-я])?$/iu.test(name)) {
    return null;
  }
  return name;
}

function voteKey(name) {
  return name.toLocaleLowerCase("ru-RU");
}

function aggregateSpeakerNames(samples, observations) {
  const sampleById = new Map(samples.map((sample) => [sample.sampleId, sample]));
  const votesBySpeaker = new Map();
  const seenSamples = new Set();

  for (const observation of Array.isArray(observations) ? observations : []) {
    const sampleId = String(observation?.sample_id || "");
    const sample = sampleById.get(sampleId);
    if (!sample || seenSamples.has(sampleId)) continue;
    seenSamples.add(sampleId);
    if (
      observation?.confidence !== "high"
      || observation?.active_indicator_visible !== true
      || observation?.name_label_visible !== true
    ) continue;

    const name = cleanParticipantName(observation?.active_speaker_name);
    if (!name) continue;
    if (!votesBySpeaker.has(sample.speakerKey)) votesBySpeaker.set(sample.speakerKey, new Map());
    const speakerVotes = votesBySpeaker.get(sample.speakerKey);
    const key = voteKey(name);
    const existing = speakerVotes.get(key) || { name, count: 0 };
    existing.count += 1;
    speakerVotes.set(key, existing);
  }

  const mappings = {};
  for (const [speakerKey, votes] of votesBySpeaker) {
    const ranked = [...votes.values()].sort((left, right) => right.count - left.count);
    const winner = ranked[0];
    const runnerUp = ranked[1];
    if (winner?.count >= 2 && winner.count > (runnerUp?.count || 0)) {
      mappings[speakerKey] = winner.name;
    }
  }
  return mappings;
}

function applySpeakerNames(parts, mappings) {
  return parts.map((part, partIndex) => ({
    ...part,
    segments: (Array.isArray(part.segments) ? part.segments : []).map((segment) => {
      const name = mappings[makeSpeakerKey(partIndex, segment?.speaker)];
      return name ? { ...segment, speakerName: name } : { ...segment };
    })
  }));
}

module.exports = {
  FRAMES_PER_SPEAKER,
  MAX_SPEAKER_FRAMES,
  aggregateSpeakerNames,
  applySpeakerNames,
  cleanParticipantName,
  makeSpeakerKey,
  selectSpeakerSamples
};
