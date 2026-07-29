import type { JsonValue } from "../schema/json.js";
import type { BeatAnalysis } from "./analyze.js";
import {
  buildBeatSyncEvents,
  buildQuantizedBeatMap,
  type BeatSyncEvent,
  type BeatSyncEventFamily,
} from "./plan.js";

export interface BeatSyncStudioParams {
  audio: string;
  media: string[];
  density: "restrained" | "active" | "impact";
  cuts: boolean;
  transitions: boolean;
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
  beatCount: number;
  cutCount: number;
  markers: BeatSyncMarker[];
  mediaSegments: BeatSyncMediaSegment[];
  cameraKeyframes: Array<{ time: number; value: JsonValue }>;
  lightKeyframes: Array<{ time: number; value: JsonValue }>;
  transitionKeyframes: Array<{ time: number; value: JsonValue }>;
  pixelSortKeyframes: Array<{ time: number; value: JsonValue }>;
  brandKeyframes: Array<{ time: number; value: JsonValue }>;
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
  return nearest;
}

function pulseKeyframes(
  events: BeatSyncEvent[],
  target: BeatSyncEvent["targets"][number],
  frameRate: number,
  durationSeconds: number,
  baseValue: JsonValue,
  peakValue: (event: BeatSyncEvent) => JsonValue,
  onlyNonCuts: boolean,
  releaseFrames = 2,
): Array<{ time: number; value: JsonValue }> {
  const finalFrame = Math.max(1, Math.round(durationSeconds * frameRate));
  const values = new Map<number, JsonValue>([
    [0, baseValue],
    [finalFrame, baseValue],
  ]);
  for (const event of events) {
    if (
      !event.targets.includes(target) ||
      (onlyNonCuts && event.targets.includes("cut"))
    ) {
      continue;
    }
    values.set(Math.max(0, event.frame - 1), baseValue);
    values.set(event.frame, peakValue(event));
    values.set(
      Math.min(finalFrame, event.frame + releaseFrames),
      baseValue,
    );
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, value]) => ({ time: frame / frameRate, value }));
}

function roundedTime(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

/**
 * Converts the detector's raw spectral-flux strengths to the native effect's
 * 0–100 percentage contract. The intermediate `normalizedStrength` is the
 * requested 0–1 analysis envelope; the existing beat importance hierarchy
 * then gives ordinary beats a restrained range and strong tiers larger bursts.
 *
 * Unlike cut boundaries, these keys retain the detector's sample-derived
 * times. AE evaluates the continuous curve at render time, so the sub-hop
 * position changes the curve even though visual frames remain frame sampled.
 */
function pixelSortEnvelopeKeyframes(
  analysis: BeatAnalysis,
  events: BeatSyncEvent[],
  durationSeconds: number,
): Array<{ time: number; value: JsonValue }> {
  // The event list is the output of buildBeatSyncEvents(), so pixel sorting
  // consumes the same importance classification as cuts and smaller accents.
  // Only the key time and raw strength come back from the unquantized onset.
  const samples = events.flatMap((event) => {
    const onset = nearestOnset(analysis, event);
    return onset === undefined
      ? []
      : [{
          timeSeconds: onset.timeSeconds,
          strength: onset.strength,
          importance: event.importance,
        }];
  });
  const maximumStrength = samples.reduce(
    (maximum, sample) => Math.max(maximum, sample.strength),
    0,
  );
  const values = new Map<number, number>([
    [0, 0],
    [roundedTime(durationSeconds), 0],
  ]);
  const setMaximum = (time: number, value: number) => {
    const boundedTime = roundedTime(
      Math.max(0, Math.min(durationSeconds, time)),
    );
    values.set(boundedTime, Math.max(values.get(boundedTime) ?? 0, value));
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    if (sample.timeSeconds > durationSeconds) continue;
    const normalizedStrength =
      maximumStrength <= Number.EPSILON
        ? 0
        : Math.max(0, Math.min(1, sample.strength / maximumStrength));
    const beatAmount =
      sample.importance === "downbeat"
        ? 58 + normalizedStrength * 42
        : sample.importance === "primary"
          ? 32 + normalizedStrength * 28
          : 12 + normalizedStrength * 18;
    const previousTime = samples[index - 1]?.timeSeconds ?? 0;
    const nextTime =
      samples[index + 1]?.timeSeconds ?? durationSeconds;
    const attackSeconds = Math.min(
      0.045,
      Math.max(0.005, (sample.timeSeconds - previousTime) * 0.35),
    );
    const releaseSeconds = Math.min(
      0.18,
      Math.max(0.02, (nextTime - sample.timeSeconds) * 0.55),
    );
    setMaximum(sample.timeSeconds - attackSeconds, 0);
    setMaximum(sample.timeSeconds, beatAmount);
    setMaximum(sample.timeSeconds + releaseSeconds, 0);
  }

  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({
      time,
      value: Math.round(value * 1_000_000) / 1_000_000,
    }));
}

function enabledFamilies(
  params: BeatSyncStudioParams,
): BeatSyncEventFamily[] {
  const families: BeatSyncEventFamily[] = [];
  // Splitting one continuous source at a beat without changing source time
  // creates an invisible layer boundary, not a visual cut. Only a media bin
  // can author cut evidence that the rendered-video detector can observe.
  if (params.cuts && params.media.length > 1) families.push("cuts");
  if (params.transitions) families.push("transitions");
  if (params.light) families.push("light");
  if (params.camera) families.push("camera");
  if (params.brandPulse) families.push("brand-pulse");
  return families;
}

function cameraPeak(
  params: BeatSyncStudioParams,
  event: BeatSyncEvent,
): JsonValue {
  const scale =
    params.density === "restrained"
      ? 101.5
      : params.density === "active"
        ? event.importance === "downbeat" ? 102.2 : 101.4
        : event.importance === "downbeat"
          ? 103.2
          : event.importance === "primary"
            ? 102.2
            : 101.2;
  return [scale, scale];
}

function contrastPeak(
  params: BeatSyncStudioParams,
  event: BeatSyncEvent,
): JsonValue {
  if (params.density === "restrained") return 4;
  if (params.density === "active") return 8;
  return event.importance === "downbeat" ? 14 : 8;
}

function exposurePeak(
  params: BeatSyncStudioParams,
  event: BeatSyncEvent,
): JsonValue {
  if (params.density === "restrained") return 0.06;
  if (params.density === "active") return 0.1;
  return event.importance === "downbeat" ? 0.18 : 0.1;
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
  const beats = buildQuantizedBeatMap({
    beatTimesSeconds: analysis.beatTimesSeconds,
    primaryBeatTimesSeconds: analysis.primaryBeatTimesSeconds,
    downbeatTimesSeconds: analysis.downbeatTimesSeconds,
    frameRate: params.frameRate,
  }).filter((beat) => beat.timeSeconds < durationSeconds);
  const events = buildBeatSyncEvents(beats, {
    density: params.density,
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

  return {
    durationSeconds,
    audioDurationSeconds: analysis.durationSeconds,
    mediaDurationSeconds: durationBudget.mediaDurationSeconds,
    durationLimit,
    estimatedBpm: analysis.estimatedBpm,
    beatCount: beats.length,
    cutCount: cuts.length,
    markers,
    mediaSegments,
    cameraKeyframes: pulseKeyframes(
      events,
      "camera-impact",
      params.frameRate,
      durationSeconds,
      [100, 100],
      (event) => cameraPeak(params, event),
      true,
      3,
    ),
    lightKeyframes: pulseKeyframes(
      events,
      "light-accent",
      params.frameRate,
      durationSeconds,
      0,
      (event) => contrastPeak(params, event),
      true,
      2,
    ),
    transitionKeyframes: pulseKeyframes(
      events,
      "transition-apex",
      params.frameRate,
      durationSeconds,
      0,
      (event) => exposurePeak(params, event),
      false,
      3,
    ),
    pixelSortKeyframes: pixelSortEnvelopeKeyframes(
      analysis,
      events,
      durationSeconds,
    ),
    brandKeyframes: pulseKeyframes(
      events,
      "brand-pulse",
      params.frameRate,
      durationSeconds,
      10,
      (event) => event.importance === "downbeat" ? 26 : 20,
      false,
      2,
    ),
  };
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
    planBeatCount: plan.beatCount,
    planCutCount: plan.cutCount,
    planMarkers: plan.markers,
    planMediaSegments: plan.mediaSegments,
    planCameraKeyframes: plan.cameraKeyframes,
    planLightKeyframes: plan.lightKeyframes,
    planTransitionKeyframes: plan.transitionKeyframes,
    planPixelSortKeyframes: plan.pixelSortKeyframes,
    planBrandKeyframes: plan.brandKeyframes,
  };
}
