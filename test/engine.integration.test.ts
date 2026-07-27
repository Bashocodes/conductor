import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RecipeEngine } from "../src/engine/engine.js";
import { JournalWriter, type RunJournal } from "../src/engine/journal.js";
import {
  cinematicLookLabRecipe,
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
} from "../src/recipes/index.js";
import { watermarkPathKeyframes } from "../src/recipes/watermarkMotion.js";
import type { Recipe } from "../src/schema/recipe.js";
import {
  createFakeAdapterRegistry,
  FakeAeClientProvider,
} from "./helpers/fakeAe.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

interface ExecutionCase {
  name: string;
  recipe: Recipe;
  params: Record<string, unknown>;
  expectedTools: string[];
}

const executionCases: ExecutionCase[] = [
  {
    name: "title-card rise",
    recipe: titleCardRecipe,
    params: {
      text: "Reference Title",
      outputPath: "/renders/title-card.mov",
      inOutStyle: "rise",
    },
    expectedTools: [
      "fake_project_info",
      "fake_create_comp",
      "fake_add_text_layer",
      "fake_set_keyframes",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    name: "title-card fade",
    recipe: titleCardRecipe,
    params: {
      text: "Reference Title",
      outputPath: "/renders/title-card-fade.mov",
      inOutStyle: "fade",
    },
    expectedTools: [
      "fake_project_info",
      "fake_create_comp",
      "fake_add_text_layer",
      "fake_set_keyframes",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    name: "title-card track-in",
    recipe: titleCardRecipe,
    params: {
      text: "Reference Title",
      outputPath: "/renders/title-card-track.mov",
      inOutStyle: "track-in",
    },
    expectedTools: [
      "fake_project_info",
      "fake_create_comp",
      "fake_add_text_layer",
      "fake_set_keyframes",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    name: "motivated-transition dip-to-light",
    recipe: motivatedTransitionRecipe,
    params: {
      clipA: "/media/clip-a.mov",
      clipB: "/media/clip-b.mov",
      style: "dip-to-light",
      outputPath: "/renders/motivated-transition.mov",
    },
    expectedTools: [
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_precompose",
      "fake_apply_effect",
      "fake_set_keyframes",
      "fake_set_keyframes",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    name: "motivated-transition luma-wipe",
    recipe: motivatedTransitionRecipe,
    params: {
      clipA: "/media/clip-a.mov",
      clipB: "/media/clip-b.mov",
      style: "luma-wipe",
      outputPath: "/renders/luma-transition.mov",
    },
    expectedTools: [
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_precompose",
      "fake_apply_effect",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    name: "motivated-transition whip",
    recipe: motivatedTransitionRecipe,
    params: {
      clipA: "/media/clip-a.mov",
      clipB: "/media/clip-b.mov",
      style: "whip",
      outputPath: "/renders/whip-transition.mov",
    },
    expectedTools: [
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_precompose",
      "fake_apply_effect",
      "fake_set_keyframes",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    // The Studio with a look, a logo and a moving watermark: the whole surface
    // the console drives, including a path it generated rather than one the
    // recipe hard-coded.
    name: "hdr-cinema-studio golden hour branded",
    recipe: cinematicLookLabRecipe,
    params: {
      clip: "/media/source.mov",
      strength: "Natural HDR",
      look: "Golden Hour",
      renderMode: "Full",
      logoEnabled: true,
      watermarkEnabled: true,
      watermarkPath: watermarkPathKeyframes({
        motion: "Orbit",
        cycles: 3,
        travel: 70,
        centerXPercent: 50,
        centerYPercent: 50,
      }),
      outputPath: "/renders/golden-hour.mp4",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_add_media_layer",
      "fake_add_text_layer",
      "fake_set_keyframes",
      "fake_queue_render",
    ],
  },
  {
    // Technical HDR is what makes the separate grade recipe redundant: no look
    // step matches it, and switching both brand layers off leaves exactly the
    // colour-managed HLG delivery.
    name: "hdr-cinema-studio technical hdr only",
    recipe: cinematicLookLabRecipe,
    params: {
      clip: "/media/source.mov",
      strength: "Vivid HDR",
      look: "Technical HDR",
      renderMode: "Preview",
      logoEnabled: false,
      watermarkEnabled: false,
      outputPath: "/renders/technical.mp4",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_queue_render",
    ],
  },
  {
    // A look sample: one frame, no render queue, and the scaffolding removed.
    name: "hdr-cinema-studio still sample",
    recipe: cinematicLookLabRecipe,
    params: {
      clip: "/media/source.mov",
      strength: "Natural HDR",
      look: "Film Noir",
      renderMode: "Still",
      logoEnabled: false,
      watermarkEnabled: false,
      outputPath: "/previews/film-noir.png",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_save_frame",
    ],
  },
  {
    name: "hdr-safe-grade natural",
    recipe: hdrSafeGradeRecipe,
    params: {
      clip: "/media/source.mov",
      strength: "Natural HDR",
      outputPath: "/renders/hlg-master.mp4",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_queue_render",
    ],
  },
  {
    name: "hdr-safe-grade vivid",
    recipe: hdrSafeGradeRecipe,
    params: {
      clip: "/media/source.mov",
      strength: "Vivid HDR",
      outputPath: "/renders/hlg-vivid.mp4",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_queue_render",
    ],
  },
  {
    name: "hdr-safe-grade impact",
    recipe: hdrSafeGradeRecipe,
    params: {
      clip: "/media/source.mov",
      strength: "Impact HDR",
      outputPath: "/renders/hlg-impact.mp4",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_queue_render",
    ],
  },
];

async function runReferenceRecipe(testCase: ExecutionCase): Promise<{
  provider: FakeAeClientProvider;
  journal: RunJournal;
}> {
  const directory = await mkdtemp(join(tmpdir(), "conductor-reference-"));
  temporaryDirectories.push(directory);
  const provider = new FakeAeClientProvider();
  const engine = new RecipeEngine({
    clientProvider: provider,
    adapters: createFakeAdapterRegistry(),
    journalWriter: new JournalWriter(directory),
    createRunId: () => `run-${testCase.name.replaceAll(" ", "-")}`,
  });

  const result = await engine.run(testCase.recipe, testCase.params);
  const journal = JSON.parse(
    await readFile(result.journalPath, "utf8"),
  ) as RunJournal;
  return { provider, journal };
}

describe("reference recipe execution", () => {
  for (const testCase of executionCases) {
    it(`executes ${testCase.name} in contract order with verified export`, async () => {
      const { provider, journal } = await runReferenceRecipe(testCase);
      const calls = provider.connection.calls;

      expect(calls.map((call) => call.tool)).toEqual(testCase.expectedTools);
      // Every recipe ends by producing something: a queued render, or — for a
      // look sample — a frame written straight out of the session.
      const terminal = testCase.expectedTools.at(-1) as string;
      expect(["fake_queue_render", "fake_save_frame"]).toContain(terminal);
      expect(calls.at(-1)?.tool).toBe(terminal);
      expect(journal.status).toBe("completed");
      // The last step that ran, not the last step in the recipe: a still run
      // deliberately skips the render-queue step that follows it.
      const executed = journal.steps.filter((step) => step.status === "succeeded");
      expect(executed.at(-1)).toMatchObject({
        operation: terminal === "fake_save_frame" ? "saveFrame" : "queueRender",
        tool: terminal,
        status: "succeeded",
      });
      expect(testCase.recipe.steps.at(-1)?.verify).toBeDefined();

      const keyframeCalls = calls.filter(
        (call) => call.tool === "fake_set_keyframes",
      );
      for (const call of keyframeCalls) {
        expect(call.args).toHaveProperty("easing.type", "cubic-bezier");
        expect(call.args).toHaveProperty("easing.profile");
        expect(call.args.easing).not.toBe("linear");

        if (
          typeof call.args.property === "string" &&
          call.args.property.toLowerCase().includes("position")
        ) {
          expect(call.args.motionBlur).toBe(true);
        }
      }
    });
  }

  it("resolves all HDR strengths to their bounded After Effects controls", async () => {
    const expected = {
      "hdr-safe-grade natural": {
        exposure: 0,
        gamma: 1,
        inputBlack: 0,
        clipWhite: 1,
        vibrance: undefined,
      },
      "hdr-safe-grade vivid": {
        exposure: 0.12,
        gamma: 0.97,
        inputBlack: 0.003,
        clipWhite: 2,
        vibrance: { Vibrance: 18, Saturation: 3 },
      },
      "hdr-safe-grade impact": {
        exposure: 0.3,
        gamma: 0.9,
        inputBlack: 0.008,
        clipWhite: 2,
        vibrance: { Vibrance: 32, Saturation: 6 },
      },
    } as const;

    for (const [name, controls] of Object.entries(expected)) {
      const testCase = executionCases.find((candidate) => candidate.name === name);
      if (testCase === undefined) throw new Error(`Missing case ${name}`);
      const { provider } = await runReferenceRecipe(testCase);
      const effectCalls = provider.connection.calls.filter(
        (call) => call.tool === "fake_apply_effect",
      );
      const exposure = effectCalls.find(
        (call) => call.args.effect === "Exposure",
      );
      const levels = effectCalls.find((call) => call.args.effect === "Levels");
      const vibrance = effectCalls.find(
        (call) => call.args.effect === "Vibrance",
      );

      expect(exposure?.args.settings).toMatchObject({
        Exposure: controls.exposure,
        Offset: 0,
        "Gamma Correction": controls.gamma,
      });
      expect(levels?.args.settings).toMatchObject({
        "Input Black": controls.inputBlack,
        "Clip To Output White": controls.clipWhite,
      });
      if (controls.vibrance === undefined) {
        expect(vibrance).toBeUndefined();
      } else {
        expect(vibrance?.args.settings).toMatchObject(controls.vibrance);
      }
    }
  });

  it("carries a console-generated watermark path through to the keyframe call", async () => {
    const testCase = executionCases.find(
      (candidate) => candidate.name === "hdr-cinema-studio golden hour branded",
    );
    if (testCase === undefined) throw new Error("Missing Studio execution case");
    const { provider } = await runReferenceRecipe(testCase);

    const keyframeCall = provider.connection.calls.find(
      (call) => call.tool === "fake_set_keyframes",
    );
    const supplied = testCase.params.watermarkPath as Array<unknown>;
    // A path with this many samples is the whole point: four corner keys are
    // what made the mark lurch. It has to survive validation intact.
    expect(supplied.length).toBeGreaterThan(60);
    expect(keyframeCall?.args.keyframes).toEqual(supplied);
    expect(keyframeCall?.args.coordinateSpace).toBe("normalized-comp");
    expect(keyframeCall?.args.timeMode).toBe("normalized");

    // Every keyframe Conductor writes is eased, and with a sampled curve the
    // ease must stay tiny or the mark stalls at each of those samples.
    const easing = keyframeCall?.args.easing as { controlPoints: number[] };
    expect(easing.controlPoints[0]).toBeLessThanOrEqual(0.05);
    expect(easing.controlPoints[2]).toBeGreaterThanOrEqual(0.95);

    const textCall = provider.connection.calls.find(
      (call) => call.tool === "fake_add_text_layer",
    );
    expect(textCall?.args.sizePercent).toBe(2.6);
  });

  it("delivers Technical HDR with no look effect and no brand layers", async () => {
    const testCase = executionCases.find(
      (candidate) => candidate.name === "hdr-cinema-studio technical hdr only",
    );
    if (testCase === undefined) throw new Error("Missing technical HDR case");
    const { provider, journal } = await runReferenceRecipe(testCase);

    const effects = provider.connection.calls
      .filter((call) => call.tool === "fake_apply_effect")
      .map((call) => call.args.effect);
    // Exposure, Levels and Vibrance are the technical grade. Anything else
    // would mean a look leaked into the baseline.
    expect(effects).toEqual(["Exposure", "Levels", "Vibrance"]);
    expect(
      provider.connection.calls.some((call) => call.tool === "fake_add_text_layer"),
    ).toBe(false);
    expect(
      provider.connection.calls.some((call) => call.tool === "fake_add_media_layer"),
    ).toBe(false);
    expect(journal.status).toBe("completed");
  });

  it("takes a look sample as one frame, and clears up after itself", async () => {
    const testCase = executionCases.find(
      (candidate) => candidate.name === "hdr-cinema-studio still sample",
    );
    if (testCase === undefined) throw new Error("Missing still execution case");
    const { provider, journal } = await runReferenceRecipe(testCase);
    const calls = provider.connection.calls;

    // No render queue at all: that is the entire point of a still.
    expect(calls.some((call) => call.tool === "fake_queue_render")).toBe(false);
    const still = calls.find((call) => call.tool === "fake_save_frame");
    expect(still?.args.outputPath).toBe("/previews/film-noir.png");
    expect(still?.args.timeSeconds).toBe(0);
    // A sample is scaffolding; leaving eight comps behind per comparison is not
    // acceptable in someone else's project.
    expect(still?.args.disposeComp).toBe(true);
    expect(journal.status).toBe("completed");

    // The sample is taken from the middle of the clip, like a moving one.
    const comp = calls.find((call) => call.tool === "fake_create_comp");
    expect(comp?.args.durationSeconds).toBe(2);
  });

  it("records the built-in HDR validation handoff in the journal", async () => {
    const testCase = executionCases.find(
      (candidate) => candidate.recipe.id === "hdr-safe-grade",
    );
    if (testCase === undefined) throw new Error("Missing HDR execution case");
    const { journal } = await runReferenceRecipe(testCase);

    expect(journal.steps.at(-1)?.note).toContain("validates the delivered file");
  });

  it("journals proposal provenance without any credential field", async () => {
    const directory = await mkdtemp(join(tmpdir(), "conductor-provenance-"));
    temporaryDirectories.push(directory);
    const provider = new FakeAeClientProvider();
    const engine = new RecipeEngine({
      clientProvider: provider,
      adapters: createFakeAdapterRegistry(),
      journalWriter: new JournalWriter(directory),
      createRunId: () => "run-with-proposal-provenance",
    });

    const result = await engine.run(
      titleCardRecipe,
      {
        text: "Provenance test",
        outputPath: "/renders/provenance.mov",
      },
      {
        proposalProvenance: {
          brainType: "api",
          provider: "openai",
          model: "proposal-test-model",
        },
      },
    );
    const journalSource = await readFile(result.journalPath, "utf8");
    const journal = JSON.parse(journalSource) as RunJournal;

    expect(journal.proposalProvenance).toEqual({
      brainType: "api",
      provider: "openai",
      model: "proposal-test-model",
    });
    expect(journalSource).not.toContain("apiKey");
    expect(journalSource).not.toContain("authorization");
  });

  const verificationCases = [
    executionCases.find((testCase) => testCase.recipe.id === "title-card"),
    executionCases.find(
      (testCase) => testCase.recipe.id === "motivated-transition",
    ),
    executionCases.find((testCase) => testCase.recipe.id === "hdr-safe-grade"),
  ].filter((testCase): testCase is ExecutionCase => testCase !== undefined);

  for (const testCase of verificationCases) {
    it(`fires the final render verification for ${testCase.recipe.id}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "conductor-verify-"));
      temporaryDirectories.push(directory);
      const provider = new FakeAeClientProvider();
      provider.connection.invalidQueueResult = true;
      const engine = new RecipeEngine({
        clientProvider: provider,
        adapters: createFakeAdapterRegistry(),
        journalWriter: new JournalWriter(directory),
        createRunId: () => `verify-${testCase.recipe.id}`,
      });

      await expect(
        engine.run(testCase.recipe, testCase.params),
      ).rejects.toThrow(/failed at step 'queue-verified/);
    });
  }

  it("encodes the craft invariants in every reference recipe branch", () => {
    for (const recipe of [
      titleCardRecipe,
      motivatedTransitionRecipe,
      hdrSafeGradeRecipe,
    ]) {
      const finalStep = recipe.steps.at(-1);
      expect(finalStep?.operation).toBe("queueRender");
      expect(finalStep?.verify).toBeDefined();

      for (const step of recipe.steps) {
        if (step.operation !== "setKeyframes") continue;
        expect(step.args).toHaveProperty("easing.type", "cubic-bezier");
        expect(step.args).toHaveProperty("easing.controlPoints");

        if (
          typeof step.args.property === "string" &&
          step.args.property.toLowerCase().includes("position")
        ) {
          expect(step.args.motionBlur).toBe(true);
        }
      }
    }

    for (const step of motivatedTransitionRecipe.steps) {
      if (step.operation === "applyEffect") {
        expect(String(step.args.effect).toLowerCase()).not.toBe("crossfade");
      }
    }
  });
});
