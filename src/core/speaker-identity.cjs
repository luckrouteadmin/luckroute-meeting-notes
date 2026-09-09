"use strict";

const FRAMES_PER_SPEAKER = 5;
const MAX_SPEAKER_FRAMES = 60;
const MIN_SAMPLE_SPACING_SECONDS = 2;

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
    const offsetSeconds = Math.max(0, Number(part.sourceOffsetSeconds ?? part.offsetSeconds) || 0);
    const segments = Array.isArray(part.segments) ? part.segments : [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const speaker = rawSpeaker(segment?.speaker);
      const speakerKey = makeSpeakerKey(partIndex, speaker);
      if (!speakerKey) continue;

      const start = Math.max(0, Number(segment?.start) || 0);
      const end = Math.max(start, Number(segment?.end) || start);
      const duration = end - start;
      const positions = duration >= 8 ? [0.22, 0.52, 0.82] : duration >= 3 ? [0.32, 0.72] : [0.55];
      if (!groups.has(speakerKey)) groups.set(speakerKey, []);
      for (const position of positions) {
        const insideSegment = duration <= 0.3
          ? duration / 2
          : Math.min(
            Math.max(duration * position, Math.min(0.8, duration / 2)),
            Math.max(0.15, duration - 0.15)
          );
        groups.get(speakerKey).push({
          partIndex,
          sourceIndex: Math.max(0, Math.trunc(Number(part.sourceIndex) || 0)),
          segmentIndex,
          speaker,
          speakerKey,
          videoPath: part.sourcePath,
          timestampSeconds: offsetSeconds + start + insideSegment,
          duration
        });
      }
    }
  }

  const selectedGroups = [];
  for (const candidates of groups.values()) {
    const ranked = [...candidates].sort((left, right) => (
      right.duration - left.duration
      || left.segmentIndex - right.segmentIndex
      || left.timestampSeconds - right.timestampSeconds
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
      !["high", "medium"].includes(observation?.confidence)
      || observation?.active_indicator_visible !== true
      || observation?.name_label_visible !== true
    ) continue;

    const name = cleanParticipantName(observation?.active_speaker_name);
    if (!name) continue;
    if (!votesBySpeaker.has(sample.speakerKey)) votesBySpeaker.set(sample.speakerKey, new Map());
    const speakerVotes = votesBySpeaker.get(sample.speakerKey);
    const key = voteKey(name);
    const existing = speakerVotes.get(key) || { name, score: 0, frames: 0 };
    existing.score += observation.confidence === "high" ? 2 : 1;
    existing.frames += 1;
    speakerVotes.set(key, existing);
  }

  const mappings = {};
  for (const [speakerKey, votes] of votesBySpeaker) {
    const ranked = [...votes.values()].sort((left, right) => (
      right.score - left.score || right.frames - left.frames
    ));
    const winner = ranked[0];
    const runnerUp = ranked[1];
    if (
      winner?.frames >= 2
      && winner.score >= 3
      && winner.score > (runnerUp?.score || 0)
    ) {
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
