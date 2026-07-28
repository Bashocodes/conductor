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

  /**
   * How many keyframes one script may write.
   *
   * After Effects inserts a keyframe by walking the keys already on the
   * property, so writing a track costs quadratically in its length: measured on
   * a live host, 3869 keys took 10.1 s to write and a further 5.9 s to ease,
   * against the 20 s ceiling the bridge puts on a single script. Splitting does
   * not make the total cheaper — the last chunk still inserts into a full
   * property — but it keeps any ONE call far below the ceiling, which is the
   * only limit that exists.
   *
   * At this size the most expensive chunk of a 3869-key track measures around
   * 5 s, leaving room for a host that is busier than the one this was tuned on.
   *
   * The batch API that would make all of this unnecessary crashes After
   * Effects; see the warning in the prelude before reaching for it.
   */
  static readonly #keyframesPerCall = 800;

  public mapCalls(
    operation: ToolOperation,
    args: Record<string, JsonValue>,
    options: MapCallOptions = {},
  ): MappedToolCall[] {
    if (operation !== "setKeyframes" || options.allowUnresolvedReferences === true) {
      return [this.mapCall(operation, args, options)];
    }

    const keyframes = args["keyframes"];
    const limit = ScriptToolAdapter.#keyframesPerCall;
    if (!Array.isArray(keyframes) || keyframes.length <= limit) {
      return [this.mapCall(operation, args, options)];
    }

    const calls: MappedToolCall[] = [];
    for (let start = 0; start < keyframes.length; start += limit) {
      calls.push(
        this.mapCall(
          operation,
          { ...args, keyframes: keyframes.slice(start, start + limit) },
          options,
        ),
      );
    }
    return calls;
  }
}
