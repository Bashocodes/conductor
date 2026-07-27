import type { Recipe } from "../schema/recipe.js";
import { resolveRecipeParams } from "../engine/dry-run.js";
import {
  analyzeAudioFile,
  type BeatAnalysis,
} from "../beat/analyze.js";
import {
  buildBeatSyncStudioPlan,
  withBeatSyncPlanParams,
  type BeatSyncStudioParams,
} from "../beat/studio.js";
import { beatSyncEditRecipe } from "./beat-sync-edit.js";
import { cinematicLookLabRecipe } from "./cinematic-look-lab.js";
import { hdrSafeGradeRecipe } from "./hdr-safe-grade.js";
import { motivatedTransitionRecipe } from "./motivated-transition.js";
import { titleCardRecipe } from "./title-card.js";

const recipes = [
  beatSyncEditRecipe,
  titleCardRecipe,
  motivatedTransitionRecipe,
  hdrSafeGradeRecipe,
  cinematicLookLabRecipe,
] satisfies Recipe[];

export function listRecipes(): Recipe[] {
  return [...recipes];
}

export function getRecipe(id: string): Recipe | undefined {
  return recipes.find((recipe) => recipe.id === id);
}

export async function prepareRecipeRun(
  recipe: Recipe,
  suppliedParams: Record<string, unknown>,
  options: {
    analyzeAudio?: (audioPath: string) => Promise<BeatAnalysis>;
  } = {},
): Promise<{ recipe: Recipe; params: Record<string, unknown> }> {
  const resolved = resolveRecipeParams(recipe, suppliedParams);
  if (recipe.id !== beatSyncEditRecipe.id) return resolved;

  const params = resolved.params as unknown as BeatSyncStudioParams;
  const analysis = await (options.analyzeAudio ?? analyzeAudioFile)(params.audio);
  const plan = buildBeatSyncStudioPlan(params, analysis);
  return {
    recipe: resolved.recipe,
    params: withBeatSyncPlanParams(resolved.params, plan),
  };
}

export {
  beatSyncEditRecipe,
  cinematicLookLabRecipe,
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
};
