#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import { createDryRunPlan, RecipeEngine } from "./engine/index.js";
import { McpClientManager } from "./mcp/client.js";
import {
  ConductorConfigError,
  loadConductorConfig,
} from "./mcp/config.js";
import { listRecipes, getRecipe } from "./recipes/index.js";
import type { ParamDefinition } from "./schema/recipe.js";
import { createAdapterRegistryFromConfig } from "./adapters/registry.js";

interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

function parseParamValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseParamAssignments(
  assignments: string[],
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      throw new InvalidArgumentError(
        `Invalid parameter '${assignment}'; expected key=value`,
      );
    }

    const key = assignment.slice(0, separator).trim();
    const rawValue = assignment.slice(separator + 1);
    if (key === "") {
      throw new InvalidArgumentError("Parameter names cannot be empty");
    }
    params[key] = parseParamValue(rawValue);
  }

  return params;
}

function collectParam(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function describeParam(definition: ParamDefinition): string {
  const defaultText =
    definition.default === undefined
      ? "required"
      : `default=${JSON.stringify(definition.default)}`;
  const type =
    definition.type === "enum"
      ? `enum(${definition.values.join("|")})`
      : definition.type;
  return `${type}; ${defaultText} — ${definition.description}`;
}

function formatError(error: unknown): string {
  if (error instanceof ConductorConfigError) {
    const details =
      error.details === undefined
        ? ""
        : `\n${JSON.stringify(error.details, null, 2)}`;
    return `${error.code}: ${error.message}${details}`;
  }

  if (error instanceof Error) {
    const coded = error as Error & {
      code?: unknown;
      details?: unknown;
    };
    const prefix =
      typeof coded.code === "string" ? `${coded.code}: ` : "";
    const details =
      coded.details === undefined
        ? ""
        : `\n${JSON.stringify(coded.details, null, 2)}`;
    return `${prefix}${error.message}${details}`;
  }

  return String(error);
}

export function createProgram(
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Command {
  const program = new Command();
  program
    .name("conductor")
    .description(
      "Run deterministic motion-design recipes over MCP-enabled creative tools.",
    )
    .version("0.1.0")
    .option(
      "-c, --config <path>",
      "path to conductor.config.json",
      "conductor.config.json",
    )
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    });

  program
    .command("recipes")
    .description("List registered recipes and their parameters")
    .action(() => {
      for (const recipe of listRecipes()) {
        io.stdout.write(
          `${recipe.id} — ${recipe.title}\n  ${recipe.description}\n`,
        );
        for (const [name, definition] of Object.entries(recipe.params)) {
          io.stdout.write(`  --param ${name}=…  ${describeParam(definition)}\n`);
        }
      }
    });

  program
    .command("run")
    .description("Run a registered recipe")
    .argument("<recipe>", "registered recipe id")
    .option("--dry-run", "resolve and print the plan without connecting")
    .option(
      "--param <key=value>",
      "recipe parameter; repeat for multiple parameters",
      collectParam,
      [],
    )
    .action(
      async (
        recipeId: string,
        options: { dryRun?: boolean; param: string[] },
        command: Command,
      ) => {
        const recipe = getRecipe(recipeId);
        if (recipe === undefined) {
          throw new InvalidArgumentError(
            `Unknown recipe '${recipeId}'. Run 'conductor recipes' to list recipes.`,
          );
        }

        const params = parseParamAssignments(options.param);
        if (options.dryRun === true) {
          io.stdout.write(
            `${JSON.stringify(createDryRunPlan(recipe, params), null, 2)}\n`,
          );
          return;
        }

        const globalOptions = command.optsWithGlobals<{
          config: string;
        }>();
        const config = await loadConductorConfig(globalOptions.config);
        const clients = new McpClientManager(config);
        const adapters = createAdapterRegistryFromConfig(config);
        try {
          const result = await new RecipeEngine({
            clientProvider: clients,
            adapters,
          }).run(recipe, params);
          io.stdout.write(
            `Run ${result.runId} completed.\nJournal: ${result.journalPath}\n`,
          );
        } finally {
          await clients.closeAll();
        }
      },
    );

  program
    .command("doctor")
    .description("Validate config, connect to each server, and list its tools")
    .action(async (_options: unknown, command: Command) => {
      const globalOptions = command.optsWithGlobals<{
        config: string;
      }>();
      const config = await loadConductorConfig(globalOptions.config);
      const clients = new McpClientManager(config);
      const failures: string[] = [];

      try {
        for (const serverName of clients.serverNames) {
          try {
            const connection = await clients.get(serverName);
            const tools = await connection.listTools();
            const names = tools.map((tool) => tool.name).join(", ");
            io.stdout.write(
              `✓ ${serverName}: ${tools.length} tool(s)${names === "" ? "" : ` — ${names}`}\n`,
            );
          } catch (error) {
            failures.push(serverName);
            io.stderr.write(`✗ ${serverName}: ${formatError(error)}\n`);
          }
        }
      } finally {
        await clients.closeAll();
      }

      if (failures.length > 0) {
        throw new Error(
          `Doctor found ${failures.length} unavailable server(s): ${failures.join(", ")}`,
        );
      }
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
