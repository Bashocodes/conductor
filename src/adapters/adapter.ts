import type { JsonValue } from "../schema/json.js";
import {
  adapterConfigSchema,
  type AdapterConfig,
} from "./config.js";
import {
  parseToolArgs,
  type ToolOperation,
} from "./toolContract.js";

export type AdapterErrorCode =
  | "ADAPTER_INVALID"
  | "OPERATION_NOT_MAPPED"
  | "OPERATION_ARGS_INVALID"
  | "ARG_TEMPLATE_INVALID";

export class AdapterError extends Error {
  public readonly code: AdapterErrorCode;
  public readonly details?: unknown;

  public constructor(
    code: AdapterErrorCode,
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AdapterError";
    this.code = code;
    this.details = options?.details;
  }
}

export interface MappedToolCall {
  operation: ToolOperation;
  tool: string;
  args: Record<string, JsonValue>;
}

export interface MapCallOptions {
  allowUnresolvedReferences?: boolean;
}

const omitted = Symbol("omitted");
const exactReferencePattern = /^\$\{args(?:\.([^{}]+))?\}$/;
const embeddedReferencePattern = /\$\{args(?:\.([^{}]+))?\}/g;

function getPath(
  args: Record<string, JsonValue>,
  path: string | undefined,
): JsonValue | typeof omitted {
  if (path === undefined || path === "") return args;

  let value: JsonValue = args;
  for (const segment of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (
      value === null ||
      typeof value !== "object" ||
      !(segment in value)
    ) {
      return omitted;
    }
    value = (value as Record<string, JsonValue>)[segment] as JsonValue;
  }
  return value;
}

function applyTemplate(
  template: JsonValue,
  args: Record<string, JsonValue>,
): JsonValue | typeof omitted {
  if (typeof template === "string") {
    const exact = exactReferencePattern.exec(template);
    if (exact !== null) {
      return getPath(args, exact[1]);
    }

    return template.replace(
      embeddedReferencePattern,
      (_match, path: string | undefined) => {
        const value = getPath(args, path);
        if (
          value === omitted ||
          (value !== null && typeof value === "object")
        ) {
          throw new AdapterError(
            "ARG_TEMPLATE_INVALID",
            `Embedded adapter reference '${path ?? "args"}' must resolve to a primitive`,
          );
        }
        return String(value);
      },
    );
  }

  if (Array.isArray(template)) {
    return template
      .map((item) => applyTemplate(item, args))
      .filter((item): item is JsonValue => item !== omitted);
  }

  if (template !== null && typeof template === "object") {
    const entries: [string, JsonValue][] = [];
    for (const [key, value] of Object.entries(template)) {
      const mapped = applyTemplate(value, args);
      if (mapped !== omitted) entries.push([key, mapped]);
    }
    return Object.fromEntries(entries);
  }

  return template;
}

export class DeclarativeToolAdapter {
  public readonly serverName: string;
  public readonly config: AdapterConfig;

  public constructor(serverName: string, configInput: unknown) {
    const parsed = adapterConfigSchema.safeParse(configInput);
    if (!parsed.success) {
      throw new AdapterError(
        "ADAPTER_INVALID",
        `Adapter config for server '${serverName}' failed validation`,
        { details: parsed.error.issues },
      );
    }

    this.serverName = serverName;
    this.config = parsed.data;
  }

  public mapCall(
    operation: ToolOperation,
    args: Record<string, JsonValue>,
    options: MapCallOptions = {},
  ): MappedToolCall {
    const mapping = this.config.operations[operation];
    if (mapping === undefined) {
      throw new AdapterError(
        "OPERATION_NOT_MAPPED",
        `Adapter '${this.config.id}' does not map ToolContract operation '${operation}'`,
        { details: { server: this.serverName, operation } },
      );
    }

    let normalizedArgs = args;
    if (options.allowUnresolvedReferences !== true) {
      try {
        normalizedArgs = parseToolArgs(
          operation,
          args,
        ) as Record<string, JsonValue>;
      } catch (error) {
        throw new AdapterError(
          "OPERATION_ARGS_INVALID",
          `Arguments for ToolContract operation '${operation}' failed validation`,
          { cause: error },
        );
      }
    }

    const mapped = applyTemplate(mapping.argsTemplate, normalizedArgs);
    if (
      mapped === omitted ||
      mapped === null ||
      Array.isArray(mapped) ||
      typeof mapped !== "object"
    ) {
      throw new AdapterError(
        "ARG_TEMPLATE_INVALID",
        `Adapter '${this.config.id}' must map '${operation}' arguments to an object`,
      );
    }

    return {
      operation,
      tool: mapping.tool,
      args: mapped,
    };
  }
}
