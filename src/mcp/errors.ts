export type McpErrorCode =
  | "SERVER_NOT_CONFIGURED"
  | "CONNECT_FAILED"
  | "LIST_TOOLS_FAILED"
  | "TOOL_CALL_FAILED"
  | "TOOL_TIMEOUT"
  | "TOOL_RETURNED_ERROR";

export interface McpErrorContext {
  server: string;
  tool?: string;
  timeoutMs?: number;
  details?: unknown;
}

export class ConductorMcpError extends Error {
  public readonly code: McpErrorCode;
  public readonly context: McpErrorContext;

  public constructor(
    code: McpErrorCode,
    message: string,
    context: McpErrorContext,
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ConductorMcpError";
    this.code = code;
    this.context = context;
  }

  public toJSON(): {
    name: string;
    code: McpErrorCode;
    message: string;
    context: McpErrorContext;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
