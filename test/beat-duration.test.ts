import { describe, expect, it, vi } from "vitest";

import type { BeatAnalysis } from "../src/beat/analyze.js";
import { ffprobeDurationArgs } from "../src/beat/verify.js";
import { beatSyncEditRecipe } from "../src/recipes/beat-sync-edit.js";
import {
  beatSyncStillImageHoldSeconds,
  deriveBeatSyncMediaDuration,
  prepareRecipeRun,
} from "../src/recipes/index.js";

function analysisFor(
  durationSeconds: number,
  estimatedBpm = 120,
): BeatAnalysis {
  const times = Array.from(
    { length: Math.floor(durationSeconds * 2) },
    (_value, index) => 0.5 + index * 0.5,
  );
  return {
    sampleRate: 22_050,
    windowSize: 1_024,
    hopSize: 512,
    durationSeconds,
    estimatedBpm,
    onsets: times.map((timeSeconds, index) => ({
      timeSeconds,
      envelopeFrame: Math.round((timeSeconds * 22_050) / 512),
      strength: 1,
      importance:
        index % 4 === 0
          ? "downbeat"
          : index % 2 === 0
            ? "primary"
            : "beat",
    })),
    beatTimesSeconds: times,
    primaryBeatTimesSeconds: times.filter((_time, index) => index % 4 === 2),
    downbeatTimesSeconds: times.filter((_time, index) => index % 4 === 0),
  };
}

const params = {
  audio: "/media/score.mp3",
  media: ["/media/short.mov"],
  density: "active",
  cuts: true,
  transitions: true,
  light: true,
  camera: true,
  pixelSort: true,
  brandPulse: true,
  frameRate: 30,
  outputPath: "/renders/beat-sync.mp4",
};

describe("Beat Sync media-governed duration", () => {
  it("uses the shorter media duration and drops every event family past it", async () => {
    const analyzeAudio = vi.fn(async () => analysisFor(213.759979, 94.4));
    const probeMediaDuration = vi.fn(async () => 8.057007);
    const prepared = await prepareRecipeRun(beatSyncEditRecipe, params, {
      analyzeAudio,
      probeMediaDuration,
    });

    expect(analyzeAudio).toHaveBeenCalledWith("/media/score.mp3");
    expect(probeMediaDuration).toHaveBeenCalledWith("/media/short.mov");
    expect(prepared.params.planAudioDurationSeconds).toBe(213.759979);
    expect(prepared.params.planMediaDurationSeconds).toBe(8.057007);
    expect(prepared.params.planDurationLimit).toBe("media");
    expect(prepared.params.planDurationSeconds).toBe(241 / 30);

    const duration = prepared.params.planDurationSeconds as number;
    const markers = prepared.params.planMarkers as Array<{ timeSeconds: number }>;
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((marker) => marker.timeSeconds < duration)).toBe(true);
    for (const name of [
      "planCameraKeyframes",
      "planLightKeyframes",
      "planTransitionKeyframes",
      "planPixelSortKeyframes",
      "planBrandKeyframes",
    ]) {
      const keyframes = prepared.params[name] as Array<{ time: number }>;
      expect(
        keyframes.every((keyframe) => keyframe.time <= duration),
        `${name} must end with the media-governed edit`,
      ).toBe(true);
    }
  });

  it("ends with shorter audio instead of delivering a silent tail", async () => {
    const prepared = await prepareRecipeRun(beatSyncEditRecipe, params, {
      analyzeAudio: async () => analysisFor(4.5),
      probeMediaDuration: async () => 20,
    });

    expect(prepared.params.planDurationSeconds).toBe(4.5);
    expect(prepared.params.planDurationLimit).toBe("audio");
  });

  it("sums timed clips and gives each still image one four-beat hold", async () => {
    const analysis = analysisFor(20, 120);
    const probe = vi.fn(async (path: string) =>
      path.endsWith(".png") ? null : 2.25
    );
    const result = await deriveBeatSyncMediaDuration(
      ["/media/a.mov", "/media/b.png", "/media/c.mov"],
      analysis,
      probe,
    );

    expect(beatSyncStillImageHoldSeconds(analysis)).toBe(2);
    expect(result).toEqual({
      totalDurationSeconds: 6.5,
      imageHoldSeconds: 2,
      mediaDurationsSeconds: [2.25, 2, 2.25],
    });
  });

  it("covers a sparse-cut bin in order without outliving any source", async () => {
    const prepared = await prepareRecipeRun(
      beatSyncEditRecipe,
      {
        ...params,
        media: ["/media/a.mov", "/media/b.mov"],
        cuts: false,
      },
      {
        analyzeAudio: async () => analysisFor(10),
        probeMediaDuration: async (path) =>
          path.endsWith("a.mov") ? 1 : 2,
      },
    );
    const segments = prepared.params.planMediaSegments as Array<{
      path: string;
      timelineInSeconds: number;
      timelineOutSeconds: number;
    }>;

    expect(prepared.params.planDurationSeconds).toBe(3);
    expect(segments).toEqual([
      {
        path: "/media/a.mov",
        name: "Beat Sync Shot 001",
        timelineInSeconds: 0,
        timelineOutSeconds: 1,
        sourceInSeconds: 0,
      },
      {
        path: "/media/b.mov",
        name: "Beat Sync Shot 002",
        timelineInSeconds: 1,
        timelineOutSeconds: 3,
        sourceInSeconds: 0,
      },
    ]);
  });

  it("refuses an empty bin or any unaccounted timed media", async () => {
    await expect(
      deriveBeatSyncMediaDuration([], analysisFor(10), async () => 1),
    ).rejects.toThrow("at least one media file");
    await expect(
      deriveBeatSyncMediaDuration(
        ["/media/broken.mov"],
        analysisFor(10),
        async () => {
          throw new Error("probe failed");
        },
      ),
    ).rejects.toThrow("could not determine the duration");
    await expect(
      deriveBeatSyncMediaDuration(
        ["/media/no-duration.mov"],
        analysisFor(10),
        async () => null,
      ),
    ).rejects.toThrow("ffprobe reported no duration");
  });

  it("passes media paths to ffprobe as an argument, never a shell string", () => {
    const path = "/media/a file with punctuation;still-safe.mov";
    expect(ffprobeDurationArgs(path)).toEqual([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      path,
    ]);
  });
});
