import { BrainError } from "./errors.js";
import type {
  Brain,
  BrainHealth,
  BrainProposal,
  BrainSuggestRequest,
} from "./types.js";

export class NoneBrain implements Brain {
  public readonly kind = "none" as const;
  public readonly capabilities = {
    suggest: false,
    review: false,
  } as const;
  public readonly provenance = {
    brainType: "none",
  } as const;

  public async suggest(_request: BrainSuggestRequest): Promise<BrainProposal> {
    throw new BrainError(
      "BRAIN_DISABLED",
      "Brain suggestions are disabled. Configure an api or local brain, or continue using 'conductor run'.",
    );
  }

  public async checkHealth(): Promise<BrainHealth> {
    return {
      ok: true,
      message: "none (disabled; deterministic mode)",
    };
  }
}
