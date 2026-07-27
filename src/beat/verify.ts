import { execFile, spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { RunJournal } from "../engine/journal.js";
import { analyzeAudioFile } from "./analyze.js";

const execFileAsync = promisify(execFile);
const SCENE_SAMPLE_WIDTH = 96;
const SCENE_SAMPLE_HEIGHT = 96;
const SCENE_FRAME_BYTES = SCENE_SAMPLE_WIDTH * SCENE_SAMPLE_HEIGHT;

export interface BeatSyncCutPlacement {
  cutFrame: number;
  actualFrame: number;
  intendedOnsetSeconds: number;
}

export interface BeatSyncFramePlacementDelta {
  cutFrame: number;
  actualFrame: number;
  intendedOnsetSeconds: number;
  actualCutTimeSeconds: number;
  deltaSeconds: number;
  absoluteDeltaSeconds: number;
  withinHalfFrame: boolean;
}

export interface BeatSyncFramePlacementReport {
  status: "verified" | "failed" | "not-applicable";
  requestedFrameRate: number;
  renderedFrameRate: number;
  frameDurationSeconds: number;
  cutCount: number;
  maxDeviationSeconds: number;
  meanDeviationSeconds: number;
  cutsWithinHalfFrame: number;
  deltas: BeatSyncFramePlacementDelta[];
}

export interface VisualCut {
  frame: number;
  difference: number;
}

export interface VisualCutDetection {
  frameCount: number;
  adaptiveThreshold: number;
  baselineMedian: number;
  baselineMad: number;
  cuts: VisualCut[];
}

export interface BeatSyncEndToEndDelta {
  visualCutFrame: number;
  visualCutTimeSeconds: number;
  visualDifference: number;
  nearestAudioOnsetSeconds: number | null;
  deltaSeconds: number | null;
  absoluteDeltaSeconds: number | null;
  withinHalfFrame: boolean;
  withinOneFrame: boolean;
}

export interface BeatSyncEndToEndReport {
  status: "verified" | "failed" | "not-applicable";
  renderedFrameRate: number;
  frameDurationSeconds: number;
  expectedVisualCutCount: number;
  detectedVisualCutCount: number;
  detectedAudioOnsetCount: number;
  visualCutAdaptiveThreshold: number;
  maxDeviationSeconds: number | null;
  meanDeviationSeconds: number | null;
  cutsWithinHalfFrame: number;
  cutsWithinOneFrame: number;
  deltas: BeatSyncEndToEndDelta[];
}

export interface BeatSyncVerificationReport {
  framePlacement: BeatSyncFramePlacementReport;
  endToEndAlignment: BeatSyncEndToEndReport;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] as number;
  return (
    ((ordered[middle - 1] as number) + (ordered[middle] as number)) /
    2
  );
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower] as number;
  const weight = position - lower;
  return (
    (ordered[lower] as number) * (1 - weight)
    + (ordered[upper] as number) * weight
  );
}

export function measureBeatSyncFramePlacement(
  cuts: BeatSyncCutPlacement[],
  requestedFrameRate: number,
  renderedFrameRate: number,
): BeatSyncFramePlacementReport {
  if (
    !Number.isFinite(requestedFrameRate)
    || requestedFrameRate <= 0
    || !Number.isFinite(renderedFrameRate)
    || renderedFrameRate <= 0
  ) {
    throw new Error("Frame-placement measurement requires positive frame rates.");
  }
  const frameDurationSeconds = 1 / renderedFrameRate;
  const deltas = cuts.map((cut) => {
    const actualCutTimeSeconds = cut.actualFrame / renderedFrameRate;
    const deltaSeconds = actualCutTimeSeconds - cut.intendedOnsetSeconds;
    const absoluteDeltaSeconds = Math.abs(deltaSeconds);
    return {
      ...cut,
      actualCutTimeSeconds: rounded(actualCutTimeSeconds),
      deltaSeconds: rounded(deltaSeconds),
      absoluteDeltaSeconds: rounded(absoluteDeltaSeconds),
      withinHalfFrame:
        absoluteDeltaSeconds <= frameDurationSeconds / 2 + Number.EPSILON,
    };
  });
  let maximum = 0;
  let total = 0;
  let withinHalfFrame = 0;
  for (const delta of deltas) {
    maximum = Math.max(maximum, delta.absoluteDeltaSeconds);
    total += delta.absoluteDeltaSeconds;
    if (delta.withinHalfFrame) withinHalfFrame += 1;
  }
  const passed =
    cuts.length > 0 && maximum <= frameDurationSeconds + Number.EPSILON;
  return {
    status:
      cuts.length === 0 ? "not-applicable" : passed ? "verified" : "failed",
    requestedFrameRate,
    renderedFrameRate,
    frameDurationSeconds: rounded(frameDurationSeconds),
    cutCount: cuts.length,
    maxDeviationSeconds: rounded(maximum),
    meanDeviationSeconds:
      cuts.length === 0 ? 0 : rounded(total / cuts.length),
    cutsWithinHalfFrame: withinHalfFrame,
    deltas,
  };
}

/**
 * Scores structure and luminance change between two decoded grayscale frames.
 * Mean-centering keeps a global exposure pulse from looking exactly like a
 * scene replacement, while the raw component still detects cuts between flat
 * images whose centred pixels are identical.
 */
export function visualFrameDifference(
  previous: Uint8Array,
  current: Uint8Array,
): number {
  if (previous.length === 0 || previous.length !== current.length) {
    throw new Error("Visual-cut frames must be non-empty and equally sized.");
  }
  let previousMean = 0;
  let currentMean = 0;
  for (let index = 0; index < previous.length; index += 1) {
    previousMean += previous[index] as number;
    currentMean += current[index] as number;
  }
  previousMean /= previous.length;
  currentMean /= current.length;

  let rawDifference = 0;
  let structuralDifference = 0;
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index] as number;
    const after = current[index] as number;
    rawDifference += Math.abs(after - before);
    structuralDifference += Math.abs(
      (after - currentMean) - (before - previousMean),
    );
  }
  const scale = previous.length * 255;
  return 0.35 * (rawDifference / scale)
    + 0.65 * (structuralDifference / scale);
}

export function detectVisualCutsFromDifferences(
  differences: number[],
  frameRate: number,
): VisualCutDetection {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error("Visual-cut detection requires a positive frame rate.");
  }
  for (const difference of differences) {
    if (!Number.isFinite(difference) || difference < 0) {
      throw new Error("Visual frame differences must be finite and non-negative.");
    }
  }
  const baselineMedian = median(differences);
  const deviations = differences.map((value) =>
    Math.abs(value - baselineMedian)
  );
  const baselineMad = median(deviations);
  const interquartileRange =
    quantile(differences, 0.75) - quantile(differences, 0.25);
  const adaptiveOffset = Math.max(
    Number.EPSILON,
    baselineMad * 8,
    interquartileRange * 2,
    baselineMedian * 3,
  );
  const adaptiveThreshold = baselineMedian + adaptiveOffset;
  const candidates: VisualCut[] = [];
  for (let index = 0; index < differences.length; index += 1) {
    const value = differences[index] as number;
    const before = index === 0 ? -Infinity : differences[index - 1] as number;
    const after =
      index === differences.length - 1
        ? -Infinity
        : differences[index + 1] as number;
    if (
      value > adaptiveThreshold
      && value >= before
      && value > after
    ) {
      // differences[0] compares decoded frame zero with frame one, so its
      // visible discontinuity begins at video frame one.
      candidates.push({ frame: index + 1, difference: rounded(value) });
    }
  }

  const minimumGapFrames = Math.max(1, Math.round(frameRate * 0.08));
  const cuts: VisualCut[] = [];
  for (const candidate of candidates) {
    const previous = cuts.at(-1);
    if (
      previous === undefined
      || candidate.frame - previous.frame >= minimumGapFrames
    ) {
      cuts.push(candidate);
    } else if (candidate.difference > previous.difference) {
      cuts[cuts.length - 1] = candidate;
    }
  }
  return {
    frameCount: differences.length + (differences.length > 0 ? 1 : 0),
    adaptiveThreshold: rounded(adaptiveThreshold),
    baselineMedian: rounded(baselineMedian),
    baselineMad: rounded(baselineMad),
    cuts,
  };
}

export function detectVisualCutsFromFrames(
  frames: Uint8Array[],
  frameRate: number,
): VisualCutDetection {
  const differences: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    differences.push(
      visualFrameDifference(
        frames[index - 1] as Uint8Array,
        frames[index] as Uint8Array,
      ),
    );
  }
  const detection = detectVisualCutsFromDifferences(differences, frameRate);
  return { ...detection, frameCount: frames.length };
}

export function ffmpegVisualFramesArgs(path: string): string[] {
  return [
    "-v",
    "error",
    "-i",
    path,
    "-an",
    "-vf",
    `scale=${SCENE_SAMPLE_WIDTH}:${SCENE_SAMPLE_HEIGHT}:flags=area,format=gray`,
    "-pix_fmt",
    "gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
}

export async function detectRenderedVisualCuts(
  path: string,
  frameRate: number,
  ffmpegPath: string,
): Promise<VisualCutDetection> {
  const child = spawn(ffmpegPath, ffmpegVisualFramesArgs(path), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const differences: number[] = [];
  let pending = Buffer.alloc(0);
  let previous: Buffer | undefined;
  let frameCount = 0;
  let errorText = "";
  child.stdout.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= SCENE_FRAME_BYTES) {
      const frame = pending.subarray(0, SCENE_FRAME_BYTES);
      pending = pending.subarray(SCENE_FRAME_BYTES);
      if (previous !== undefined) {
        differences.push(visualFrameDifference(previous, frame));
      }
      previous = Buffer.from(frame);
      frameCount += 1;
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errorText = (errorText + chunk.toString("utf8")).slice(-8_000);
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  if (exitCode !== 0) {
    throw new Error(
      `ffmpeg could not decode rendered video frames (exit ${exitCode}).`
      + (errorText === "" ? "" : ` ${errorText.trim()}`),
    );
  }
  if (pending.length !== 0) {
    throw new Error("ffmpeg returned an incomplete rendered video frame.");
  }
  const detection = detectVisualCutsFromDifferences(differences, frameRate);
  return { ...detection, frameCount };
}

export function measureBeatSyncEndToEndAlignment(
  visualDetection: VisualCutDetection,
  audioOnsetTimesSeconds: number[],
  expectedVisualCutCount: number,
  renderedFrameRate: number,
): BeatSyncEndToEndReport {
  if (
    !Number.isInteger(expectedVisualCutCount)
    || expectedVisualCutCount < 0
    || !Number.isFinite(renderedFrameRate)
    || renderedFrameRate <= 0
  ) {
    throw new Error(
      "End-to-end measurement requires a non-negative cut count and positive frame rate.",
    );
  }
  const frameDurationSeconds = 1 / renderedFrameRate;
  const deltas = visualDetection.cuts.map((cut) => {
    const visualCutTimeSeconds = cut.frame / renderedFrameRate;
    let nearest: number | undefined;
    let nearestDistance = Infinity;
    for (const onset of audioOnsetTimesSeconds) {
      const distance = Math.abs(visualCutTimeSeconds - onset);
      if (distance < nearestDistance) {
        nearest = onset;
        nearestDistance = distance;
      }
    }
    const deltaSeconds =
      nearest === undefined ? null : visualCutTimeSeconds - nearest;
    const absoluteDeltaSeconds =
      deltaSeconds === null ? null : Math.abs(deltaSeconds);
    return {
      visualCutFrame: cut.frame,
      visualCutTimeSeconds: rounded(visualCutTimeSeconds),
      visualDifference: cut.difference,
      nearestAudioOnsetSeconds:
        nearest === undefined ? null : rounded(nearest),
      deltaSeconds:
        deltaSeconds === null ? null : rounded(deltaSeconds),
      absoluteDeltaSeconds:
        absoluteDeltaSeconds === null ? null : rounded(absoluteDeltaSeconds),
      withinHalfFrame:
        absoluteDeltaSeconds !== null
        && absoluteDeltaSeconds <= frameDurationSeconds / 2 + Number.EPSILON,
      withinOneFrame:
        absoluteDeltaSeconds !== null
        && absoluteDeltaSeconds <= frameDurationSeconds + Number.EPSILON,
    };
  });
  const measured = deltas.flatMap((delta) =>
    delta.absoluteDeltaSeconds === null ? [] : [delta.absoluteDeltaSeconds]
  );
  const maximum = measured.length === 0 ? null : Math.max(...measured);
  const mean =
    measured.length === 0
      ? null
      : measured.reduce((total, value) => total + value, 0) / measured.length;
  const withinHalfFrame =
    deltas.filter((delta) => delta.withinHalfFrame).length;
  const withinOneFrame =
    deltas.filter((delta) => delta.withinOneFrame).length;
  const verified =
    expectedVisualCutCount > 0
    && visualDetection.cuts.length === expectedVisualCutCount
    && withinOneFrame === visualDetection.cuts.length;
  return {
    status:
      expectedVisualCutCount === 0
        ? "not-applicable"
        : verified
          ? "verified"
          : "failed",
    renderedFrameRate,
    frameDurationSeconds: rounded(frameDurationSeconds),
    expectedVisualCutCount,
    detectedVisualCutCount: visualDetection.cuts.length,
    detectedAudioOnsetCount: audioOnsetTimesSeconds.length,
    visualCutAdaptiveThreshold: visualDetection.adaptiveThreshold,
    maxDeviationSeconds: maximum === null ? null : rounded(maximum),
    meanDeviationSeconds: mean === null ? null : rounded(mean),
    cutsWithinHalfFrame: withinHalfFrame,
    cutsWithinOneFrame: withinOneFrame,
    deltas,
  };
}

export function ffprobeFrameRateArgs(path: string): string[] {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=avg_frame_rate",
    "-of",
    "json",
    path,
  ];
}

export function parseFrameRate(value: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match === null) throw new Error(`Invalid rendered frame rate '${value}'.`);
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const rate = numerator / denominator;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid rendered frame rate '${value}'.`);
  }
  return rate;
}

export async function probeRenderedFrameRate(
  path: string,
  ffprobePath: string,
): Promise<number> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    ffprobeFrameRateArgs(path),
    { timeout: 30_000 },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ avg_frame_rate?: unknown }>;
  };
  const value = parsed.streams?.[0]?.avg_frame_rate;
  if (typeof value !== "string") {
    throw new Error("ffprobe did not report the delivered video frame rate.");
  }
  return parseFrameRate(value);
}

export async function verifyRenderedBeatSync(options: {
  outputPath: string;
  requestedFrameRate: number;
  cuts: BeatSyncCutPlacement[];
  ffmpegPath: string;
  ffprobePath: string;
}): Promise<BeatSyncVerificationReport> {
  const renderedFrameRate = await probeRenderedFrameRate(
    options.outputPath,
    options.ffprobePath,
  );
  const framePlacement = measureBeatSyncFramePlacement(
    options.cuts,
    options.requestedFrameRate,
    renderedFrameRate,
  );
  const [audioAnalysis, visualDetection] = await Promise.all([
    analyzeAudioFile(options.outputPath, { ffmpegPath: options.ffmpegPath }),
    detectRenderedVisualCuts(
      options.outputPath,
      renderedFrameRate,
      options.ffmpegPath,
    ),
  ]);
  return {
    framePlacement,
    endToEndAlignment: measureBeatSyncEndToEndAlignment(
      visualDetection,
      audioAnalysis.beatTimesSeconds,
      options.cuts.length,
      renderedFrameRate,
    ),
  };
}

export async function recordBeatSyncVerification(
  journalPath: string,
  report: BeatSyncVerificationReport,
): Promise<void> {
  const journal = JSON.parse(
    await readFile(journalPath, "utf8"),
  ) as RunJournal;
  journal.verification = {
    ...(journal.verification ?? {}),
    beatSync: report,
  };
  const failed =
    report.framePlacement.status === "failed"
    || report.endToEndAlignment.status === "failed";
  if (failed) {
    journal.status = "failed";
    journal.error = {
      name: "BeatSyncVerificationError",
      message:
        "Rendered Beat Sync verification failed. Authored frame placement and "
        + "rendered A/V conformance are recorded separately in the journal.",
      code: "BEAT_SYNC_VERIFICATION_FAILED",
      details: report,
    };
  }
  const temporaryPath = `${journalPath}.beat-sync-${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(journal, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, journalPath);
}

export function assertBeatSyncVerification(
  report: BeatSyncVerificationReport,
): void {
  if (report.framePlacement.status === "failed") {
    const placement = report.framePlacement;
    const error = new Error(
      `Beat Sync frame placement failed: max deviation `
      + `${(placement.maxDeviationSeconds * 1_000).toFixed(3)} ms exceeds one frame `
      + `(${(placement.frameDurationSeconds * 1_000).toFixed(3)} ms).`,
    ) as Error & { code: string; details: BeatSyncVerificationReport };
    error.name = "BeatSyncVerificationError";
    error.code = "BEAT_SYNC_FRAME_PLACEMENT_FAILED";
    error.details = report;
    throw error;
  }
  if (report.endToEndAlignment.status === "failed") {
    const alignment = report.endToEndAlignment;
    const maximum =
      alignment.maxDeviationSeconds === null
        ? "unmeasurable"
        : `${(alignment.maxDeviationSeconds * 1_000).toFixed(3)} ms`;
    const error = new Error(
      "Beat Sync rendered A/V conformance failed: detected "
      + `${alignment.detectedVisualCutCount}/${alignment.expectedVisualCutCount} visual cuts; `
      + `${alignment.cutsWithinOneFrame} within one frame; max ${maximum}.`,
    ) as Error & { code: string; details: BeatSyncVerificationReport };
    error.name = "BeatSyncVerificationError";
    error.code = "BEAT_SYNC_END_TO_END_FAILED";
    error.details = report;
    throw error;
  }
}
