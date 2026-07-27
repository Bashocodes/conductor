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
  estimatedBpm: number | null;
  beatCount: number;
  cutCount: number;
  markers: BeatSyncMarker[];
  mediaSegments: BeatSyncMediaSegment[];
  cameraKeyframes: Array<{ time: number; value: JsonValue }>;
  lightKeyframes: Array<{ time: number; value: JsonValue }>;
  transitionKeyframes: Array<{ time: number; value: JsonValue }>;
  brandKeyframes: Array<{ time: number; value: JsonValue }>;
}

function nearestOnsetTime(
  analysis: BeatAnalysis,
  event: BeatSyncEvent,
): number {
  let nearest = analysis.onsets[0]?.timeSeconds ?? event.timeSeconds;
  let distance = Math.abs(nearest - event.timeSeconds);
  for (let index = 1; index < analysis.onsets.length; index += 1) {
    const time = analysis.onsets[index]?.timeSeconds;
    if (time === undefined) continue;
    const candidateDistance = Math.abs(time - event.timeSeconds);
    if (candidateDistance < distance) {
      nearest = time;
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
  peakValue: JsonValue,
  onlyNonCuts: boolean,
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
    values.set(event.frame, peakValue);
    values.set(Math.min(finalFrame, event.frame + 1), baseValue);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, value]) => ({ time: frame / frameRate, value }));
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

export function buildBeatSyncStudioPlan(
  params: BeatSyncStudioParams,
  analysis: BeatAnalysis,
): PreparedBeatSyncPlan {
  if (params.media.length === 0) {
    throw new Error("Beat Sync Studio requires at least one media file.");
  }
  if (analysis.onsets.length === 0) {
    throw new Error(
      "Beat analysis found no usable onsets; refusing to build an unverified beat-sync edit.",
    );
  }

  const beats = buildQuantizedBeatMap({
    beatTimesSeconds: analysis.beatTimesSeconds,
    primaryBeatTimesSeconds: analysis.primaryBeatTimesSeconds,
    downbeatTimesSeconds: analysis.downbeatTimesSeconds,
    frameRate: params.frameRate,
  });
  const events = buildBeatSyncEvents(beats, {
    density: params.density,
    brandPulse: params.brandPulse,
    allowedEventFamilies: enabledFamilies(params),
  });
  const durationSeconds =
    Math.max(1, Math.floor(analysis.durationSeconds * params.frameRate)) /
    params.frameRate;
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
  const boundaries = [
    { frame: 0, timeSeconds: 0 },
    ...cuts.map(({ event }) => ({
      frame: event.frame,
      timeSeconds: event.timeSeconds,
    })),
  ];
  const mediaSegments: BeatSyncMediaSegment[] = boundaries.map(
    (boundary, index) => {
      const next = boundaries[index + 1];
      const path = params.media[index % params.media.length] as string;
      const cut = index === 0 ? undefined : cuts[index - 1];
      return {
        path,
        name: `Beat Sync Shot ${String(index + 1).padStart(3, "0")}`,
        timelineInSeconds: boundary.timeSeconds,
        timelineOutSeconds: next?.timeSeconds ?? durationSeconds,
        sourceInSeconds:
          params.media.length === 1 ? boundary.timeSeconds : 0,
        ...(cut === undefined
          ? {}
          : {
              cutFrame: boundary.frame,
              intendedOnsetSeconds: cut.intendedOnsetSeconds,
            }),
      };
    },
  );

  return {
    durationSeconds,
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
      [103, 103],
      true,
    ),
    lightKeyframes: pulseKeyframes(
      events,
      "light-accent",
      params.frameRate,
      durationSeconds,
      0,
      8,
      true,
    ),
    transitionKeyframes: pulseKeyframes(
      events,
      "transition-apex",
      params.frameRate,
      durationSeconds,
      0,
      0.18,
      false,
    ),
    brandKeyframes: pulseKeyframes(
      events,
      "brand-pulse",
      params.frameRate,
      durationSeconds,
      10,
      24,
      false,
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
    planEstimatedBpm: plan.estimatedBpm ?? 0,
    planBeatCount: plan.beatCount,
    planCutCount: plan.cutCount,
    planMarkers: plan.markers,
    planMediaSegments: plan.mediaSegments,
    planCameraKeyframes: plan.cameraKeyframes,
    planLightKeyframes: plan.lightKeyframes,
    planTransitionKeyframes: plan.transitionKeyframes,
    planBrandKeyframes: plan.brandKeyframes,
  };
}
