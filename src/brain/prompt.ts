import type { BrainSuggestRequest, JournalSummary } from "./types.js";
import { serializeCatalog } from "./catalog.js";

export const PROPOSAL_SYSTEM_PROMPT = [
  "You are the optional proposal brain for Conductor.",
  "You may only select one recipe from the supplied catalog and fill its declared parameters.",
  "You cannot create steps, tools, operations, shell commands, or MCP calls.",
  "Return exactly one JSON object and no markdown.",
  'The object must have this shape: {"recipeId":"catalog-id","params":{},"rationale":"short explanation"}.',
  "Use only parameter names and types declared by the selected recipe JSON Schema.",
].join(" ");

export function buildSuggestionPrompt(request: BrainSuggestRequest): string {
  const catalog = serializeCatalog(request.recipes);
  return [
    `User goal: ${request.userGoal}`,
    `Recipe catalog (summaries and parameter JSON Schemas only): ${catalog}`,
    "Return the proposal JSON object.",
  ].join("\n\n");
}

export const REVIEW_SYSTEM_PROMPT = [
  "You review a minimal Conductor run summary.",
  "Return exactly one JSON object and no markdown.",
  'The object must have this shape: {"note":"one short quality note"}.',
  "Do not propose or execute tools.",
].join(" ");

export function buildReviewPrompt(journal: JournalSummary): string {
  return `Run summary: ${JSON.stringify(journal)}`;
}
