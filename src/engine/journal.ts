import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { JsonValue } from "../schema/recipe.js";
import type { ToolOperation } from "../adapters/toolContract.js";
import { ConductorEngineError } from "./errors.js";

export interface JournalError {
  name: string;
  message: string;
  code?: string;
  details?: unknown;
}

export interface JournalStep {
  id: string;
  server: string;
  operation: ToolOperation;
  tool?: string;
  status: "succeeded" | "skipped" | "failed";
  startedAt: string;
  durationMs: number;
  args?: Record<string, JsonValue>;
  contractArgs?: Record<string, JsonValue>;
  resultSummary?: unknown;
  precondition?: string;
  note?: string;
  error?: JournalError;
}

export interface ProposalProvenance {
  brainType: "api" | "local";
  model: string;
  provider?: "openai" | "anthropic" | "gemini" | "openai-compatible";
}

export interface RunJournal {
  schemaVersion: 1;
  runId: string;
  recipeId: string;
  recipeTitle: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  params: Record<string, unknown>;
  proposalProvenance?: ProposalProvenance;
  steps: JournalStep[];
  verification?: {
    beatSyncAlignment?: unknown;
    [name: string]: unknown;
  };
  error?: JournalError;
}

export function serializeError(error: unknown): JournalError {
  if (error instanceof Error) {
    const withCode = error as Error & {
      code?: unknown;
      details?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      ...(typeof withCode.code === "string" ? { code: withCode.code } : {}),
      ...(withCode.details === undefined
        ? {}
        : { details: withCode.details }),
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

export function summarizeResult(
  result: unknown,
  maxCharacters = 2_000,
): unknown {
  const seen = new WeakSet<object>();
  let serialized: string;

  try {
    serialized = JSON.stringify(result, (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (value !== null && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  } catch {
    return { type: typeof result, summary: String(result) };
  }

  if (serialized === undefined) {
    return { type: typeof result, summary: String(result) };
  }

  if (serialized.length > maxCharacters) {
    return {
      truncated: true,
      characters: serialized.length,
      preview: serialized.slice(0, maxCharacters),
    };
  }

  return JSON.parse(serialized) as unknown;
}

export class JournalWriter {
  public readonly directory: string;

  public constructor(directory = resolve(process.cwd(), "runs")) {
    this.directory = resolve(directory);
  }

  public async write(journal: RunJournal): Promise<string> {
    const filename = `${journal.runId}.json`;
    const path = join(this.directory, filename);

    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(path, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
      return path;
    } catch (error) {
      throw new ConductorEngineError(
        "JOURNAL_WRITE_FAILED",
        `Failed to write run journal at ${path}`,
        { cause: error },
      );
    }
  }
}
