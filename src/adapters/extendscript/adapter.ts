import type { JsonValue } from "../../schema/json.js";
import { AdapterError, type MapCallOptions, type MappedToolCall, type ToolAdapter } from "../adapter.js";
import type { ScriptAdapterConfig } from "../config.js";
import { parseToolArgs, type ToolArgs, type ToolOperation } from "../toolContract.js";
import { renderAeScript } from "./operations.js";

/**
 * An adapter for MCP servers that expose a single "run this script" tool
 * rather than one tool per operation.
 *
 * The After Effects servers in the wild take this shape: the whole surface is
 * `execute_extend_script(script_string)`. A declarative JSON adapter cannot
 * drive them, because mapping an operation onto that tool means *generating a
 * program*, and because arguments like a keyframe list are arrays that no
 * string template can serialize.
 */
export class ScriptToolAdapter implements ToolAdapter {
  public readonly serverName: string;
  public readonly config: ScriptAdapterConfig;

  public constructor(serverName: string, config: ScriptAdapterConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  public get id(): string {
    return this.config.id;
  }

  public get label(): string {
    return this.config.label;
  }

  public mapCall(
    operation: ToolOperation,
    args: Record<string, JsonValue>,
    options: MapCallOptions = {},
  ): MappedToolCall {
    if (options.allowUnresolvedReferences === true) {
      // A dry run cannot render a script from placeholders, so report the
      // operation and the tool it would reach without inventing a program.
      return {
        operation,
        tool: this.config.tool,
        args: { [this.config.scriptArgument]: `/* ${operation}: rendered at run time */` },
      };
    }

    let parsed: ToolArgs<ToolOperation>;
    try {
      parsed = parseToolArgs(operation, args);
    } catch (error) {
      throw new AdapterError(
        "OPERATION_ARGS_INVALID",
        `Arguments for ToolContract operation '${operation}' failed validation`,
        { cause: error },
      );
    }

    let script: string;
    try {
      script = renderAeScript(operation, parsed as never);
    } catch (error) {
      throw new AdapterError(
        "ARG_TEMPLATE_INVALID",
        `Adapter '${this.config.id}' could not render a script for '${operation}'`,
        { cause: error, details: { server: this.serverName, operation } },
      );
    }

    return {
      operation,
      tool: this.config.tool,
      args: { [this.config.scriptArgument]: script },
    };
  }
}
