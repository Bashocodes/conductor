import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { BeatAnalysis } from "../src/beat/analyze.js";
import {
  buildBeatSyncStudioPlan,
  withBeatSyncPlanParams,
} from "../src/beat/studio.js";
import { RecipeEngine } from "../src/engine/engine.js";
import { JournalWriter, type RunJournal } from "../src/engine/journal.js";
import { beatSyncEditRecipe } from "../src/recipes/beat-sync-edit.js";
import {
  createFakeAdapterRegistry,
  FakeAeClientProvider,
} from "./helpers/fakeAe.js";

const times = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const analysis: BeatAnalysis = {
  sampleRate: 22_050,
  windowSize: 1_024,
  hopSize: 512,
  durationSeconds: 4.5,
  estimatedBpm: 120,
  beatPeriodSeconds: 0.5,
  beatPhaseSeconds: 0.5,
  beatSnapWindowSeconds: 0.0625,
  tempoConfidence: {
    level: "high",
    score: 1,
    autocorrelation: 1,
    ambiguity: 0,
    gridCoverage: 1,
    summary: "High tempo-grid confidence: 100% of grid beats have a confirming onset.",
  },
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
  primaryBeatTimesSeconds: [1.5, 3.5],
  downbeatTimesSeconds: [0.5, 2.5],
};

const publicParams = {
  audio: "/media/music.wav",
  media: ["/media/a.mov", "/media/b.png"],
  density: "active" as const,
  tempoOctave: "detected" as const,
  phaseNudge: 0,
  cuts: true,
  light: true,
  camera: true,
  pixelSort: true,
  brandPulse: false,
  frameRate: 30,
  outputPath: "/renders/beat-sync.mp4",
};
const durationBudget = {
  mediaDurationSeconds: 10,
  mediaDurationsSeconds: [5, 5],
};
const continuousDurationBudget = {
  mediaDurationSeconds: 10,
  mediaDurationsSeconds: [10],
};

describe("Beat Sync Studio recipe", () => {
  it("turns one analyzed map into markers, hierarchy-aware edits, and accents", () => {
    const plan = buildBeatSyncStudioPlan(
      publicParams,
      analysis,
      durationBudget,
    );

    expect(plan.beatCount).toBe(8);
    expect(plan.markers).toHaveLength(8);
    expect(plan.cutCount).toBe(4);
    expect(plan.mediaSegments).toHaveLength(5);
    expect(plan.mediaSegments.slice(1).map((segment) => segment.cutFrame)).toEqual([
      15, 45, 75, 105,
    ]);
    expect(plan.firstDownbeatSeconds).toBe(0.5);
    expect(plan.glowKeyframes).toContainEqual({ time: 0.5, value: 0.25 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1.5, value: 40 });
    expect(plan.directionalBlurKeyframes).toEqual([
      { time: 0, value: 0 },
      { time: 4.5, value: 0 },
    ]);
    expect(plan.brandKeyframes).toEqual([
      { time: 0, value: 10 },
      { time: 4.5, value: 10 },
    ]);
  });

  it("retains sub-hop onset time for a routed effect peak", () => {
    const sampleTime = 0.503;
    const subHopAnalysis: BeatAnalysis = {
      ...analysis,
      onsets: analysis.onsets.map((onset, index) =>
        index === 0 ? { ...onset, timeSeconds: sampleTime } : onset
      ),
      beatTimesSeconds: [sampleTime, ...analysis.beatTimesSeconds.slice(1)],
      downbeatTimesSeconds: [
        sampleTime,
        ...analysis.downbeatTimesSeconds.slice(1),
      ],
    };

    const plan = buildBeatSyncStudioPlan(
      publicParams,
      subHopAnalysis,
      durationBudget,
    );

    expect(plan.glowKeyframes).toContainEqual({
      time: sampleTime,
      value: 0.25,
    });
    expect(plan.mediaSegments[1]?.cutFrame).toBe(15);
    expect(plan.mediaSegments[1]?.timelineInSeconds).toBe(0.5);
  });

  it("uses the quantized plan hierarchy rather than onset labels for routing", () => {
    const unclassifiedOnsets: BeatAnalysis = {
      ...analysis,
      onsets: analysis.onsets.map((onset) => ({
        ...onset,
        importance: "beat",
      })),
    };

    const plan = buildBeatSyncStudioPlan(
      publicParams,
      unclassifiedOnsets,
      durationBudget,
    );

    expect(plan.glowKeyframes).toContainEqual({ time: 0.5, value: 0.25 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1.5, value: 40 });
    expect(plan.directionalBlurKeyframes).not.toContainEqual({
      time: 1,
      value: 5,
    });
  });

  it("does not call an invisible boundary in one continuous video a cut", () => {
    const plan = buildBeatSyncStudioPlan(
      { ...publicParams, media: ["/media/continuous.mov"] },
      analysis,
      continuousDurationBudget,
    );

    expect(plan.cutCount).toBe(0);
    expect(plan.mediaSegments).toHaveLength(1);
    expect(plan.markers).toHaveLength(analysis.onsets.length);
  });

  it("keeps every effect tier mutually exclusive at every density", () => {
    const oneClip = {
      ...publicParams,
      media: ["/media/continuous.mov"],
    };
    const makePlan = (density: "restrained" | "active" | "impact") =>
      buildBeatSyncStudioPlan(
        { ...oneClip, density },
        analysis,
        continuousDurationBudget,
      );
    const restrained = makePlan("restrained");
    const active = makePlan("active");
    const impact = makePlan("impact");
    const peakTimes = (
      keyframes: Array<{ time: number; value: unknown }>,
    ) => keyframes
      .filter((keyframe) => Number(keyframe.value) > 0)
      .map((keyframe) => keyframe.time);
    const assertExclusive = (plan: typeof active) => {
      const glow = new Set(peakTimes(plan.glowKeyframes));
      const pixel = new Set(peakTimes(plan.pixelSortKeyframes));
      const blur = new Set(peakTimes(plan.directionalBlurKeyframes));
      expect([...glow].filter((time) => pixel.has(time) || blur.has(time)))
        .toEqual([]);
      expect([...pixel].filter((time) => blur.has(time))).toEqual([]);
    };

    expect(peakTimes(restrained.glowKeyframes)).toEqual([0.5, 2.5]);
    expect(peakTimes(restrained.pixelSortKeyframes)).toEqual([]);
    expect(peakTimes(restrained.directionalBlurKeyframes)).toEqual([]);

    expect(peakTimes(active.glowKeyframes)).toEqual([0.5, 2.5]);
    expect(peakTimes(active.pixelSortKeyframes)).toEqual([1.5, 3.5]);
    expect(peakTimes(active.directionalBlurKeyframes)).toEqual([]);

    expect(peakTimes(impact.glowKeyframes)).toEqual([0.5, 2.5]);
    expect(peakTimes(impact.pixelSortKeyframes)).toEqual([1.5, 3.5]);
    expect(peakTimes(impact.directionalBlurKeyframes)).toEqual([1, 2, 3, 4]);
    expect(impact.glowKeyframes).toHaveLength(8);
    expect(impact.pixelSortKeyframes).toHaveLength(8);
    expect(impact.directionalBlurKeyframes).toHaveLength(14);
    expect(impact.glowKeyframes.filter((keyframe) => keyframe.value === 0.25))
      .toHaveLength(2);
    expect(impact.pixelSortKeyframes.filter((keyframe) => keyframe.value === 40))
      .toHaveLength(2);
    expect(
      impact.directionalBlurKeyframes.filter((keyframe) => keyframe.value === 5),
    ).toHaveLength(4);

    assertExclusive(restrained);
    assertExclusive(active);
    assertExclusive(impact);
  });

  it("applies tempo-octave and phase overrides to the resulting grid", () => {
    const oneClip = {
      ...publicParams,
      media: ["/media/continuous.mov"],
    };
    const half = buildBeatSyncStudioPlan(
      {
        ...oneClip,
        tempoOctave: "half",
        phaseNudge: 0.25,
      },
      analysis,
      continuousDurationBudget,
    );
    expect(half.estimatedBpm).toBe(60);
    expect(half.firstDownbeatSeconds).toBeCloseTo(23 / 30, 9);
    expect(half.beatCount).toBe(4);

    const double = buildBeatSyncStudioPlan(
      {
        ...oneClip,
        tempoOctave: "double",
        phaseNudge: 0,
      },
      analysis,
      continuousDurationBudget,
    );
    expect(double.estimatedBpm).toBe(240);
    expect(double.firstDownbeatSeconds).toBe(0.5);
    expect(double.beatCount).toBe(18);

    const nudged = buildBeatSyncStudioPlan(
      {
        ...oneClip,
        tempoOctave: "detected",
        phaseNudge: 0.25,
      },
      analysis,
      continuousDurationBudget,
    );
    expect(nudged.estimatedBpm).toBe(120);
    expect(nudged.firstDownbeatSeconds).toBeCloseTo(19 / 30, 9);
  });

  it("matches the approved 336-beat keyframe costing", () => {
    const period = 60 / 94.4;
    const beatTimesSeconds = Array.from(
      { length: 336 },
      (_value, index) => 0.282704946 + index * period,
    );
    const costAnalysis: BeatAnalysis = {
      ...analysis,
      durationSeconds: 213.76,
      estimatedBpm: 94.4,
      beatPeriodSeconds: period,
      beatPhaseSeconds: 0.282704946,
      beatSnapWindowSeconds: period / 8,
      beatTimesSeconds,
      primaryBeatTimesSeconds: beatTimesSeconds.filter(
        (_time, index) => index % 4 === 2,
      ),
      downbeatTimesSeconds: beatTimesSeconds.filter(
        (_time, index) => index % 4 === 0,
      ),
      onsets: beatTimesSeconds.map((timeSeconds, index) => ({
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
    };
    const plan = buildBeatSyncStudioPlan(
      {
        ...publicParams,
        media: ["/media/continuous.mov"],
        density: "impact",
      },
      costAnalysis,
      {
        mediaDurationSeconds: 214,
        mediaDurationsSeconds: [214],
      },
    );

    expect(plan.beatCount).toBe(336);
    expect(plan.glowKeyframes).toHaveLength(254);
    expect(plan.pixelSortKeyframes).toHaveLength(254);
    expect(plan.directionalBlurKeyframes).toHaveLength(506);
    const totalKeys =
      plan.glowKeyframes.length +
      plan.pixelSortKeyframes.length +
      plan.directionalBlurKeyframes.length;
    expect(totalKeys).toBe(1_014);
    expect(totalKeys * 0.0015).toBeCloseTo(1.521, 9);
  });

  it("executes as ordinary verified ToolContract data and ends in HLG delivery", async () => {
    const plan = buildBeatSyncStudioPlan(
      publicParams,
      analysis,
      durationBudget,
    );
    const params = withBeatSyncPlanParams(publicParams, plan);
    const provider = new FakeAeClientProvider();
    const directory = await mkdtemp(join(tmpdir(), "beat-recipe-"));
    const result = await new RecipeEngine({
      clientProvider: provider,
      adapters: createFakeAdapterRegistry(),
      journalWriter: new JournalWriter(directory),
      createRunId: () => "beat-sync-reference",
    }).run(beatSyncEditRecipe, params);
    const calls = provider.connection.calls;

    expect(calls.map((call) => call.tool)).toEqual([
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_add_markers",
      "fake_add_media_layer",
      "fake_add_media_layer",
      "fake_apply_effect",
      "fake_set_keyframes",
      "fake_apply_effect",
      "fake_set_keyframes",
      "fake_apply_effect",
      "fake_set_keyframes",
      "fake_queue_render",
    ]);
    expect(
      calls.find(
        (call) =>
          call.tool === "fake_apply_effect"
          && call.args.effect === "director-pixel-sort",
      )?.args.settings,
    ).toEqual({
      Intensity: 0,
      Phase: 100,
      "Beat Amount": 0,
      Seed: 108,
    });
    expect(
      calls.find(
        (call) =>
          call.tool === "fake_apply_effect"
          && call.args.effect === "ADBE Glo2",
      )?.args.settings,
    ).toEqual({
      "Glow Threshold": 235,
      "Glow Radius": 30,
      "Glow Intensity": 0,
    });
    expect(
      calls.find(
        (call) =>
          call.tool === "fake_apply_effect"
          && call.args.effect === "ADBE Motion Blur",
      )?.args.settings,
    ).toEqual({
      Direction: 90,
      "Blur Length": 0,
    });
    expect(
      calls.find(
        (call) =>
          call.tool === "fake_set_keyframes"
          && call.args.property === "Beat Amount",
      )?.args.keyframes,
    ).toEqual(plan.pixelSortKeyframes);
    expect(calls.find((call) => call.tool === "fake_add_markers")?.args.markers)
      .toHaveLength(8);
    expect(calls.at(-1)?.args).toMatchObject({
      outputModuleTemplate: "IG HDR HLG ProRes",
      postProcess: "hevc-hlg",
    });

    const journal = JSON.parse(
      await readFile(result.journalPath, "utf8"),
    ) as RunJournal;
    expect(journal.status).toBe("completed");
    expect(journal.steps.at(-1)).toMatchObject({
      operation: "queueRender",
      status: "succeeded",
    });
  });
});
