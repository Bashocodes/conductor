import type { Recipe } from "../schema/recipe.js";
import { hdrSafeGradeRecipe } from "./hdr-safe-grade.js";
import { motivatedTransitionRecipe } from "./motivated-transition.js";
import { titleCardRecipe } from "./title-card.js";

const recipes = [
  titleCardRecipe,
  motivatedTransitionRecipe,
  hdrSafeGradeRecipe,
] satisfies Recipe[];

export function listRecipes(): Recipe[] {
  return [...recipes];
}

export function getRecipe(id: string): Recipe | undefined {
  return recipes.find((recipe) => recipe.id === id);
}

export {
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
};
