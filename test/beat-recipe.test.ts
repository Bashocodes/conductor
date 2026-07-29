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
  treatment: "classic" as const,
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
    expect(plan.barCount).toBe(2.25);
    expect(plan.effectiveDensity).toBe("impact");
    expect(plan.participatingBeatCount).toBe(8);
    expect(plan.glowKeyframes).toContainEqual({ time: 0.5, value: 0.25 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1.5, value: 40 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 0, value: 21 });
    expect(plan.directionalBlurKeyframes).toContainEqual({
      time: 1,
      value: 5,
    });
    expect(plan.selectedTreatmentKeyCount).toBe(36);
    expect(plan.selectedTreatmentEasingSeconds).toBeCloseTo(0.054, 9);
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
    expect(plan.directionalBlurKeyframes).toContainEqual({
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

  it("keeps accent peaks exclusive while short clips promote every density", () => {
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
      peak: number,
    ) => keyframes
      .filter((keyframe) => Number(keyframe.value) === peak)
      .map((keyframe) => keyframe.time);
    const assertExclusive = (plan: typeof active) => {
      const glow = new Set(peakTimes(plan.glowKeyframes, 0.25));
      const pixel = new Set(peakTimes(plan.pixelSortKeyframes, 40));
      const blur = new Set(peakTimes(plan.directionalBlurKeyframes, 5));
      expect([...glow].filter((time) => pixel.has(time) || blur.has(time)))
        .toEqual([]);
      expect([...pixel].filter((time) => blur.has(time))).toEqual([]);
    };

    for (const plan of [restrained, active, impact]) {
      expect(plan.effectiveDensity).toBe("impact");
      expect(plan.participatingBeatCount).toBe(8);
      expect(peakTimes(plan.glowKeyframes, 0.25)).toEqual([0.5, 2.5]);
      expect(peakTimes(plan.pixelSortKeyframes, 40)).toEqual([1.5, 3.5]);
      expect(peakTimes(plan.directionalBlurKeyframes, 5)).toEqual([1, 2, 3, 4]);
    }
    expect(impact.glowKeyframes).toHaveLength(8);
    expect(impact.pixelSortKeyframes).toHaveLength(14);
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

  it("promotes participation by bar count without changing long-form intent", () => {
    const regularAnalysis = (durationSeconds: number): BeatAnalysis => {
      const beatTimesSeconds = Array.from(
        { length: durationSeconds * 2 },
        (_value, index) => index * 0.5,
      );
      return {
        ...analysis,
        durationSeconds,
        beatPhaseSeconds: 0,
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
              : index % 2 === 0 ? "primary" : "beat",
        })),
      };
    };
    const planFor = (durationSeconds: number) =>
      buildBeatSyncStudioPlan(
        {
          ...publicParams,
          media: ["/media/continuous.mov"],
          density: "restrained",
        },
        regularAnalysis(durationSeconds),
        {
          mediaDurationSeconds: durationSeconds,
          mediaDurationsSeconds: [durationSeconds],
        },
      );

    const short = planFor(6);
    expect(short.barCount).toBe(3);
    expect(short.effectiveDensity).toBe("impact");
    expect(short.participatingBeatCount).toBe(12);

    const medium = planFor(12);
    expect(medium.barCount).toBe(6);
    expect(medium.effectiveDensity).toBe("active");
    expect(medium.participatingBeatCount).toBe(12);

    const long = planFor(20);
    expect(long.barCount).toBe(10);
    expect(long.effectiveDensity).toBe("restrained");
    expect(long.participatingBeatCount).toBe(10);
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
    expect(plan.pixelSortKeyframes).toHaveLength(506);
    expect(plan.directionalBlurKeyframes).toHaveLength(506);
    const totalKeys =
      plan.glowKeyframes.length +
      plan.pixelSortKeyframes.length +
      plan.directionalBlurKeyframes.length;
    expect(totalKeys).toBe(1_266);
    expect(totalKeys * 0.0015).toBeCloseTo(1.899, 9);
  });

  it("builds three genuinely different selectable treatment stacks", () => {
    const treatmentPlan = (treatment: "solar" | "velocity" | "signal") =>
      buildBeatSyncStudioPlan(
        {
          ...publicParams,
          treatment,
          media: ["/media/continuous.mov"],
        },
        analysis,
        continuousDurationBudget,
      );
    const solar = treatmentPlan("solar");
    const velocity = treatmentPlan("velocity");
    const signal = treatmentPlan("signal");

    expect(solar.selectedTreatmentKeyCount).toBe(46);
    expect(solar.solarBurstKeyframes).toContainEqual({
      time: 2.5,
      value: 110,
    });
    expect(solar.solarScaleKeyframes).toContainEqual({
      time: 2.5,
      value: [118, 118],
    });

    expect(velocity.selectedTreatmentKeyCount).toBe(61);
    expect(velocity.velocityRadialBlurKeyframes).toContainEqual({
      time: 2.5,
      value: 22,
    });
    expect(velocity.velocityScaleKeyframes).toContainEqual({
      time: 2.5,
      value: [128, 128],
    });

    expect(signal.selectedTreatmentKeyCount).toBe(92);
    expect(signal.signalPixelSortKeyframes).toContainEqual({
      time: 2.5,
      value: 92,
    });
    expect(signal.signalRotationKeyframes).toContainEqual({
      time: 2.5,
      value: 6,
    });
    expect(
      signal.signalBlueExposureKeyframes.some(
        (keyframe) => Number(keyframe.value) < 0,
      ),
    ).toBe(true);
  });

  it("gates each creative treatment to its own verified AE operations", async () => {
    const expected = {
      solar: {
        effects: ["ADBE Exposure2", "ADBE Glo2", "CC Light Burst 2.5"],
        properties: ["scale", "Exposure", "Glow Intensity", "Ray Length"],
      },
      velocity: {
        effects: ["ADBE Radial Blur", "ADBE Motion Blur"],
        properties: ["scale", "position", "Amount", "Blur Length"],
      },
      signal: {
        effects: ["director-pixel-sort", "ADBE Exposure2"],
        properties: [
          "scale",
          "rotation",
          "Beat Amount",
          "Phase",
          "Red Exposure",
          "Blue Exposure",
        ],
      },
    } as const;

    for (const treatment of ["solar", "velocity", "signal"] as const) {
      const selected = {
        ...publicParams,
        treatment,
        media: ["/media/continuous.mov"],
      };
      const plan = buildBeatSyncStudioPlan(
        selected,
        analysis,
        continuousDurationBudget,
      );
      const provider = new FakeAeClientProvider();
      const directory = await mkdtemp(join(tmpdir(), `beat-${treatment}-`));
      await new RecipeEngine({
        clientProvider: provider,
        adapters: createFakeAdapterRegistry(),
        journalWriter: new JournalWriter(directory),
        createRunId: () => `beat-sync-${treatment}`,
      }).run(
        beatSyncEditRecipe,
        withBeatSyncPlanParams(selected, plan),
      );
      expect(
        provider.connection.calls
          .filter((call) => call.tool === "fake_apply_effect")
          .map((call) => call.args.effect),
      ).toEqual(expected[treatment].effects);
      expect(
        provider.connection.calls
          .filter((call) => call.tool === "fake_set_keyframes")
          .map((call) => call.args.property),
      ).toEqual(expected[treatment].properties);
      if (treatment === "solar") {
        expect(
          provider.connection.calls.find(
            (call) =>
              call.tool === "fake_apply_effect"
              && call.args.effect === "CC Light Burst 2.5",
          )?.args.settings,
        ).toEqual({
          Intensity: 100,
          "Ray Length": 0,
          Burst: 2,
          "Halo Alpha": 0,
        });
      }
    }
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
