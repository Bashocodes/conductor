import { resolveRecipeParams } from "../engine/dry-run.js";
import type { Recipe } from "../schema/recipe.js";
import type { ProposalProvenance } from "../engine/journal.js";
import { summarizeRecipes } from "./catalog.js";
import { BrainError } from "./errors.js";
import type {
  Brain,
  BrainProposal,
  BrainProvenance,
} from "./types.js";

export interface AskExecutionRequest {
  recipe: Recipe;
  params: Record<string, unknown>;
  provenance: ProposalProvenance;
}

export interface AskFlowOptions<Result> {
  userGoal: string;
  brain: Brain;
  recipes: Recipe[];
  confirm: (proposal: BrainProposal) => Promise<boolean>;
  execute: (request: AskExecutionRequest) => Promise<Result>;
  onProposal?: (proposal: BrainProposal) => void | Promise<void>;
}

export type AskFlowResult<Result> =
  | {
      proposal: BrainProposal;
      confirmed: false;
    }
  | {
      proposal: BrainProposal;
      confirmed: true;
      execution: Result;
    };

function executionProvenance(
  provenance: BrainProvenance,
): ProposalProvenance {
  if (
    provenance.brainType === "none" ||
    provenance.model === undefined
  ) {
    throw new BrainError(
      "BRAIN_DISABLED",
      "A disabled brain cannot produce executable proposal provenance",
    );
  }

  return {
    brainType: provenance.brainType,
    model: provenance.model,
    ...(provenance.provider === undefined
      ? {}
      : { provider: provenance.provider }),
  };
}

export async function runAskFlow<Result>(
  options: AskFlowOptions<Result>,
): Promise<AskFlowResult<Result>> {
  const proposal = await options.brain.suggest({
    userGoal: options.userGoal,
    recipes: summarizeRecipes(options.recipes),
  });
  const recipe = options.recipes.find(
    (candidate) => candidate.id === proposal.recipeId,
  );
  if (recipe === undefined) {
    throw new BrainError(
      "RECIPE_NOT_FOUND",
      `Brain selected unknown recipe '${proposal.recipeId}'`,
    );
  }

  let params: Record<string, unknown>;
  try {
    params = resolveRecipeParams(recipe, proposal.params).params;
  } catch (error) {
    throw new BrainError(
      "PROPOSAL_PARAMS_INVALID",
      `Brain proposed invalid parameters for recipe '${recipe.id}'`,
      { cause: error },
    );
  }

  const normalizedProposal: BrainProposal = {
    ...proposal,
    params: params as BrainProposal["params"],
  };
  await options.onProposal?.(normalizedProposal);

  const confirmed = await options.confirm(normalizedProposal);
  if (!confirmed) {
    return {
      proposal: normalizedProposal,
      confirmed: false,
    };
  }

  const execution = await options.execute({
    recipe,
    params,
    provenance: executionProvenance(options.brain.provenance),
  });
  return {
    proposal: normalizedProposal,
    confirmed: true,
    execution,
  };
}
