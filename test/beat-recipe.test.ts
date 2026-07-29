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
  cuts: true,
  transitions: true,
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
    expect(plan.cameraKeyframes.length).toBeGreaterThanOrEqual(2);
    // Cut events already supply the visual change in a multi-clip bin, so
    // light/camera accents do not stack on top of them.
    expect(plan.lightKeyframes).toEqual([
      { time: 0, value: 0 },
      { time: 4.5, value: 0 },
    ]);
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 0.5, value: 100 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1, value: 30 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1.5, value: 60 });
    expect(plan.brandKeyframes).toEqual([
      { time: 0, value: 10 },
      { time: 4.5, value: 10 },
    ]);
  });

  it("retains sub-hop onset time for the continuous Beat Amount curve", () => {
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

    expect(plan.pixelSortKeyframes).toContainEqual({
      time: sampleTime,
      value: 100,
    });
    expect(plan.mediaSegments[1]?.cutFrame).toBe(15);
    expect(plan.mediaSegments[1]?.timelineInSeconds).toBe(0.5);
  });

  it("uses the quantized plan hierarchy for Pixel Sort burst size", () => {
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

    expect(plan.pixelSortKeyframes).toContainEqual({ time: 0.5, value: 100 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1, value: 30 });
    expect(plan.pixelSortKeyframes).toContainEqual({ time: 1.5, value: 60 });
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

  it("makes restrained, active, and impact genuinely different", () => {
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
    const scalePeaks = (plan: typeof active) =>
      plan.cameraKeyframes.filter(
        (keyframe) =>
          Array.isArray(keyframe.value) &&
          Number(keyframe.value[0]) > 100,
      );
    const numericPeaks = (
      keyframes: Array<{ time: number; value: unknown }>,
    ) => keyframes.filter((keyframe) => Number(keyframe.value) > 0);

    expect(scalePeaks(restrained)).toHaveLength(2);
    expect(scalePeaks(active)).toHaveLength(4);
    expect(scalePeaks(impact)).toHaveLength(8);
    expect(scalePeaks(active).map((keyframe) => keyframe.value)).toContainEqual([
      101.4,
      101.4,
    ]);
    expect(scalePeaks(active).map((keyframe) => keyframe.value)).toContainEqual([
      102.2,
      102.2,
    ]);
    expect(numericPeaks(restrained.lightKeyframes).map((keyframe) => keyframe.value))
      .toEqual([4, 4]);
    expect(numericPeaks(active.lightKeyframes).map((keyframe) => keyframe.value))
      .toEqual([8, 8]);
    expect(Math.max(
      ...numericPeaks(impact.lightKeyframes).map((keyframe) =>
        Number(keyframe.value)
      ),
    )).toBe(14);
    expect(Math.max(
      ...numericPeaks(restrained.transitionKeyframes).map((keyframe) =>
        Number(keyframe.value)
      ),
    )).toBe(0.06);
    expect(Math.max(
      ...numericPeaks(active.transitionKeyframes).map((keyframe) =>
        Number(keyframe.value)
      ),
    )).toBe(0.1);
    expect(Math.max(
      ...numericPeaks(impact.transitionKeyframes).map((keyframe) =>
        Number(keyframe.value)
      ),
    )).toBe(0.18);
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
