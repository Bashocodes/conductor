import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { ConductorMcpError } from "../mcp/errors.js";
import type { McpClientProvider } from "../mcp/types.js";
import type { JsonValue } from "../schema/recipe.js";
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
  type RunJournal,
} from "./journal.js";
import { evaluatePrecondition } from "./precondition.js";
import { verifyExpectedShape } from "./verify.js";

export interface EngineOptions {
  clientProvider: McpClientProvider;
  journalWriter?: JournalWriter;
  now?: () => Date;
  createRunId?: (recipeId: string, startedAt: Date) => string;
}

export interface RunResult {
  runId: string;
  journalPath: string;
  outputs: Record<string, unknown>;
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
  readonly #journalWriter: JournalWriter;
  readonly #now: () => Date;
  readonly #createRunId: (recipeId: string, startedAt: Date) => string;

  public constructor(options: EngineOptions) {
    this.#clientProvider = options.clientProvider;
    this.#journalWriter = options.journalWriter ?? new JournalWriter();
    this.#now = options.now ?? (() => new Date());
    this.#createRunId = options.createRunId ?? defaultRunId;
  }

  public async run(
    recipeInput: unknown,
    suppliedParams: Record<string, unknown>,
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
      steps: journalSteps,
    };

    try {
      for (const step of recipe.steps) {
        const stepStartedAt = this.#now();
        const timerStarted = performance.now();

        if (
          step.precondition !== undefined &&
          !evaluatePrecondition(step.precondition, context)
        ) {
          context.steps[step.id] = { status: "skipped" };
          journalSteps.push({
            id: step.id,
            server: step.server,
            tool: step.tool,
            status: "skipped",
            startedAt: stepStartedAt.toISOString(),
            durationMs: elapsedMilliseconds(timerStarted),
            precondition: step.precondition,
          });
          continue;
        }

        let resolvedArgs: Record<string, JsonValue> | undefined;
        try {
          resolvedArgs = interpolateArgs(step.args, context);
          const connection = await this.#clientProvider.get(step.server);
          const result = await withTimeout(
            connection.callTool(step.tool, resolvedArgs, step.timeoutMs),
            step.timeoutMs,
            step.server,
            step.tool,
          );

          if (step.verify !== undefined) {
            verifyExpectedShape(result, step.verify);
          }

          context.steps[step.id] = {
            status: "succeeded",
            result,
          };
          journalSteps.push({
            id: step.id,
            server: step.server,
            tool: step.tool,
            status: "succeeded",
            startedAt: stepStartedAt.toISOString(),
            durationMs: elapsedMilliseconds(timerStarted),
            args: resolvedArgs,
            resultSummary: summarizeResult(result),
            ...(step.precondition === undefined
              ? {}
              : { precondition: step.precondition }),
          });
        } catch (error) {
          journalSteps.push({
            id: step.id,
            server: step.server,
            tool: step.tool,
            status: "failed",
            startedAt: stepStartedAt.toISOString(),
            durationMs: elapsedMilliseconds(timerStarted),
            ...(resolvedArgs === undefined ? {} : { args: resolvedArgs }),
            ...(step.precondition === undefined
              ? {}
              : { precondition: step.precondition }),
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
                tool: step.tool,
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
