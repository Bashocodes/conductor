import {
  buildParamsSchema,
  recipeSchema,
  type ExpectedShape,
  type JsonValue,
} from "../schema/recipe.js";
import {
  AdapterRegistry,
  createDefaultAdapterRegistry,
} from "../adapters/registry.js";
import type { ToolOperation } from "../adapters/toolContract.js";
import { ConductorEngineError } from "./errors.js";
import { interpolateArgs, type ResolutionContext } from "./interpolation.js";
import { evaluatePrecondition } from "./precondition.js";

export interface DryRunStep {
  id: string;
  server: string;
  operation: ToolOperation;
  /**
   * What Conductor intends, in ToolContract terms. This is the readable half of
   * the plan and is identical whatever server you point at — a script adapter
   * cannot show meaningful `args`, because its arguments are a program rendered
   * at run time from these values.
   */
  contractArgs: Record<string, JsonValue>;
  /** How it reaches this particular server. */
  tool: string;
  args: Record<string, JsonValue>;
  timeoutMs: number;
  precondition?: string;
  verify?: ExpectedShape;
  note?: string;
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
  adapters: AdapterRegistry = createDefaultAdapterRegistry(),
): DryRunPlan {
  const { recipe, params } = resolveRecipeParams(recipeInput, suppliedParams);
  const context: ResolutionContext = { params, steps: {} };
  const steps: DryRunStep[] = [];

  for (const step of recipe.steps) {
    if (
      step.precondition !== undefined &&
      !step.precondition.includes("steps.") &&
      !evaluatePrecondition(step.precondition, context)
    ) {
      continue;
    }

    const contractArgs = interpolateArgs(step.args, context, {
      preserveUnresolvedStepReferences: true,
    });
    const mapped = adapters
      .get(step.server)
      .mapCall(step.operation, contractArgs, {
        allowUnresolvedReferences: true,
      });

    steps.push({
      id: step.id,
      server: step.server,
      operation: step.operation,
      contractArgs,
      tool: mapped.tool,
      args: mapped.args,
      timeoutMs: step.timeoutMs,
      ...(step.precondition === undefined
        ? {}
        : { precondition: step.precondition }),
      ...(step.verify === undefined ? {} : { verify: step.verify }),
      ...(step.note === undefined ? {} : { note: step.note }),
    });
  }

  return {
    recipeId: recipe.id,
    title: recipe.title,
    params,
    steps,
  };
}
