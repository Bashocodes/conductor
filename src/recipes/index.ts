import type { Recipe } from "../schema/recipe.js";
import { demoTitleCardRecipe } from "./demo-title-card.js";

const recipes = [demoTitleCardRecipe] satisfies Recipe[];

export function listRecipes(): Recipe[] {
  return [...recipes];
}

export function getRecipe(id: string): Recipe | undefined {
  return recipes.find((recipe) => recipe.id === id);
}

export { demoTitleCardRecipe };
