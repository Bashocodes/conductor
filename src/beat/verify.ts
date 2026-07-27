import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { RunJournal } from "../engine/journal.js";

const execFileAsync = promisify(execFile);

export interface BeatSyncCutPlacement {
  cutFrame: number;
  actualFrame: number;
  intendedOnsetSeconds: number;
}

export interface BeatSyncCutDelta {
  cutFrame: number;
  actualFrame: number;
  intendedOnsetSeconds: number;
  actualCutTimeSeconds: number;
  deltaSeconds: number;
  absoluteDeltaSeconds: number;
  withinHalfFrame: boolean;
}

export interface BeatSyncAlignmentReport {
  status: "verified" | "failed" | "not-applicable";
  requestedFrameRate: number;
  renderedFrameRate: number;
  frameDurationSeconds: number;
  cutCount: number;
  maxDeviationSeconds: number;
  meanDeviationSeconds: number;
  cutsWithinHalfFrame: number;
  deltas: BeatSyncCutDelta[];
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

export function measureBeatSyncAlignment(
  cuts: BeatSyncCutPlacement[],
  requestedFrameRate: number,
  renderedFrameRate: number,
): BeatSyncAlignmentReport {
  if (
    !Number.isFinite(requestedFrameRate) ||
    requestedFrameRate <= 0 ||
    !Number.isFinite(renderedFrameRate) ||
    renderedFrameRate <= 0
  ) {
    throw new Error("Alignment measurement requires positive frame rates.");
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

export async function recordBeatSyncAlignment(
  journalPath: string,
  report: BeatSyncAlignmentReport,
): Promise<void> {
  const journal = JSON.parse(
    await readFile(journalPath, "utf8"),
  ) as RunJournal;
  journal.verification = {
    ...(journal.verification ?? {}),
    beatSyncAlignment: report,
  };
  if (report.status === "failed") {
    journal.status = "failed";
    journal.error = {
      name: "BeatSyncAlignmentError",
      message:
        `Rendered beat-sync drift reached ${(report.maxDeviationSeconds * 1_000).toFixed(3)} ms, `
        + `exceeding one ${(report.frameDurationSeconds * 1_000).toFixed(3)} ms frame.`,
      code: "BEAT_SYNC_ALIGNMENT_FAILED",
      details: report,
    };
  }
  const temporaryPath = `${journalPath}.alignment-${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(journal, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, journalPath);
}

export function assertBeatSyncAlignment(
  report: BeatSyncAlignmentReport,
): void {
  if (report.status === "failed") {
    const error = new Error(
      `Beat-sync verification failed: max deviation `
        + `${(report.maxDeviationSeconds * 1_000).toFixed(3)} ms exceeds one frame `
        + `(${(report.frameDurationSeconds * 1_000).toFixed(3)} ms).`,
    ) as Error & { code: string; details: BeatSyncAlignmentReport };
    error.name = "BeatSyncAlignmentError";
    error.code = "BEAT_SYNC_ALIGNMENT_FAILED";
    error.details = report;
    throw error;
  }
}
