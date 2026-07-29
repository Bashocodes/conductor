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
    | "cut"
    | "glow-accent"
    | "pixel-sort-accent"
    | "directional-blur-accent"
    | "brand-pulse"
  >;
}

export type BeatSyncDensity = "restrained" | "active" | "impact";
export type BeatSyncEventFamily =
  | "cuts"
  | "glow"
  | "pixel-sort"
  | "directional-blur"
  | "brand-pulse";

export interface BeatSyncEventOptions {
  brandPulse?: boolean;
  density?: BeatSyncDensity;
  allowedEventFamilies?: BeatSyncEventFamily[];
}

/**
 * Defines the edit contract before any AE work begins.
 *
 * The three visual effect families are deliberately tier-exclusive:
 * downbeats bloom, primary-only beats pixel-sort, and ordinary beats receive
 * directional blur. Density changes which lower tiers participate, never
 * which effect represents a tier. Branding remains an independent opt-in
 * protection layer.
 */
export function buildBeatSyncEvents(
  beats: QuantizedBeat[],
  options: BeatSyncEventOptions = {},
): BeatSyncEvent[] {
  return beats.map((beat) => {
    const density = options.density ?? "impact";
    const targets: BeatSyncEvent["targets"] = [];
    const strongEnoughToCut =
      beat.importance === "downbeat" ||
      (density !== "restrained" && beat.importance === "primary");
    if (strongEnoughToCut) targets.push("cut");

    if (beat.importance === "downbeat") {
      targets.push("glow-accent");
    } else if (
      beat.importance === "primary" &&
      density !== "restrained"
    ) {
      targets.push("pixel-sort-accent");
    } else if (
      beat.importance === "beat" &&
      density === "impact"
    ) {
      targets.push("directional-blur-accent");
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
                : target === "glow-accent"
                  ? "glow"
                  : target === "pixel-sort-accent"
                    ? "pixel-sort"
                    : target === "directional-blur-accent"
                      ? "directional-blur"
                      : "brand-pulse";
            return allowed.includes(family);
          });
    return { ...beat, targets: filtered };
  });
}
