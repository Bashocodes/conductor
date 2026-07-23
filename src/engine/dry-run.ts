import {
  buildParamsSchema,
  recipeSchema,
  type ExpectedShape,
  type JsonValue,
} from "../schema/recipe.js";
import { ConductorEngineError } from "./errors.js";
import { interpolateArgs, type ResolutionContext } from "./interpolation.js";

export interface DryRunStep {
  id: string;
  server: string;
  tool: string;
  args: Record<string, JsonValue>;
  timeoutMs: number;
  precondition?: string;
  verify?: ExpectedShape;
}

export interface DryRunPlan {
  recipeId: string;
  title: string;
  params: Record<string, unknown>;
  steps: DryRunStep[];
}

export function resolveRecipeParams(
  recipeInput: unknown,
  suppliedParams: Record<string, unknown>,
): {
  recipe: ReturnType<typeof recipeSchema.parse>;
  params: Record<string, unknown>;
} {
  const parsedRecipe = recipeSchema.safeParse(recipeInput);
  if (!parsedRecipe.success) {
    throw new ConductorEngineError(
      "INVALID_RECIPE",
      "Recipe failed validation",
      { details: parsedRecipe.error.issues },
    );
  }

  const parsedParams = buildParamsSchema(parsedRecipe.data.params).safeParse(
    suppliedParams,
  );
  if (!parsedParams.success) {
    throw new ConductorEngineError(
      "INVALID_PARAMS",
      `Parameters for recipe '${parsedRecipe.data.id}' failed validation`,
      { details: parsedParams.error.issues },
    );
  }

  return {
    recipe: parsedRecipe.data,
    params: parsedParams.data,
  };
}

export function createDryRunPlan(
  recipeInput: unknown,
  suppliedParams: Record<string, unknown>,
): DryRunPlan {
  const { recipe, params } = resolveRecipeParams(recipeInput, suppliedParams);
  const context: ResolutionContext = { params, steps: {} };

  return {
    recipeId: recipe.id,
    title: recipe.title,
    params,
    steps: recipe.steps.map((step) => ({
      id: step.id,
      server: step.server,
      tool: step.tool,
      args: interpolateArgs(step.args, context, {
        preserveUnresolvedStepReferences: true,
      }),
      timeoutMs: step.timeoutMs,
      ...(step.precondition === undefined
        ? {}
        : { precondition: step.precondition }),
      ...(step.verify === undefined ? {} : { verify: step.verify }),
    })),
  };
}
