import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { ConductorMcpError } from "../mcp/errors.js";
import type { McpClientProvider } from "../mcp/types.js";
import type { JsonValue } from "../schema/recipe.js";
import {
  AdapterRegistry,
  createDefaultAdapterRegistry,
} from "../adapters/registry.js";
import { resolveRecipeParams } from "./dry-run.js";
import { ConductorEngineError } from "./errors.js";
import {
  interpolateArgs,
  type ResolutionContext,
} from "./interpolation.js";
import {
  JournalWriter,
  serializeError,
  summarizeResult,
  type JournalStep,
  type ProposalProvenance,
  type RunJournal,
} from "./journal.js";
import { findHostError, normalizeToolResult } from "./normalizeResult.js";
import { evaluatePrecondition } from "./precondition.js";
import { verifyExpectedShape } from "./verify.js";

export interface EngineOptions {
  clientProvider: McpClientProvider;
  adapters?: AdapterRegistry;
  journalWriter?: JournalWriter;
  now?: () => Date;
  createRunId?: (recipeId: string, startedAt: Date) => string;
  /**
   * Called as each step settles. A recipe can take a minute of real work inside
   * a creative application, so anything watching a run — a terminal, a local
   * UI — needs to see progress rather than a silence that looks like a hang.
   * Never throws into the run: a failing observer must not fail the recipe.
   */
  onStep?: (step: JournalStep) => void;
}

export interface RunResult {
  runId: string;
  journalPath: string;
  outputs: Record<string, unknown>;
}

export interface RunOptions {
  proposalProvenance?: ProposalProvenance;
}

function defaultRunId(recipeId: string, startedAt: Date): string {
  return `${startedAt.toISOString().replaceAll(":", "-")}-${recipeId}-${randomUUID().slice(0, 8)}`;
}

function elapsedMilliseconds(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  server: string,
  tool: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ConductorMcpError(
          "TOOL_TIMEOUT",
          `MCP tool '${server}.${tool}' timed out after ${timeoutMs}ms`,
          { server, tool, timeoutMs },
        ),
      );
    }, timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class RecipeEngine {
  readonly #clientProvider: McpClientProvider;
  readonly #adapters: AdapterRegistry;
  readonly #journalWriter: JournalWriter;
  readonly #now: () => Date;
  readonly #createRunId: (recipeId: string, startedAt: Date) => string;
  readonly #onStep: (step: JournalStep) => void;

  public constructor(options: EngineOptions) {
    this.#clientProvider = options.clientProvider;
    this.#adapters = options.adapters ?? createDefaultAdapterRegistry();
    this.#journalWriter = options.journalWriter ?? new JournalWriter();
    this.#now = options.now ?? (() => new Date());
    this.#createRunId = options.createRunId ?? defaultRunId;
    const observer = options.onStep;
    this.#onStep = observer === undefined
      ? () => undefined
      : (step) => {
        // An observer that throws must not take the run down with it.
        try { observer(step); } catch { /* progress reporting is best effort */ }
      };
  }

  #record(steps: JournalStep[], step: JournalStep): void {
    steps.push(step);
    this.#onStep(step);
  }

  public async run(
    recipeInput: unknown,
    suppliedParams: Record<string, unknown>,
    options: RunOptions = {},
  ): Promise<RunResult> {
    const { recipe, params } = resolveRecipeParams(
      recipeInput,
      suppliedParams,
    );
    const startedAt = this.#now();
    const runId = this.#createRunId(recipe.id, startedAt);
    const context: ResolutionContext = { params, steps: {} };
    const journalSteps: JournalStep[] = [];
    let executionError: unknown;

    const journal: RunJournal = {
      schemaVersion: 1,
      runId,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      status: "completed",
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      params,
      ...(options.proposalProvenance === undefined
        ? {}
        : { proposalProvenance: options.proposalProvenance }),
      steps: journalSteps,
    };

    try {
      for (const step of recipe.steps) {
        const stepStartedAt = this.#now();
        const timerStarted = performance.now();
        const adapter = this.#adapters.get(step.server);

        if (
          step.precondition !== undefined &&
          !evaluatePrecondition(step.precondition, context)
        ) {
          context.steps[step.id] = { status: "skipped" };
          this.#record(journalSteps, {
            id: step.id,
            server: step.server,
            operation: step.operation,
            status: "skipped",
            startedAt: stepStartedAt.toISOString(),
            durationMs: elapsedMilliseconds(timerStarted),
            precondition: step.precondition,
            ...(step.note === undefined ? {} : { note: step.note }),
          });
          continue;
        }

        let contractArgs: Record<string, JsonValue> | undefined;
        let mappedTool: string | undefined;
        let mappedArgs: Record<string, JsonValue> | undefined;
        try {
          contractArgs = interpolateArgs(step.args, context);
          const mapped = adapter.mapCall(step.operation, contractArgs);
          mappedTool = mapped.tool;
          mappedArgs = mapped.args;
          const connection = await this.#clientProvider.get(step.server);
          const rawResult = await withTimeout(
            connection.callTool(mapped.tool, mapped.args, step.timeoutMs),
            step.timeoutMs,
            step.server,
            mapped.tool,
          );
          // Servers that answer with a JSON text block instead of
          // structuredContent get the same shape as everyone else, so recipes
          // stay portable across server implementations.
          const result = normalizeToolResult(rawResult);

          // A script host can report transport success for a script that threw.
          // Catch that here, or the journal would record work that never happened.
          const hostError = findHostError(result);
          if (hostError !== undefined) {
            throw new ConductorEngineError(
              "STEP_FAILED",
              `Step '${step.id}' reported success but ${step.server} raised: ${hostError.message}`,
              {
                details: {
                  server: step.server,
                  tool: mapped.tool,
                  operation: step.operation,
                  ...(hostError.line === undefined ? {} : { line: hostError.line }),
                },
              },
            );
          }

          if (step.verify !== undefined) {
            verifyExpectedShape(result, step.verify);
          }

          context.steps[step.id] = {
            status: "succeeded",
            result,
          };
          this.#record(journalSteps, {
            id: step.id,
            server: step.server,
            operation: step.operation,
            tool: mapped.tool,
            status: "succeeded",
            startedAt: stepStartedAt.toISOString(),
            durationMs: elapsedMilliseconds(timerStarted),
            args: mapped.args,
            contractArgs,
            resultSummary: summarizeResult(result),
            ...(step.precondition === undefined
              ? {}
              : { precondition: step.precondition }),
            ...(step.note === undefined ? {} : { note: step.note }),
          });
        } catch (error) {
          this.#record(journalSteps, {
            id: step.id,
            server: step.server,
            operation: step.operation,
            ...(mappedTool === undefined ? {} : { tool: mappedTool }),
            status: "failed",
            startedAt: stepStartedAt.toISOString(),
            durationMs: elapsedMilliseconds(timerStarted),
            ...(mappedArgs === undefined ? {} : { args: mappedArgs }),
            ...(contractArgs === undefined ? {} : { contractArgs }),
            ...(step.precondition === undefined
              ? {}
              : { precondition: step.precondition }),
            ...(step.note === undefined ? {} : { note: step.note }),
            error: serializeError(error),
          });
          throw new ConductorEngineError(
            "STEP_FAILED",
            `Recipe '${recipe.id}' failed at step '${step.id}'`,
            {
              cause: error,
              details: {
                stepId: step.id,
                server: step.server,
                operation: step.operation,
                ...(mappedTool === undefined ? {} : { tool: mappedTool }),
              },
            },
          );
        }
      }
    } catch (error) {
      executionError = error;
      journal.status = "failed";
      journal.error = serializeError(error);
    } finally {
      journal.finishedAt = this.#now().toISOString();
    }

    const journalPath = await this.#journalWriter.write(journal);
    if (executionError !== undefined) {
      throw executionError;
    }

    return {
      runId,
      journalPath,
      outputs: Object.fromEntries(
        Object.entries(context.steps)
          .filter((entry) => entry[1].status === "succeeded")
          .map(([id, value]) => [id, value.result]),
      ),
    };
  }
}
