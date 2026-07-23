import { z } from "zod";

import { jsonValueSchema, type JsonValue } from "../schema/json.js";

export const brainKindSchema = z.enum(["none", "api", "local"]);
export type BrainKind = z.infer<typeof brainKindSchema>;

export const apiProviderSchema = z.enum(["openai", "anthropic", "gemini"]);
export type ApiProvider = z.infer<typeof apiProviderSchema>;

export interface RecipeSummary {
  id: string;
  title: string;
  description: string;
  paramsSchema: JsonValue;
}

export const brainProposalSchema = z
  .object({
    recipeId: z.string().min(1),
    params: z.record(z.string(), jsonValueSchema),
    rationale: z.string().min(1).max(1_000),
  })
  .strict();

export type BrainProposal = z.infer<typeof brainProposalSchema>;

export interface BrainSuggestRequest {
  userGoal: string;
  recipes: RecipeSummary[];
}

export interface JournalSummary {
  recipeId: string;
  status: "completed" | "failed";
  steps: Array<{
    id: string;
    status: "succeeded" | "skipped" | "failed";
    durationMs: number;
  }>;
  error?: {
    code?: string;
    message: string;
  };
}

export const brainReviewSchema = z
  .object({
    note: z.string().min(1).max(500),
  })
  .strict();

export interface BrainCapabilities {
  suggest: boolean;
  review: boolean;
}

export interface BrainProvenance {
  brainType: BrainKind;
  model?: string;
  provider?: ApiProvider | "openai-compatible";
}

export interface BrainHealth {
  ok: boolean;
  message: string;
}

/**
 * Brains only produce proposals and short review notes. They never receive an
 * MCP client, adapter registry, recipe engine, or execution capability.
 */
export interface Brain {
  readonly kind: BrainKind;
  readonly capabilities: BrainCapabilities;
  readonly provenance: BrainProvenance;
  suggest(request: BrainSuggestRequest): Promise<BrainProposal>;
  review?(journal: JournalSummary): Promise<string>;
  checkHealth(): Promise<BrainHealth>;
}
