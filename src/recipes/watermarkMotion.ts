/**
 * The motion a username watermark travels while it protects a clip.
 *
 * Four keyframes at the corners of a rectangle is what "moving watermark"
 * usually means, and it reads exactly as badly as it sounds: the mark sprints
 * across the frame, stops dead in a corner, then sprints again. The shape below
 * is sampled from a continuous curve instead, so the mark is never travelling
 * in a straight line towards a stop, and the keyframes carry almost no ease —
 * with this many of them, a strong ease per key is what *creates* the stutter.
 *
 * Time is normalized (0…1 of the composition), so one description scales to a
 * two-second comparison and a two-minute master alike. `cycles` is what makes
 * the speed honest across those two: the console computes it from the clip's
 * real duration and the requested seconds-per-loop, so a preview moves at the
 * same rate the delivery will.
 */

export const WATERMARK_MOTIONS = [
  "Drift",
  "Orbit",
  "Figure Eight",
  "Vertical",
  "Horizontal",
  "Static",
] as const;

export type WatermarkMotion = (typeof WATERMARK_MOTIONS)[number];

export interface WatermarkPathOptions {
  motion: WatermarkMotion;
  /** How many complete loops the mark travels across the whole composition. */
  cycles: number;
  /** How much of the frame the motion spans, 0–100. */
  travel: number;
  /** Where the motion is centred, as a percentage of the frame. */
  centerXPercent: number;
  centerYPercent: number;
  samplesPerCycle?: number;
}

export interface WatermarkKeyframe {
  time: number;
  value: [number, number];
}

/** Keeps the mark inside the frame even at full travel. */
const EDGE_MARGIN = 0.05;
const MAX_SAMPLES = 600;

function clampToFrame(value: number): number {
  return Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * How many times the fastest component of a shape oscillates per loop.
 *
 * Sampling per *loop* rather than per oscillation is a trap: Drift's vertical
 * component swings three times in the time its loop takes, so a fixed count
 * gives it a third of the resolution an orbit gets — and the mark jumps.
 */
function harmonic(motion: WatermarkMotion): number {
  if (motion === "Drift") return 3;
  if (motion === "Figure Eight") return 2;
  return 1;
}

/** The unit shape each motion traces, sampled at phase `u` in turns. */
function unitOffset(motion: WatermarkMotion, u: number): [number, number] {
  const tau = Math.PI * 2;
  switch (motion) {
    case "Orbit":
      return [Math.cos(tau * u), Math.sin(tau * u)];
    case "Figure Eight":
      return [Math.sin(tau * u), Math.sin(tau * u * 2) / 2];
    case "Vertical":
      return [0, Math.sin(tau * u)];
    case "Horizontal":
      return [Math.sin(tau * u), 0];
    case "Static":
      return [0, 0];
    case "Drift":
    default:
      // A 2:3 Lissajous never retraces itself within a loop, which is what
      // makes a slow drift read as wandering rather than as a repeating path.
      return [Math.sin(tau * u * 2 + 0.7), Math.sin(tau * u * 3)];
  }
}

export function watermarkPathKeyframes(
  options: WatermarkPathOptions,
): WatermarkKeyframe[] {
  const centerX = clampToFrame(options.centerXPercent / 100);
  const centerY = clampToFrame(options.centerYPercent / 100);

  if (options.motion === "Static" || options.travel <= 0) {
    // setKeyframes requires at least two keys; two identical ones hold the mark
    // exactly where it was placed.
    const value: [number, number] = [round(centerX), round(centerY)];
    return [
      { time: 0, value },
      { time: 1, value },
    ];
  }

  const cycles = Math.max(0.05, options.cycles);
  const perOscillation = Math.max(8, options.samplesPerCycle ?? 24);
  const amplitude = (Math.min(100, Math.max(0, options.travel)) / 100) * 0.45;
  const samples = Math.min(
    MAX_SAMPLES,
    Math.max(4, Math.ceil(cycles * perOscillation * harmonic(options.motion))),
  );

  const keyframes: WatermarkKeyframe[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const time = index / samples;
    const [offsetX, offsetY] = unitOffset(options.motion, time * cycles);
    keyframes.push({
      time: round(time),
      value: [
        round(clampToFrame(centerX + offsetX * amplitude)),
        round(clampToFrame(centerY + offsetY * amplitude)),
      ],
    });
  }
  return keyframes;
}

/**
 * A slow diagonal wander, centred, at a rate that suits a typical social clip.
 * This is the value a recipe run gets when nothing overrides it.
 */
export const DEFAULT_WATERMARK_PATH = watermarkPathKeyframes({
  motion: "Drift",
  cycles: 1,
  travel: 55,
  centerXPercent: 50,
  centerYPercent: 50,
});
