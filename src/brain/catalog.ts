import { z } from "zod";

import type { Recipe } from "../schema/recipe.js";
import { buildParamsSchema } from "../schema/recipe.js";
import type { JsonValue } from "../schema/json.js";
import { BrainError } from "./errors.js";
import type { BrainProposal, RecipeSummary } from "./types.js";
import { brainProposalSchema } from "./types.js";

export const CATALOG_CHARACTER_BUDGET = 12_000;

export function summarizeRecipes(recipes: Recipe[]): RecipeSummary[] {
  return recipes.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    paramsSchema: z.toJSONSchema(buildParamsSchema(Object.fromEntries(
      Object.entries(recipe.params).filter(
        ([_name, definition]) => definition.internal !== true,
      ),
    )), {
      target: "draft-07",
    }) as JsonValue,
  }));
}

export function serializeCatalog(
  recipes: RecipeSummary[],
  characterBudget = CATALOG_CHARACTER_BUDGET,
): string {
  const catalog = JSON.stringify(
    recipes.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description.slice(0, 400),
      paramsSchema: recipe.paramsSchema,
    })),
  );

  if (catalog.length > characterBudget) {
    throw new BrainError(
      "CATALOG_TOO_LARGE",
      `Recipe catalog exceeds the ${characterBudget}-character brain budget`,
      { details: { characters: catalog.length, characterBudget } },
    );
  }

  return catalog;
}

function compactIssues(error: z.ZodError): Array<{
  path: string;
  message: string;
}> {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function parseAndValidateProposal(
  raw: string,
  recipes: RecipeSummary[],
): BrainProposal {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new BrainError(
      "INVALID_RESPONSE",
      "Brain response was not a single valid JSON object",
      { cause: error },
    );
  }

  const parsed = brainProposalSchema.safeParse(input);
  if (!parsed.success) {
    throw new BrainError(
      "INVALID_RESPONSE",
      "Brain proposal failed schema validation",
      { details: compactIssues(parsed.error) },
    );
  }

  const recipe = recipes.find(
    (candidate) => candidate.id === parsed.data.recipeId,
  );
  if (recipe === undefined) {
    throw new BrainError(
      "RECIPE_NOT_FOUND",
      `Brain selected unknown recipe '${parsed.data.recipeId}'`,
    );
  }

  const paramsSchema = z.fromJSONSchema(
    recipe.paramsSchema as Parameters<typeof z.fromJSONSchema>[0],
  );
  const params = paramsSchema.safeParse(parsed.data.params);
  if (!params.success) {
    throw new BrainError(
      "PROPOSAL_PARAMS_INVALID",
      `Brain proposed invalid parameters for recipe '${recipe.id}'`,
      { details: compactIssues(params.error) },
    );
  }

  return parsed.data;
}

export function validationFeedback(error: unknown): string {
  if (error instanceof BrainError) {
    const details =
      error.details === undefined ? "" : ` ${JSON.stringify(error.details)}`;
    return `${error.code}: ${error.message}${details}`.slice(0, 1_500);
  }
  return "INVALID_RESPONSE: response could not be validated";
}
