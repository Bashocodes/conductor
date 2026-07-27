import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertBeatSyncAlignment,
  ffprobeFrameRateArgs,
  measureBeatSyncAlignment,
  parseFrameRate,
  recordBeatSyncAlignment,
} from "../src/beat/verify.js";

describe("post-render beat-sync alignment", () => {
  it("reports every delta and the requested aggregate evidence", () => {
    const report = measureBeatSyncAlignment(
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
    expect(report.deltas).toHaveLength(2);
    expect(() => assertBeatSyncAlignment(report)).not.toThrow();
  });

  it("fails loudly when delivered timing drifts beyond one frame", () => {
    const report = measureBeatSyncAlignment(
      [
        { cutFrame: 90, actualFrame: 92, intendedOnsetSeconds: 3 },
      ],
      30,
      30,
    );
    expect(report.status).toBe("failed");
    expect(() => assertBeatSyncAlignment(report)).toThrow(
      "Beat-sync verification failed",
    );
  });

  it("writes verified numbers into the run journal and marks drift failed", async () => {
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
    const report = measureBeatSyncAlignment(
      [{ cutFrame: 30, actualFrame: 32, intendedOnsetSeconds: 1 }],
      30,
      30,
    );
    await recordBeatSyncAlignment(path, report);

    const journal = JSON.parse(await readFile(path, "utf8")) as {
      status: string;
      error?: { code?: string };
      verification?: { beatSyncAlignment?: unknown };
    };
    expect(journal.status).toBe("failed");
    expect(journal.error?.code).toBe("BEAT_SYNC_ALIGNMENT_FAILED");
    expect(journal.verification?.beatSyncAlignment).toEqual(report);
  });

  it("parses the exact ffprobe rational instead of rounding a nominal rate", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97002997);
    expect(ffprobeFrameRateArgs("/renders/edit.mp4")).toContain(
      "stream=avg_frame_rate",
    );
  });
});
