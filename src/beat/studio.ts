import type { JsonValue } from "../schema/json.js";
import type {
  BeatAnalysis,
  BeatTempoConfidence,
} from "./analyze.js";
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
  beatCount: number;
  cutCount: number;
  markers: BeatSyncMarker[];
  mediaSegments: BeatSyncMediaSegment[];
  glowKeyframes: Array<{ time: number; value: JsonValue }>;
  pixelSortKeyframes: Array<{ time: number; value: JsonValue }>;
  directionalBlurKeyframes: Array<{ time: number; value: JsonValue }>;
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
  peakValue: JsonValue,
  releaseFrames = 2,
): Array<{ time: number; value: JsonValue }> {
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
    values.set(roundedTime(peakTime), peakValue);
    values.set(roundedTime(
      Math.min(durationSeconds, peakTime + releaseFrames * frameDuration),
    ), baseValue);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time, value }));
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
  if (params.light) families.push("glow");
  if (params.pixelSort) families.push("pixel-sort");
  if (params.camera) families.push("directional-blur");
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
    estimatedBpm: adjustedGrid.estimatedBpm,
    firstDownbeatSeconds:
      beats.find((beat) => beat.importance === "downbeat")?.timeSeconds ?? null,
    tempoConfidence: analysis.tempoConfidence,
    beatCount: beats.length,
    cutCount: cuts.length,
    markers,
    mediaSegments,
    glowKeyframes: effectPulseKeyframes(
      analysis,
      events,
      "glow-accent",
      params.frameRate,
      durationSeconds,
      0,
      0.25,
      3,
    ),
    pixelSortKeyframes: effectPulseKeyframes(
      analysis,
      events,
      "pixel-sort-accent",
      params.frameRate,
      durationSeconds,
      0,
      40,
      2,
    ),
    directionalBlurKeyframes: effectPulseKeyframes(
      analysis,
      events,
      "directional-blur-accent",
      params.frameRate,
      durationSeconds,
      0,
      5,
      2,
    ),
    brandKeyframes: effectPulseKeyframes(
      analysis,
      events,
      "brand-pulse",
      params.frameRate,
      durationSeconds,
      10,
      20,
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
    planFirstDownbeatSeconds: plan.firstDownbeatSeconds ?? 0,
    planTempoConfidence: plan.tempoConfidence,
    planBeatCount: plan.beatCount,
    planCutCount: plan.cutCount,
    planMarkers: plan.markers,
    planMediaSegments: plan.mediaSegments,
    planGlowKeyframes: plan.glowKeyframes,
    planPixelSortKeyframes: plan.pixelSortKeyframes,
    planDirectionalBlurKeyframes: plan.directionalBlurKeyframes,
    planBrandKeyframes: plan.brandKeyframes,
  };
}
