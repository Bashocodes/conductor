import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RecipeEngine } from "../src/engine/engine.js";
import { JournalWriter, type RunJournal } from "../src/engine/journal.js";
import {
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
} from "../src/recipes/index.js";
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
    name: "hdr-safe-grade hlg",
    recipe: hdrSafeGradeRecipe,
    params: {
      clip: "/media/source.mov",
      target: "hlg",
      outputPath: "/renders/hlg-master.mov",
    },
    expectedTools: [
      "fake_project_info",
      "fake_project_info",
      "fake_create_comp",
      "fake_precompose",
      "fake_apply_effect",
      "fake_apply_effect",
      "fake_project_info",
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
      expect(calls.at(-1)?.tool).toBe("fake_queue_render");
      expect(journal.status).toBe("completed");
      expect(journal.steps.at(-1)).toMatchObject({
        operation: "queueRender",
        tool: "fake_queue_render",
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

  it("writes the reel-hdr technical handoff into the HDR journal", async () => {
    const testCase = executionCases.find(
      (candidate) => candidate.recipe.id === "hdr-safe-grade",
    );
    if (testCase === undefined) throw new Error("Missing HDR execution case");
    const { journal } = await runReferenceRecipe(testCase);

    expect(journal.steps.at(-1)?.note).toContain("reel-hdr");
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
