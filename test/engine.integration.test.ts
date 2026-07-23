import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RecipeEngine } from "../src/engine/engine.js";
import { JournalWriter, type RunJournal } from "../src/engine/journal.js";
import type {
  DiscoveredTool,
  McpClientProvider,
  McpServerConnection,
} from "../src/mcp/types.js";
import type { JsonValue } from "../src/schema/recipe.js";

interface RecordedCall {
  tool: string;
  args: Record<string, JsonValue>;
  timeoutMs: number;
}

class FakeMcpServer implements McpServerConnection {
  public readonly serverName = "fake";
  public readonly calls: RecordedCall[] = [];

  public async listTools(): Promise<DiscoveredTool[]> {
    return [
      { name: "inspect", inputSchema: { type: "object" } },
      { name: "animate", inputSchema: { type: "object" } },
    ];
  }

  public async callTool(
    tool: string,
    args: Record<string, JsonValue>,
    timeoutMs: number,
  ): Promise<unknown> {
    this.calls.push({ tool, args, timeoutMs });

    if (tool === "inspect") {
      return {
        content: [{ type: "text", text: "ready" }],
        structuredContent: {
          layerId: "layer-7",
          ready: true,
        },
      };
    }

    if (tool === "animate") {
      return {
        content: [{ type: "text", text: "animated" }],
        structuredContent: {
          animatedLayerId: args.layerId,
        },
      };
    }

    throw new Error(`Unknown fake tool '${tool}'`);
  }

  public async close(): Promise<void> {}
}

class FakeClientProvider implements McpClientProvider {
  public readonly connection = new FakeMcpServer();

  public async get(serverName: string): Promise<McpServerConnection> {
    if (serverName !== "fake") {
      throw new Error(`Unexpected fake server '${serverName}'`);
    }
    return this.connection;
  }

  public async closeAll(): Promise<void> {
    await this.connection.close();
  }
}

const recipe = {
  id: "fake-animation",
  title: "Fake Animation",
  description: "Exercises sequential calls against an in-process fake server.",
  targetServers: ["fake"],
  params: {
    text: {
      type: "string",
      description: "Layer text.",
      default: "Conductor",
    },
    distance: {
      type: "number",
      description: "Animation distance.",
      default: 120,
    },
  },
  steps: [
    {
      id: "inspect",
      server: "fake",
      tool: "inspect",
      args: {
        text: "${params.text}",
      },
      timeoutMs: 500,
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["layerId", "ready"],
            properties: {
              layerId: { type: "string" },
              ready: { type: "boolean" },
            },
          },
        },
      },
    },
    {
      id: "animate",
      server: "fake",
      tool: "animate",
      args: {
        layerId: "${steps.inspect.result.structuredContent.layerId}",
        distance: "${params.distance}",
      },
      timeoutMs: 750,
      precondition: "${steps.inspect.result.structuredContent.ready} == true",
      verify: {
        type: "object",
        required: ["content"],
      },
    },
    {
      id: "fallback",
      server: "fake",
      tool: "animate",
      args: {
        layerId: "unused",
      },
      precondition: "${steps.inspect.result.structuredContent.ready} == false",
    },
  ],
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("RecipeEngine", () => {
  it("executes sequentially, interpolates outputs, gates steps, and journals calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "conductor-engine-"));
    temporaryDirectories.push(directory);
    const provider = new FakeClientProvider();
    const engine = new RecipeEngine({
      clientProvider: provider,
      journalWriter: new JournalWriter(directory),
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      createRunId: () => "run-test",
    });

    const availableTools = await provider.connection.listTools();
    expect(availableTools.map((tool) => tool.name)).toEqual([
      "inspect",
      "animate",
    ]);

    const result = await engine.run(recipe, {
      text: "Replay me",
    });

    expect(provider.connection.calls).toEqual([
      {
        tool: "inspect",
        args: { text: "Replay me" },
        timeoutMs: 500,
      },
      {
        tool: "animate",
        args: { layerId: "layer-7", distance: 120 },
        timeoutMs: 750,
      },
    ]);
    expect(result.outputs).toHaveProperty(
      "animate.structuredContent.animatedLayerId",
      "layer-7",
    );
    expect(result.journalPath).toBe(join(directory, "run-test.json"));

    const journal = JSON.parse(
      await readFile(result.journalPath, "utf8"),
    ) as RunJournal;
    expect(journal).toMatchObject({
      schemaVersion: 1,
      runId: "run-test",
      recipeId: "fake-animation",
      status: "completed",
      params: {
        text: "Replay me",
        distance: 120,
      },
    });
    expect(journal.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
      "skipped",
    ]);
    expect(journal.steps[1]).toMatchObject({
      id: "animate",
      server: "fake",
      tool: "animate",
      args: {
        layerId: "layer-7",
        distance: 120,
      },
      resultSummary: {
        structuredContent: {
          animatedLayerId: "layer-7",
        },
      },
    });
    expect(journal.steps.every((step) => step.durationMs >= 0)).toBe(true);
  });

  it("writes a structured failed journal when verification fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "conductor-failure-"));
    temporaryDirectories.push(directory);
    const provider = new FakeClientProvider();
    const engine = new RecipeEngine({
      clientProvider: provider,
      journalWriter: new JournalWriter(directory),
      createRunId: () => "run-failed",
    });
    const invalidVerificationRecipe = {
      ...recipe,
      steps: [
        {
          ...recipe.steps[0],
          verify: {
            type: "object",
            required: ["missing"],
          },
        },
      ],
    };

    await expect(engine.run(invalidVerificationRecipe, {})).rejects.toThrow(
      /failed at step 'inspect'/,
    );

    const journal = JSON.parse(
      await readFile(join(directory, "run-failed.json"), "utf8"),
    ) as RunJournal;
    expect(journal.status).toBe("failed");
    expect(journal.steps[0]).toMatchObject({
      id: "inspect",
      status: "failed",
      error: {
        code: "VERIFY_FAILED",
      },
    });
    expect(journal.error).toMatchObject({
      code: "STEP_FAILED",
    });
  });
});
