import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { JsonValue } from "../schema/recipe.js";
import type { ConductorConfig, ServerConfig } from "./config.js";
import { ConductorMcpError, errorMessage } from "./errors.js";
import type {
  DiscoveredTool,
  McpClientProvider,
  McpServerConnection,
} from "./types.js";

const CLIENT_INFO = {
  name: "conductor",
  version: "0.1.0",
} as const;

type SupportedTransport = StdioClientTransport | StreamableHTTPClientTransport;

function createTransport(config: ServerConfig): SupportedTransport {
  if (config.transport === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env:
        config.env === undefined
          ? undefined
          : { ...getDefaultEnvironment(), ...config.env },
    });
  }

  return new StreamableHTTPClientTransport(new URL(config.url));
}

class SdkMcpServerConnection implements McpServerConnection {
  public readonly serverName: string;
  readonly #client: Client;

  public constructor(serverName: string, client: Client) {
    this.serverName = serverName;
    this.#client = client;
  }

  public async listTools(): Promise<DiscoveredTool[]> {
    const tools: DiscoveredTool[] = [];
    let cursor: string | undefined;

    try {
      do {
        const response = await this.#client.listTools(
          cursor === undefined ? undefined : { cursor },
        );
        tools.push(
          ...response.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined
              ? {}
              : { description: tool.description }),
            inputSchema: tool.inputSchema,
          })),
        );
        cursor = response.nextCursor;
      } while (cursor !== undefined);

      return tools;
    } catch (error) {
      throw new ConductorMcpError(
        "LIST_TOOLS_FAILED",
        `Failed to list tools from MCP server '${this.serverName}': ${errorMessage(error)}`,
        { server: this.serverName },
        { cause: error },
      );
    }
  }

  /**
   * The readable part of an MCP error result.
   *
   * A host reports a failure as content blocks rather than as a thrown error,
   * so without this the caller sees only that "an error" occurred. Bounded,
   * because a script host will happily hand back a whole stack trace.
   */
  static #errorText(content: unknown): string | undefined {
    if (!Array.isArray(content)) return undefined;
    const parts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text.trim());
      }
    }
    const joined = parts.filter((part) => part.length > 0).join(" ");
    if (joined.length === 0) return undefined;
    return joined.length > 500 ? `${joined.slice(0, 500)}…` : joined;
  }

  public async callTool(
    tool: string,
    args: Record<string, JsonValue>,
    timeoutMs: number,
  ): Promise<unknown> {
    try {
      const result = await this.#client.callTool(
        {
          name: tool,
          arguments: args,
        },
        undefined,
        { timeout: timeoutMs },
      );

      if (result.isError === true) {
        /* The host's own words only lived in `details`, which the journal does
           not print, so every host-side failure read as the same four words no
           matter what actually went wrong. Carry the text into the message. */
        const hostText = SdkMcpServerConnection.#errorText(result.content);
        throw new ConductorMcpError(
          "TOOL_RETURNED_ERROR",
          hostText === undefined
            ? `MCP tool '${this.serverName}.${tool}' returned an error`
            : `MCP tool '${this.serverName}.${tool}' returned an error: ${hostText}`,
          {
            server: this.serverName,
            tool,
            details: result.content,
          },
        );
      }

      return result;
    } catch (error) {
      if (error instanceof ConductorMcpError) {
        throw error;
      }

      const message = errorMessage(error);
      const timedOut = /timed?\s*out|timeout/i.test(message);
      throw new ConductorMcpError(
        timedOut ? "TOOL_TIMEOUT" : "TOOL_CALL_FAILED",
        timedOut
          ? `MCP tool '${this.serverName}.${tool}' timed out after ${timeoutMs}ms`
          : `MCP tool '${this.serverName}.${tool}' failed: ${message}`,
        {
          server: this.serverName,
          tool,
          timeoutMs,
        },
        { cause: error },
      );
    }
  }

  public async close(): Promise<void> {
    await this.#client.close();
  }
}

export class McpClientManager implements McpClientProvider {
  readonly #config: ConductorConfig;
  readonly #connections = new Map<
    string,
    Promise<McpServerConnection>
  >();

  public constructor(config: ConductorConfig) {
    this.#config = config;
  }

  public get serverNames(): string[] {
    return Object.keys(this.#config.servers);
  }

  public async get(serverName: string): Promise<McpServerConnection> {
    const existing = this.#connections.get(serverName);
    if (existing !== undefined) {
      return existing;
    }

    const serverConfig = this.#config.servers[serverName];
    if (serverConfig === undefined) {
      throw new ConductorMcpError(
        "SERVER_NOT_CONFIGURED",
        `MCP server '${serverName}' is not present in conductor.config.json`,
        { server: serverName },
      );
    }

    const pending = this.#connect(serverName, serverConfig);
    this.#connections.set(serverName, pending);

    try {
      return await pending;
    } catch (error) {
      this.#connections.delete(serverName);
      throw error;
    }
  }

  async #connect(
    serverName: string,
    config: ServerConfig,
  ): Promise<McpServerConnection> {
    const client = new Client(CLIENT_INFO);

    try {
      await client.connect(createTransport(config));
      return new SdkMcpServerConnection(serverName, client);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new ConductorMcpError(
        "CONNECT_FAILED",
        `Failed to connect to MCP server '${serverName}': ${errorMessage(error)}`,
        { server: serverName },
        { cause: error },
      );
    }
  }

  public async closeAll(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();

    await Promise.allSettled(
      connections.map(async (pending) => {
        const connection = await pending;
        await connection.close();
      }),
    );
  }
}
