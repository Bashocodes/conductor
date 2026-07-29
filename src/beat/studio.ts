import type { JsonValue } from "../schema/json.js";
import type {
  BeatAnalysis,
  BeatTempoConfidence,
} from "./analyze.js";
import {
  buildBeatSyncEvents,
  buildQuantizedBeatMap,
  type BeatSyncDensity,
  type BeatSyncEvent,
  type BeatSyncEventFamily,
} from "./plan.js";

export type BeatSyncTreatment =
  | "classic"
  | "solar"
  | "velocity"
  | "signal";

export interface BeatSyncKeyframe {
  time: number;
  value: JsonValue;
}

export interface BeatSyncStudioParams {
  audio: string;
  media: string[];
  treatment: BeatSyncTreatment;
  density: "restrained" | "active" | "impact";
  tempoOctave: "half" | "detected" | "double";
  phaseNudge: number;
  cuts: boolean;
  light: boolean;
  camera: boolean;
  pixelSort: boolean;
  brandPulse: boolean;
  frameRate: number;
  outputPath: string;
}

export interface BeatSyncMarker {
  timeSeconds: number;
  comment: string;
}

export interface BeatSyncMediaSegment {
  path: string;
  name: string;
  timelineInSeconds: number;
  timelineOutSeconds: number;
  sourceInSeconds: number;
  cutFrame?: number;
  intendedOnsetSeconds?: number;
}

export interface PreparedBeatSyncPlan {
  durationSeconds: number;
  audioDurationSeconds: number;
  mediaDurationSeconds: number;
  durationLimit: "audio" | "media";
  estimatedBpm: number | null;
  firstDownbeatSeconds: number | null;
  tempoConfidence: BeatTempoConfidence;
  barCount: number;
  effectiveDensity: BeatSyncDensity;
  participatingBeatCount: number;
  selectedTreatmentKeyCount: number;
  selectedTreatmentEasingSeconds: number;
  beatCount: number;
  cutCount: number;
  markers: BeatSyncMarker[];
  mediaSegments: BeatSyncMediaSegment[];
  glowKeyframes: BeatSyncKeyframe[];
  pixelSortKeyframes: BeatSyncKeyframe[];
  directionalBlurKeyframes: BeatSyncKeyframe[];
  solarExposureKeyframes: BeatSyncKeyframe[];
  solarGlowKeyframes: BeatSyncKeyframe[];
  solarBurstKeyframes: BeatSyncKeyframe[];
  solarScaleKeyframes: BeatSyncKeyframe[];
  velocityRadialBlurKeyframes: BeatSyncKeyframe[];
  velocityDirectionalBlurKeyframes: BeatSyncKeyframe[];
  velocityScaleKeyframes: BeatSyncKeyframe[];
  velocityPositionKeyframes: BeatSyncKeyframe[];
  signalPixelSortKeyframes: BeatSyncKeyframe[];
  signalPhaseKeyframes: BeatSyncKeyframe[];
  signalRedExposureKeyframes: BeatSyncKeyframe[];
  signalBlueExposureKeyframes: BeatSyncKeyframe[];
  signalScaleKeyframes: BeatSyncKeyframe[];
  signalRotationKeyframes: BeatSyncKeyframe[];
  brandKeyframes: BeatSyncKeyframe[];
}

export interface BeatSyncDurationBudget {
  mediaDurationSeconds: number;
  mediaDurationsSeconds: number[];
}

function nearestOnsetTime(
  analysis: BeatAnalysis,
  event: BeatSyncEvent,
): number {
  return nearestOnset(analysis, event)?.timeSeconds ?? event.timeSeconds;
}

function nearestOnset(
  analysis: BeatAnalysis,
  event: BeatSyncEvent,
): BeatAnalysis["onsets"][number] | undefined {
  let nearest = analysis.onsets[0];
  let distance = Math.abs(
    (nearest?.timeSeconds ?? event.timeSeconds) - event.timeSeconds,
  );
  for (let index = 1; index < analysis.onsets.length; index += 1) {
    const candidate = analysis.onsets[index];
    if (candidate === undefined) continue;
    const candidateDistance = Math.abs(
      candidate.timeSeconds - event.timeSeconds,
    );
    if (candidateDistance < distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  const snapWindow = analysis.beatSnapWindowSeconds;
  if (
    nearest === undefined ||
    snapWindow === null ||
    distance > snapWindow * 1.5
  ) {
    return undefined;
  }
  return nearest;
}

function roundedTime(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

/**
 * Builds one three-key accent around every routed event.
 *
 * The peak keeps the nearest sample-derived onset whenever it remains close
 * enough to the musical grid. Attack and release are expressed in delivered
 * frames so the approved two/three-frame vocabulary is stable at every frame
 * rate. Quiet beats retain their grid time.
 */
function effectPulseKeyframes(
  analysis: BeatAnalysis,
  events: BeatSyncEvent[],
  target: BeatSyncEvent["targets"][number],
  frameRate: number,
  durationSeconds: number,
  baseValue: JsonValue,
  peakValue: JsonValue | ((event: BeatSyncEvent) => JsonValue),
  releaseFrames = 2,
): BeatSyncKeyframe[] {
  const frameDuration = 1 / frameRate;
  const values = new Map<number, JsonValue>([
    [0, baseValue],
    [roundedTime(durationSeconds), baseValue],
  ]);
  for (const event of events) {
    if (!event.targets.includes(target)) continue;
    const peakTime = Math.max(
      0,
      Math.min(durationSeconds, nearestOnsetTime(analysis, event)),
    );
    values.set(
      roundedTime(Math.max(0, peakTime - frameDuration)),
      baseValue,
    );
    values.set(
      roundedTime(peakTime),
      typeof peakValue === "function" ? peakValue(event) : peakValue,
    );
    values.set(roundedTime(
      Math.min(durationSeconds, peakTime + releaseFrames * frameDuration),
    ), baseValue);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time, value }));
}

function numericValue(keyframe: BeatSyncKeyframe): number {
  if (typeof keyframe.value !== "number") {
    throw new Error("Expected a numeric Beat Sync keyframe.");
  }
  return keyframe.value;
}

function boundedKeyframeTrack(
  durationSeconds: number,
  entries: BeatSyncKeyframe[],
): BeatSyncKeyframe[] {
  const values = new Map<number, JsonValue>();
  for (const entry of entries) {
    values.set(
      roundedTime(Math.max(0, Math.min(durationSeconds, entry.time))),
      entry.value,
    );
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time, value }));
}

/**
 * Restores the strength-normalized envelope removed in Round 6, but keeps its
 * cost bounded on long scores. Every raw detector onset participates in a
 * half-beat bucket; the strongest sample retains its sample-derived time.
 * After that reduction, AE interpolates continuously between samples instead
 * of returning the property to zero after every accent.
 */
function onsetEnvelopeKeyframes(
  analysis: BeatAnalysis,
  durationSeconds: number,
): BeatSyncKeyframe[] {
  const period = analysis.beatPeriodSeconds ?? 0.5;
  const sampleCadence = Math.max(0.05, period / 2);
  const strongestByBucket = new Map<
    number,
    BeatAnalysis["onsets"][number]
  >();
  for (const onset of analysis.onsets) {
    if (onset.timeSeconds < 0 || onset.timeSeconds > durationSeconds) continue;
    const bucket = Math.floor(onset.timeSeconds / sampleCadence);
    const current = strongestByBucket.get(bucket);
    if (current === undefined || onset.strength > current.strength) {
      strongestByBucket.set(bucket, onset);
    }
  }
  const samples = [...strongestByBucket.values()]
    .sort((left, right) => left.timeSeconds - right.timeSeconds);
  const maximumStrength = samples.reduce(
    (maximum, sample) => Math.max(maximum, sample.strength),
    0,
  );
  if (samples.length === 0 || maximumStrength <= Number.EPSILON) {
    return [
      { time: 0, value: 0 },
      { time: durationSeconds, value: 0 },
    ];
  }
  const normalized = samples.map((sample) => ({
    time: roundedTime(sample.timeSeconds),
    value: Math.max(0, Math.min(1, sample.strength / maximumStrength)),
  }));
  return boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: normalized[0]?.value ?? 0 },
    ...normalized,
    {
      time: durationSeconds,
      value: normalized.at(-1)?.value ?? 0,
    },
  ]);
}

function mapNumericTrack(
  track: BeatSyncKeyframe[],
  mapper: (value: number, time: number) => number,
): BeatSyncKeyframe[] {
  return track.map((keyframe) => ({
    time: keyframe.time,
    value: roundedTime(mapper(numericValue(keyframe), keyframe.time)),
  }));
}

function numericTrackValueAt(
  track: BeatSyncKeyframe[],
  time: number,
): number {
  const first = track[0];
  if (first === undefined) return 0;
  if (time <= first.time) return numericValue(first);
  for (let index = 1; index < track.length; index += 1) {
    const next = track[index];
    const previous = track[index - 1];
    if (next === undefined || previous === undefined) continue;
    if (time > next.time) continue;
    const span = next.time - previous.time;
    if (span <= Number.EPSILON) return numericValue(next);
    const progress = (time - previous.time) / span;
    return numericValue(previous)
      + (numericValue(next) - numericValue(previous)) * progress;
  }
  return numericValue(track.at(-1) as BeatSyncKeyframe);
}

function withEventPeaks(
  analysis: BeatAnalysis,
  bed: BeatSyncKeyframe[],
  events: BeatSyncEvent[],
  frameRate: number,
  durationSeconds: number,
  peakValue: (event: BeatSyncEvent) => number,
  releaseFrames = 2,
): BeatSyncKeyframe[] {
  const frameDuration = 1 / frameRate;
  const values = new Map<number, number>(
    bed.map((keyframe) => [keyframe.time, numericValue(keyframe)]),
  );
  for (const event of events) {
    const peakTime = Math.max(
      0,
      Math.min(durationSeconds, nearestOnsetTime(analysis, event)),
    );
    const attackTime = roundedTime(Math.max(0, peakTime - frameDuration));
    const releaseTime = roundedTime(
      Math.min(durationSeconds, peakTime + releaseFrames * frameDuration),
    );
    values.set(attackTime, numericTrackValueAt(bed, attackTime));
    values.set(
      roundedTime(peakTime),
      Math.max(
        numericTrackValueAt(bed, peakTime),
        peakValue(event),
      ),
    );
    values.set(releaseTime, numericTrackValueAt(bed, releaseTime));
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time, value: roundedTime(value) }));
}

function adaptiveDensity(
  requested: BeatSyncDensity,
  barCount: number,
): BeatSyncDensity {
  if (barCount < 4) return "impact";
  if (barCount < 8 && requested === "restrained") return "active";
  return requested;
}

function visualParticipants(events: BeatSyncEvent[]): BeatSyncEvent[] {
  return events.filter((event) =>
    event.targets.some((target) =>
      target === "glow-accent"
      || target === "pixel-sort-accent"
      || target === "directional-blur-accent"
    )
  );
}

function eventPeak(
  event: BeatSyncEvent,
  downbeat: number,
  primary: number,
  ordinary: number,
): number {
  return event.importance === "downbeat"
    ? downbeat
    : event.importance === "primary"
      ? primary
      : ordinary;
}

function structureTimes(
  downbeats: BeatSyncEvent[],
  durationSeconds: number,
): number[] {
  return [
    0,
    ...downbeats
      .map((event) => event.timeSeconds)
      .filter((time) => time > 0 && time < durationSeconds),
    durationSeconds,
  ];
}

/**
 * Manual overrides are intentionally small and structural: choose the tempo
 * octave and move the complete grid by a fraction of that beat. The detector's
 * default arrays remain byte-for-byte authoritative when both controls are at
 * their defaults; an override regenerates a regular grid from the detected
 * downbeat anchor so snapping cannot silently undo a person's phase nudge.
 */
function overriddenBeatGrid(
  analysis: BeatAnalysis,
  params: Pick<BeatSyncStudioParams, "tempoOctave" | "phaseNudge">,
): {
  beatTimesSeconds: number[];
  primaryBeatTimesSeconds: number[];
  downbeatTimesSeconds: number[];
  estimatedBpm: number | null;
} {
  if (
    !Number.isFinite(params.phaseNudge) ||
    params.phaseNudge < -0.5 ||
    params.phaseNudge > 0.5
  ) {
    throw new Error("phaseNudge must be a finite fraction from -0.5 to 0.5.");
  }
  if (
    params.tempoOctave === "detected" &&
    Math.abs(params.phaseNudge) <= Number.EPSILON
  ) {
    return {
      beatTimesSeconds: analysis.beatTimesSeconds,
      primaryBeatTimesSeconds: analysis.primaryBeatTimesSeconds,
      downbeatTimesSeconds: analysis.downbeatTimesSeconds,
      estimatedBpm: analysis.estimatedBpm,
    };
  }

  const basePeriod = analysis.beatPeriodSeconds;
  const detectedBpm = analysis.estimatedBpm;
  const baseDownbeat =
    analysis.downbeatTimesSeconds[0] ?? analysis.beatPhaseSeconds;
  if (
    basePeriod === null ||
    baseDownbeat === null ||
    detectedBpm === null
  ) {
    throw new Error(
      "Tempo octave and phase overrides require an available detected tempo grid.",
    );
  }
  const periodMultiplier =
    params.tempoOctave === "half"
      ? 2
      : params.tempoOctave === "double"
        ? 0.5
        : 1;
  const period = basePeriod * periodMultiplier;
  const estimatedBpm = detectedBpm / periodMultiplier;
  const anchor = baseDownbeat + params.phaseNudge * period;
  const firstIndex = Math.ceil(-anchor / period);
  const lastIndex = Math.floor(
    (analysis.durationSeconds - anchor) / period,
  );
  const beatTimesSeconds: number[] = [];
  const primaryBeatTimesSeconds: number[] = [];
  const downbeatTimesSeconds: number[] = [];
  const positiveModulo = (value: number, divisor: number) =>
    ((value % divisor) + divisor) % divisor;

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const time = roundedTime(anchor + index * period);
    if (time < 0 || time > analysis.durationSeconds) continue;
    beatTimesSeconds.push(time);
    if (positiveModulo(index, 2) === 0) {
      primaryBeatTimesSeconds.push(time);
    }
    if (positiveModulo(index, 4) === 0) {
      downbeatTimesSeconds.push(time);
    }
  }
  return {
    beatTimesSeconds,
    primaryBeatTimesSeconds,
    downbeatTimesSeconds,
    estimatedBpm,
  };
}

function enabledFamilies(
  params: BeatSyncStudioParams,
): BeatSyncEventFamily[] {
  const families: BeatSyncEventFamily[] = [];
  // Splitting one continuous source at a beat without changing source time
  // creates an invisible layer boundary, not a visual cut. Only a media bin
  // can author cut evidence that the rendered-video detector can observe.
  if (params.cuts && params.media.length > 1) families.push("cuts");
  if (params.treatment !== "classic") {
    families.push("glow", "pixel-sort", "directional-blur");
  } else {
    if (params.light) families.push("glow");
    if (params.pixelSort) families.push("pixel-sort");
    if (params.camera) families.push("directional-blur");
  }
  if (params.brandPulse) families.push("brand-pulse");
  return families;
}

function buildMediaSegments(
  params: BeatSyncStudioParams,
  durationBudget: BeatSyncDurationBudget,
  durationSeconds: number,
  cuts: Array<{
    event: BeatSyncEvent;
    intendedOnsetSeconds: number;
  }>,
): BeatSyncMediaSegment[] {
  if (params.media.length === 1) {
    return [{
      path: params.media[0] as string,
      name: "Beat Sync Shot 001",
      timelineInSeconds: 0,
      timelineOutSeconds: durationSeconds,
      sourceInSeconds: 0,
    }];
  }

  const epsilon = 1 / (params.frameRate * 1_000);
  const segments: BeatSyncMediaSegment[] = [];
  let timelineInSeconds = 0;
  let mediaIndex = 0;
  let cutIndex = 0;
  let boundaryCut:
    | {
        event: BeatSyncEvent;
        intendedOnsetSeconds: number;
      }
    | undefined;

  while (timelineInSeconds < durationSeconds - epsilon) {
    const sourceDuration =
      durationBudget.mediaDurationsSeconds[mediaIndex] as number;
    const nextCut = cuts[cutIndex];
    const nextCutTime = nextCut?.event.timeSeconds ?? Number.POSITIVE_INFINITY;
    const sourceEndTime = timelineInSeconds + sourceDuration;
    const timelineOutSeconds = Math.min(
      durationSeconds,
      sourceEndTime,
      nextCutTime,
    );
    if (timelineOutSeconds <= timelineInSeconds + epsilon) {
      throw new Error(
        "Beat Sync Studio could not build a positive media segment from the "
          + "selected bin durations.",
      );
    }

    segments.push({
      path: params.media[mediaIndex] as string,
      name: `Beat Sync Shot ${String(segments.length + 1).padStart(3, "0")}`,
      timelineInSeconds,
      timelineOutSeconds,
      sourceInSeconds: 0,
      ...(boundaryCut === undefined
        ? {}
        : {
            cutFrame: boundaryCut.event.frame,
            intendedOnsetSeconds: boundaryCut.intendedOnsetSeconds,
          }),
    });

    const endedOnPlannedCut =
      nextCut !== undefined &&
      Math.abs(timelineOutSeconds - nextCut.event.timeSeconds) <= epsilon;
    timelineInSeconds = timelineOutSeconds;
    mediaIndex = (mediaIndex + 1) % params.media.length;
    if (endedOnPlannedCut) {
      boundaryCut = nextCut;
      cutIndex += 1;
    } else {
      boundaryCut = undefined;
    }
  }

  return segments;
}

export function buildBeatSyncStudioPlan(
  params: BeatSyncStudioParams,
  analysis: BeatAnalysis,
  durationBudget: BeatSyncDurationBudget,
): PreparedBeatSyncPlan {
  if (params.media.length === 0) {
    throw new Error("Beat Sync Studio requires at least one media file.");
  }
  if (analysis.onsets.length === 0) {
    throw new Error(
      "Beat analysis found no usable onsets; refusing to build an unverified beat-sync edit.",
    );
  }
  if (
    !Number.isFinite(durationBudget.mediaDurationSeconds) ||
    durationBudget.mediaDurationSeconds <= 0
  ) {
    throw new Error(
      "Beat Sync Studio could not determine a positive duration for the selected media.",
    );
  }
  if (
    durationBudget.mediaDurationsSeconds.length !== params.media.length ||
    durationBudget.mediaDurationsSeconds.some(
      (duration) => !Number.isFinite(duration) || duration <= 0,
    )
  ) {
    throw new Error(
      "Beat Sync Studio requires one positive probed duration for every selected media file.",
    );
  }

  const durationLimit =
    analysis.durationSeconds <= durationBudget.mediaDurationSeconds
      ? "audio"
      : "media";
  const unquantizedDurationSeconds = Math.min(
    analysis.durationSeconds,
    durationBudget.mediaDurationSeconds,
  );
  const durationSeconds =
    Math.max(1, Math.floor(unquantizedDurationSeconds * params.frameRate)) /
    params.frameRate;
  const adjustedGrid = overriddenBeatGrid(analysis, params);
  const beats = buildQuantizedBeatMap({
    beatTimesSeconds: adjustedGrid.beatTimesSeconds,
    primaryBeatTimesSeconds: adjustedGrid.primaryBeatTimesSeconds,
    downbeatTimesSeconds: adjustedGrid.downbeatTimesSeconds,
    frameRate: params.frameRate,
  }).filter((beat) => beat.timeSeconds < durationSeconds);
  const resultingBeatPeriod =
    adjustedGrid.estimatedBpm === null
      ? analysis.beatPeriodSeconds
      : 60 / adjustedGrid.estimatedBpm;
  const barCount =
    resultingBeatPeriod === null
      ? beats.length / 4
      : durationSeconds / (resultingBeatPeriod * 4);
  const effectiveDensity = adaptiveDensity(params.density, barCount);
  const events = buildBeatSyncEvents(beats, {
    density: effectiveDensity,
    brandPulse: params.brandPulse,
    allowedEventFamilies: enabledFamilies(params),
  });
  const markers = events.map((event) => {
    const detected = nearestOnsetTime(analysis, event);
    return {
      timeSeconds: event.timeSeconds,
      comment:
        `${event.importance} · frame ${event.frame} · detected `
        + `${detected.toFixed(6)}s · ${event.targets.join(", ") || "map only"}`,
    };
  });

  const cuts = events
    .filter(
      (event) =>
        event.frame > 0 &&
        event.timeSeconds < durationSeconds &&
        event.targets.includes("cut"),
    )
    .map((event) => ({
      event,
      intendedOnsetSeconds: nearestOnsetTime(analysis, event),
    }));
  const mediaSegments = buildMediaSegments(
    params,
    durationBudget,
    durationSeconds,
    cuts,
  );

  const participants = visualParticipants(events);
  const downbeatEvents = events.filter(
    (event) => event.importance === "downbeat",
  );
  const envelope = onsetEnvelopeKeyframes(analysis, durationSeconds);
  const zeroBed: BeatSyncKeyframe[] = [
    { time: 0, value: 0 },
    { time: durationSeconds, value: 0 },
  ];

  // Classic remains the default vocabulary. Its primary-only Pixel Sort
  // accent now rides over the restored, low-level onset bed.
  const classicPixelBed = mapNumericTrack(
    envelope,
    (value) => 5 + value * 16,
  );
  const pixelSortKeyframes = withEventPeaks(
    analysis,
    classicPixelBed,
    events.filter((event) =>
      event.targets.includes("pixel-sort-accent")
    ),
    params.frameRate,
    durationSeconds,
    () => 40,
    2,
  );
  const glowKeyframes = effectPulseKeyframes(
    analysis,
    events,
    "glow-accent",
    params.frameRate,
    durationSeconds,
    0,
    0.25,
    3,
  );
  const directionalBlurKeyframes = effectPulseKeyframes(
    analysis,
    events,
    "directional-blur-accent",
    params.frameRate,
    durationSeconds,
    0,
    5,
    2,
  );

  // Solar Ascension: exposure breathes continuously, all participating grid
  // events bloom, the framing pushes in by bar, and the last downbeat arrives
  // with a deliberately conspicuous radial light burst.
  const solarExposureKeyframes = mapNumericTrack(
    envelope,
    (value, time) =>
      -0.04 + value * 0.24 + (time / durationSeconds) * 0.1,
  );
  const solarGlowKeyframes = withEventPeaks(
    analysis,
    zeroBed,
    participants,
    params.frameRate,
    durationSeconds,
    (event) => eventPeak(event, 0.9, 0.6, 0.4),
    3,
  );
  const arrivalTime =
    downbeatEvents.at(-1)?.timeSeconds ?? durationSeconds * 0.75;
  const solarBurstKeyframes = boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: 0 },
    { time: arrivalTime - 1 / params.frameRate, value: 0 },
    { time: arrivalTime, value: 110 },
    { time: arrivalTime + 4 / params.frameRate, value: 0 },
    { time: durationSeconds, value: 0 },
  ]);
  const solarScaleKeyframes = boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: [104, 104] },
    ...downbeatEvents.map((event, index) => ({
      time: event.timeSeconds,
      value: [
        index === downbeatEvents.length - 1 ? 118 : 106 + index * 2,
        index === downbeatEvents.length - 1 ? 118 : 106 + index * 2,
      ],
    })),
    { time: arrivalTime + 0.18, value: [113, 113] },
    { time: durationSeconds, value: [114, 114] },
  ]);

  // Velocity Arc: the full onset envelope is a low radial-zoom blur bed;
  // beat peaks add speed, while the scale/position arc changes direction each
  // bar and lands on a 128% final-downbeat punch.
  const velocityRadialBlurKeyframes = withEventPeaks(
    analysis,
    mapNumericTrack(envelope, (value) => 0.8 + value * 3.2),
    participants,
    params.frameRate,
    durationSeconds,
    (event) => eventPeak(event, 22, 14, 9),
    3,
  );
  const velocityDirectionalBlurKeyframes = withEventPeaks(
    analysis,
    zeroBed,
    participants,
    params.frameRate,
    durationSeconds,
    (event) => eventPeak(event, 10, 6, 3),
    2,
  );
  const velocityScaleKeyframes = boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: [106, 106] },
    ...downbeatEvents.map((event, index) => ({
      time: event.timeSeconds,
      value: [
        index === downbeatEvents.length - 1 ? 128 : 108 + index * 3,
        index === downbeatEvents.length - 1 ? 128 : 108 + index * 3,
      ],
    })),
    { time: arrivalTime + 0.2, value: [118, 118] },
    { time: durationSeconds, value: [118, 118] },
  ]);
  const velocityPositionKeyframes = boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: [0.5, 0.515] },
    ...downbeatEvents.map((event, index) => ({
      time: event.timeSeconds,
      value: index % 2 === 0 ? [0.485, 0.5] : [0.515, 0.485],
    })),
    { time: durationSeconds, value: [0.5, 0.5] },
  ]);

  // Signal Break: Pixel Sort is the always-on onset bed and every
  // participating grid event becomes a bolder fracture. Phase descends by bar,
  // opposite red/blue exposure pulses split the palette, and the final tilt is
  // the treatment's unmistakable transform.
  const signalPixelSortKeyframes = withEventPeaks(
    analysis,
    mapNumericTrack(envelope, (value) => 8 + value * 28),
    participants,
    params.frameRate,
    durationSeconds,
    (event) => eventPeak(event, 92, 72, 56),
    3,
  );
  const signalStructureTimes = structureTimes(
    downbeatEvents,
    durationSeconds,
  );
  const signalPhaseKeyframes = boundedKeyframeTrack(
    durationSeconds,
    signalStructureTimes.map((time, index) => ({
      time,
      value: Math.max(15, 100 - index * 22),
    })),
  );
  const signalRedExposureKeyframes = withEventPeaks(
    analysis,
    zeroBed,
    participants,
    params.frameRate,
    durationSeconds,
    (event) => eventPeak(event, 0.55, 0.4, 0.25),
    2,
  );
  const signalBlueExposureKeyframes = signalRedExposureKeyframes.map(
    (keyframe) => ({
      time: keyframe.time,
      value: roundedTime(-numericValue(keyframe) * 0.7),
    }),
  );
  const signalScaleKeyframes = boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: [110, 110] },
    ...downbeatEvents.map((event, index) => ({
      time: event.timeSeconds,
      value: [
        index === downbeatEvents.length - 1 ? 120 : 110 + index * 2,
        index === downbeatEvents.length - 1 ? 120 : 110 + index * 2,
      ],
    })),
    { time: arrivalTime + 0.2, value: [112, 112] },
    { time: durationSeconds, value: [112, 112] },
  ]);
  const signalRotationKeyframes = boundedKeyframeTrack(durationSeconds, [
    { time: 0, value: 0 },
    ...downbeatEvents.map((event, index) => ({
      time: event.timeSeconds,
      value:
        index === downbeatEvents.length - 1
          ? 6
          : index % 2 === 0 ? -3 : 3,
    })),
    { time: arrivalTime + 0.2, value: 0 },
    { time: durationSeconds, value: 0 },
  ]);

  const classicKeyCount =
    (params.pixelSort ? pixelSortKeyframes.length : 0)
    + (params.light ? glowKeyframes.length : 0)
    + (params.camera ? directionalBlurKeyframes.length : 0);
  const treatmentKeyCounts: Record<BeatSyncTreatment, number> = {
    classic: classicKeyCount,
    solar:
      solarExposureKeyframes.length
      + solarGlowKeyframes.length
      + solarBurstKeyframes.length
      + solarScaleKeyframes.length,
    velocity:
      velocityRadialBlurKeyframes.length
      + velocityDirectionalBlurKeyframes.length
      + velocityScaleKeyframes.length
      + velocityPositionKeyframes.length,
    signal:
      signalPixelSortKeyframes.length
      + signalPhaseKeyframes.length
      + signalRedExposureKeyframes.length
      + signalBlueExposureKeyframes.length
      + signalScaleKeyframes.length
      + signalRotationKeyframes.length,
  };
  const brandKeyframes = effectPulseKeyframes(
    analysis,
    events,
    "brand-pulse",
    params.frameRate,
    durationSeconds,
    10,
    20,
    2,
  );
  const selectedTreatmentKeyCount =
    treatmentKeyCounts[params.treatment]
    + (params.brandPulse ? brandKeyframes.length : 0);
  const plan: PreparedBeatSyncPlan = {
    durationSeconds,
    audioDurationSeconds: analysis.durationSeconds,
    mediaDurationSeconds: durationBudget.mediaDurationSeconds,
    durationLimit,
    estimatedBpm: adjustedGrid.estimatedBpm,
    firstDownbeatSeconds:
      beats.find((beat) => beat.importance === "downbeat")?.timeSeconds ?? null,
    tempoConfidence: analysis.tempoConfidence,
    barCount,
    effectiveDensity,
    participatingBeatCount: participants.length,
    selectedTreatmentKeyCount,
    selectedTreatmentEasingSeconds: selectedTreatmentKeyCount * 0.0015,
    beatCount: beats.length,
    cutCount: cuts.length,
    markers,
    mediaSegments,
    glowKeyframes,
    pixelSortKeyframes,
    directionalBlurKeyframes,
    solarExposureKeyframes,
    solarGlowKeyframes,
    solarBurstKeyframes,
    solarScaleKeyframes,
    velocityRadialBlurKeyframes,
    velocityDirectionalBlurKeyframes,
    velocityScaleKeyframes,
    velocityPositionKeyframes,
    signalPixelSortKeyframes,
    signalPhaseKeyframes,
    signalRedExposureKeyframes,
    signalBlueExposureKeyframes,
    signalScaleKeyframes,
    signalRotationKeyframes,
    brandKeyframes,
  };
  return plan;
}

export function withBeatSyncPlanParams(
  params: Record<string, unknown>,
  plan: PreparedBeatSyncPlan,
): Record<string, unknown> {
  return {
    ...params,
    planDurationSeconds: plan.durationSeconds,
    planAudioDurationSeconds: plan.audioDurationSeconds,
    planMediaDurationSeconds: plan.mediaDurationSeconds,
    planDurationLimit: plan.durationLimit,
    planEstimatedBpm: plan.estimatedBpm ?? 0,
    planFirstDownbeatSeconds: plan.firstDownbeatSeconds ?? 0,
    planTempoConfidence: plan.tempoConfidence,
    planBarCount: plan.barCount,
    planEffectiveDensity: plan.effectiveDensity,
    planParticipatingBeatCount: plan.participatingBeatCount,
    planTreatmentKeyCount: plan.selectedTreatmentKeyCount,
    planTreatmentEasingSeconds: plan.selectedTreatmentEasingSeconds,
    planBeatCount: plan.beatCount,
    planCutCount: plan.cutCount,
    planMarkers: plan.markers,
    planMediaSegments: plan.mediaSegments,
    planUseClassicPixelSort:
      params.treatment === "classic" && params.pixelSort === true,
    planUseClassicGlow:
      params.treatment === "classic" && params.light === true,
    planUseClassicDirectionalBlur:
      params.treatment === "classic" && params.camera === true,
    planUseSolar: params.treatment === "solar",
    planUseVelocity: params.treatment === "velocity",
    planUseSignal: params.treatment === "signal",
    planGlowKeyframes: plan.glowKeyframes,
    planPixelSortKeyframes: plan.pixelSortKeyframes,
    planDirectionalBlurKeyframes: plan.directionalBlurKeyframes,
    planSolarExposureKeyframes: plan.solarExposureKeyframes,
    planSolarGlowKeyframes: plan.solarGlowKeyframes,
    planSolarBurstKeyframes: plan.solarBurstKeyframes,
    planSolarScaleKeyframes: plan.solarScaleKeyframes,
    planVelocityRadialBlurKeyframes: plan.velocityRadialBlurKeyframes,
    planVelocityDirectionalBlurKeyframes:
      plan.velocityDirectionalBlurKeyframes,
    planVelocityScaleKeyframes: plan.velocityScaleKeyframes,
    planVelocityPositionKeyframes: plan.velocityPositionKeyframes,
    planSignalPixelSortKeyframes: plan.signalPixelSortKeyframes,
    planSignalPhaseKeyframes: plan.signalPhaseKeyframes,
    planSignalRedExposureKeyframes: plan.signalRedExposureKeyframes,
    planSignalBlueExposureKeyframes: plan.signalBlueExposureKeyframes,
    planSignalScaleKeyframes: plan.signalScaleKeyframes,
    planSignalRotationKeyframes: plan.signalRotationKeyframes,
    planBrandKeyframes: plan.brandKeyframes,
  };
}
