import type { JsonValue } from "../schema/recipe.js";

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpServerConnection {
  readonly serverName: string;
  listTools(): Promise<DiscoveredTool[]>;
  callTool(
    tool: string,
    args: Record<string, JsonValue>,
    timeoutMs: number,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpClientProvider {
  get(serverName: string): Promise<McpServerConnection>;
  closeAll(): Promise<void>;
}
