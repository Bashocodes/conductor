import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertBeatSyncVerification,
  detectVisualCutsFromDifferences,
  ffmpegVisualFramesArgs,
  ffprobeFrameRateArgs,
  measureBeatSyncEndToEndAlignment,
  measureBeatSyncFramePlacement,
  parseFrameRate,
  recordBeatSyncVerification,
  type BeatSyncVerificationReport,
} from "../src/beat/verify.js";

describe("post-render Beat Sync verification", () => {
  it("labels frame placement as timeline evidence, not musical proof", () => {
    const report = measureBeatSyncFramePlacement(
      [
        { cutFrame: 15, actualFrame: 15, intendedOnsetSeconds: 0.498 },
        { cutFrame: 30, actualFrame: 30, intendedOnsetSeconds: 1.006 },
      ],
      30,
      30,
    );

    expect(report).toMatchObject({
      status: "verified",
      cutCount: 2,
      cutsWithinHalfFrame: 2,
      maxDeviationSeconds: 0.006,
      meanDeviationSeconds: 0.004,
    });
  });

  it("finds independently visible cuts above an adaptive scene threshold", () => {
    const detection = detectVisualCutsFromDifferences(
      [0.01, 0.012, 0.009, 0.42, 0.011, 0.01, 0.38, 0.009],
      30,
    );

    expect(detection.adaptiveThreshold).toBeGreaterThan(0.012);
    expect(detection.adaptiveThreshold).toBeLessThan(0.38);
    expect(detection.cuts.map((cut) => cut.frame)).toEqual([4, 7]);
  });

  it("compares independently detected video cuts with rendered-audio onsets", () => {
    const report = measureBeatSyncEndToEndAlignment(
      {
        frameCount: 60,
        adaptiveThreshold: 0.08,
        baselineMedian: 0.01,
        baselineMad: 0.001,
        cuts: [
          { frame: 15, difference: 0.4 },
          { frame: 30, difference: 0.45 },
        ],
      },
      [0.498, 1.006, 1.5],
      2,
      30,
    );

    expect(report).toMatchObject({
      status: "verified",
      expectedVisualCutCount: 2,
      detectedVisualCutCount: 2,
      detectedAudioOnsetCount: 3,
      cutsWithinHalfFrame: 2,
      cutsWithinOneFrame: 2,
      maxDeviationSeconds: 0.006,
      meanDeviationSeconds: 0.004,
    });
  });

  it("fails end to end when rendered scene changes miss musical events", () => {
    const framePlacement = measureBeatSyncFramePlacement(
      [{ cutFrame: 30, actualFrame: 30, intendedOnsetSeconds: 1 }],
      30,
      30,
    );
    const endToEndAlignment = measureBeatSyncEndToEndAlignment(
      {
        frameCount: 90,
        adaptiveThreshold: 0.08,
        baselineMedian: 0.01,
        baselineMad: 0.001,
        cuts: [{ frame: 33, difference: 0.4 }],
      },
      [1],
      1,
      30,
    );
    const report = { framePlacement, endToEndAlignment };

    expect(framePlacement.status).toBe("verified");
    expect(endToEndAlignment.status).toBe("failed");
    expect(() => assertBeatSyncVerification(report)).toThrow(
      "end-to-end alignment failed",
    );
  });

  it("writes the two reports separately and marks independent failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "beat-journal-"));
    const path = join(directory, "run.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        runId: "run",
        recipeId: "beat-sync-edit",
        recipeTitle: "Beat Sync Studio",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        params: {},
        steps: [],
      }),
    );
    const report: BeatSyncVerificationReport = {
      framePlacement: measureBeatSyncFramePlacement(
        [{ cutFrame: 30, actualFrame: 30, intendedOnsetSeconds: 1 }],
        30,
        30,
      ),
      endToEndAlignment: measureBeatSyncEndToEndAlignment(
        {
          frameCount: 90,
          adaptiveThreshold: 0.08,
          baselineMedian: 0.01,
          baselineMad: 0.001,
          cuts: [],
        },
        [1],
        1,
        30,
      ),
    };
    await recordBeatSyncVerification(path, report);

    const journal = JSON.parse(await readFile(path, "utf8")) as {
      status: string;
      error?: { code?: string };
      verification?: { beatSync?: unknown };
    };
    expect(journal.status).toBe("failed");
    expect(journal.error?.code).toBe("BEAT_SYNC_VERIFICATION_FAILED");
    expect(journal.verification?.beatSync).toEqual(report);
  });

  it("decodes scene samples and parses exact delivered frame rates", () => {
    expect(ffmpegVisualFramesArgs("/renders/edit.mp4")).toContain(
      "scale=96:96:flags=area,format=gray",
    );
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97002997);
    expect(ffprobeFrameRateArgs("/renders/edit.mp4")).toContain(
      "stream=avg_frame_rate",
    );
  });
});
