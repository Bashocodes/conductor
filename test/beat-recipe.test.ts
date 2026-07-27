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
  brandPulse: false,
  frameRate: 30,
  outputPath: "/renders/beat-sync.mp4",
};

describe("Beat Sync Studio recipe", () => {
  it("turns one analyzed map into markers, hierarchy-aware edits, and accents", () => {
    const plan = buildBeatSyncStudioPlan(publicParams, analysis);

    expect(plan.beatCount).toBe(8);
    expect(plan.markers).toHaveLength(8);
    expect(plan.cutCount).toBe(4);
    expect(plan.mediaSegments).toHaveLength(5);
    expect(plan.mediaSegments.slice(1).map((segment) => segment.cutFrame)).toEqual([
      15, 45, 75, 105,
    ]);
    expect(plan.cameraKeyframes.length).toBeGreaterThanOrEqual(2);
    expect(plan.lightKeyframes.length).toBeGreaterThan(2);
    expect(plan.brandKeyframes).toEqual([
      { time: 0, value: 10 },
      { time: 4.5, value: 10 },
    ]);
  });

  it("does not call an invisible boundary in one continuous video a cut", () => {
    const plan = buildBeatSyncStudioPlan(
      { ...publicParams, media: ["/media/continuous.mov"] },
      analysis,
    );

    expect(plan.cutCount).toBe(0);
    expect(plan.mediaSegments).toHaveLength(1);
    expect(plan.markers).toHaveLength(analysis.onsets.length);
  });

  it("executes as ordinary verified ToolContract data and ends in HLG delivery", async () => {
    const plan = buildBeatSyncStudioPlan(publicParams, analysis);
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
      "fake_set_keyframes",
      "fake_queue_render",
    ]);
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
