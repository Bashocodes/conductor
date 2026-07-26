import {
  AdapterRegistry,
  fakeServerAdapterConfig,
} from "../../src/adapters/index.js";
import type {
  DiscoveredTool,
  McpClientProvider,
  McpServerConnection,
} from "../../src/mcp/types.js";
import type { JsonValue } from "../../src/schema/recipe.js";

export interface RecordedCall {
  tool: string;
  args: Record<string, JsonValue>;
  timeoutMs: number;
}

export class FakeAeServer implements McpServerConnection {
  public readonly serverName = "aftereffects";
  public readonly calls: RecordedCall[] = [];
  public invalidQueueResult = false;

  #compCount = 0;
  #layerCount = 0;
  #effectCount = 0;
  #renderCount = 0;

  public async listTools(): Promise<DiscoveredTool[]> {
    // The fake mirrors a granular-tool server, so it always has an operations map.
    const operations =
      fakeServerAdapterConfig.kind === "declarative"
        ? fakeServerAdapterConfig.operations
        : {};
    return Object.values(operations).map((mapping) => ({
      name: mapping.tool,
      inputSchema: { type: "object" },
    }));
  }

  public async callTool(
    tool: string,
    args: Record<string, JsonValue>,
    timeoutMs: number,
  ): Promise<unknown> {
    this.calls.push({ tool, args, timeoutMs });

    switch (tool) {
      case "fake_project_info":
        return {
          structuredContent:
            args.action === "inspect" && typeof args.mediaPath === "string"
              ? {
                  width: 3840,
                  height: 2160,
                  frameRate: 25,
                  durationSeconds: 12,
                  sourceColorSpace: "Rec.709 Gamma 2.4",
                }
              : {
                  projectOpen: true,
                  configured: args.action === "configure",
                  workingSpace:
                    typeof args.settings === "object" &&
                    args.settings !== null &&
                    !Array.isArray(args.settings) &&
                    typeof args.settings.workingSpace === "string"
                      ? args.settings.workingSpace
                      : "Rec.709",
                  bitsPerChannel: 32,
                  refused: [],
                },
        };
      case "fake_create_comp":
        this.#compCount += 1;
        return {
          structuredContent: {
            compId: `comp-${this.#compCount}`,
          },
        };
      case "fake_add_text_layer":
        this.#layerCount += 1;
        return {
          structuredContent: {
            layerId: `text-${this.#layerCount}`,
          },
        };
      case "fake_precompose":
        this.#layerCount += 1;
        return {
          structuredContent: {
            layerId: `precomp-layer-${this.#layerCount}`,
            precompId: `precomp-${this.#layerCount}`,
          },
        };
      case "fake_apply_effect":
        this.#effectCount += 1;
        const settingCount =
          typeof args.settings === "object" &&
          args.settings !== null &&
          !Array.isArray(args.settings)
            ? Object.keys(args.settings).length
            : 0;
        return {
          structuredContent: {
            effectId: `effect-${this.#effectCount}`,
            applied: true,
            requestedParameterCount: settingCount,
            appliedParameterCount: settingCount,
            refusedParameters: [],
          },
        };
      case "fake_set_keyframes":
        return {
          structuredContent: {
            applied: true,
            property: args.property,
          },
        };
      case "fake_queue_render":
        this.#renderCount += 1;
        return {
          structuredContent: this.invalidQueueResult
            ? {
                queued: false,
                outputPath: args.outputPath,
              }
            : {
                queued: true,
                outputPath: args.outputPath,
                renderPath:
                  args.postProcess === "hevc-hlg"
                    ? String(args.outputPath).replace(/\.[^./]+$/, "") +
                      ".conductor-intermediate.mov"
                    : args.outputPath,
                renderQueueIndex: this.#renderCount,
                templateApplied:
                  typeof args.outputModuleTemplate === "string"
                    ? args.outputModuleTemplate
                    : null,
                ...(args.postProcess === "hevc-hlg"
                  ? { postProcess: "hevc-hlg" }
                  : {}),
              },
        };
      default:
        throw new Error(`Unknown fake AE tool '${tool}'`);
    }
  }

  public async close(): Promise<void> {}
}

export class FakeAeClientProvider implements McpClientProvider {
  public readonly connection = new FakeAeServer();

  public async get(serverName: string): Promise<McpServerConnection> {
    if (serverName !== "aftereffects") {
      throw new Error(`Unexpected fake server '${serverName}'`);
    }
    return this.connection;
  }

  public async closeAll(): Promise<void> {
    await this.connection.close();
  }
}

export function createFakeAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry({
    aftereffects: fakeServerAdapterConfig,
  });
}
