import type { Recipe } from "../schema/recipe.js";
import { cinematicLookLabRecipe } from "./cinematic-look-lab.js";
import { hdrSafeGradeRecipe } from "./hdr-safe-grade.js";
import { motivatedTransitionRecipe } from "./motivated-transition.js";
import { titleCardRecipe } from "./title-card.js";

const recipes = [
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

export {
  cinematicLookLabRecipe,
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
};
