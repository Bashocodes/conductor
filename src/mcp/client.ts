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
        throw new ConductorMcpError(
          "TOOL_RETURNED_ERROR",
          `MCP tool '${this.serverName}.${tool}' returned an error`,
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
