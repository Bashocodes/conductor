export type BeatImportance = "beat" | "primary" | "downbeat";

export interface QuantizedBeat {
  frame: number;
  timeSeconds: number;
  importance: BeatImportance;
}

export interface BeatAnalysisInput {
  beatTimesSeconds: number[];
  primaryBeatTimesSeconds?: number[];
  downbeatTimesSeconds?: number[];
  frameRate: number;
}

function quantizedFrame(timeSeconds: number, frameRate: number): number {
  return Math.round(timeSeconds * frameRate);
}

function validatedTimes(times: number[], label: string): number[] {
  for (const time of times) {
    if (!Number.isFinite(time) || time < 0) {
      throw new Error(`${label} must contain finite, non-negative times.`);
    }
  }
  return times;
}

/**
 * Converts floating-point detector output into the one grid an edit can obey:
 * source frames. Downbeats outrank primary beats, which outrank subdivisions
 * when two detectors land on the same frame.
 */
export function buildQuantizedBeatMap(
  input: BeatAnalysisInput,
): QuantizedBeat[] {
  if (!Number.isFinite(input.frameRate) || input.frameRate <= 0) {
    throw new Error("frameRate must be a finite positive number.");
  }

  const importance = new Map<number, BeatImportance>();
  const add = (times: number[], value: BeatImportance) => {
    for (const time of validatedTimes(times, value)) {
      const frame = quantizedFrame(time, input.frameRate);
      const existing = importance.get(frame);
      if (
        existing === undefined ||
        (value === "primary" && existing === "beat") ||
        value === "downbeat"
      ) {
        importance.set(frame, value);
      }
    }
  };

  add(input.beatTimesSeconds, "beat");
  add(input.primaryBeatTimesSeconds ?? [], "primary");
  add(input.downbeatTimesSeconds ?? [], "downbeat");

  return [...importance.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, value]) => ({
      frame,
      timeSeconds: frame / input.frameRate,
      importance: value,
    }));
}

export interface BeatSyncEvent {
  frame: number;
  timeSeconds: number;
  importance: BeatImportance;
  targets: Array<
    "cut" | "transition-apex" | "light-accent" | "camera-impact" | "brand-pulse"
  >;
}

export type BeatSyncDensity = "restrained" | "active" | "impact";
export type BeatSyncEventFamily =
  | "cuts"
  | "transitions"
  | "light"
  | "camera"
  | "brand-pulse";

export interface BeatSyncEventOptions {
  brandPulse?: boolean;
  density?: BeatSyncDensity;
  allowedEventFamilies?: BeatSyncEventFamily[];
}

/**
 * Defines the edit contract before any AE work begins. Strong beats carry cuts
 * and transition peaks; ordinary beats carry restrained light/camera accents.
 * Branding pulses are opt-in because a brand protection mark should
 * normally remain subtle rather than competing with the footage.
 */
export function buildBeatSyncEvents(
  beats: QuantizedBeat[],
  options: BeatSyncEventOptions = {},
): BeatSyncEvent[] {
  return beats.map((beat) => {
    let targets: BeatSyncEvent["targets"];
    if (options.density === "restrained") {
      targets =
        beat.importance === "downbeat"
          ? ["cut", "transition-apex", "light-accent"]
          : beat.importance === "primary"
            ? ["light-accent"]
            : [];
    } else if (options.density === "active") {
      targets =
        beat.importance === "beat"
          ? ["light-accent", "camera-impact"]
          : ["cut", "transition-apex", "light-accent"];
    } else {
      // `impact` and the legacy no-option call preserve the original hierarchy:
      // strong beats cut; ordinary beats receive light/camera accents only.
      targets =
        beat.importance === "beat"
          ? ["light-accent", "camera-impact"]
          : ["cut", "transition-apex", "light-accent"];
    }
    if (
      options.density === "impact" &&
      beat.importance !== "beat" &&
      !targets.includes("camera-impact")
    ) {
      targets.push("camera-impact");
    }
    if (options.brandPulse === true && beat.importance !== "beat") {
      targets.push("brand-pulse");
    }

    const allowed = options.allowedEventFamilies;
    const filtered =
      allowed === undefined
        ? targets
        : targets.filter((target) => {
            const family: BeatSyncEventFamily =
              target === "cut"
                ? "cuts"
                : target === "transition-apex"
                  ? "transitions"
                  : target === "light-accent"
                    ? "light"
                    : target === "camera-impact"
                      ? "camera"
                      : "brand-pulse";
            return allowed.includes(family);
          });
    return { ...beat, targets: filtered };
  });
}
