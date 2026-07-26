import type { JsonValue } from "../schema/recipe.js";
import { ConductorEngineError } from "./errors.js";

export interface ResolutionContext {
  params: Record<string, unknown>;
  steps: Record<
    string,
    {
      status: "succeeded" | "skipped";
      result?: unknown;
    }
  >;
}

export interface InterpolationOptions {
  preserveUnresolvedStepReferences?: boolean;
}

const referencePattern = /\$\{([^{}]+)\}/g;
const exactReferencePattern = /^\$\{([^{}]+)\}$/;

function splitPath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function resolveReference(
  reference: string,
  context: ResolutionContext,
): unknown {
  const segments = splitPath(reference);
  const root = segments.shift();

  if (root !== "params" && root !== "steps") {
    throw new ConductorEngineError(
      "INTERPOLATION_FAILED",
      `Reference '${reference}' must start with 'params' or 'steps'`,
    );
  }

  let value: unknown = context[root];
  for (const segment of segments) {
    if (
      value === null ||
      value === undefined ||
      (typeof value !== "object" && !Array.isArray(value))
    ) {
      throw new ConductorEngineError(
        "INTERPOLATION_FAILED",
        `Reference '${reference}' could not be resolved at '${segment}'`,
      );
    }

    if (!(segment in value)) {
      throw new ConductorEngineError(
        "INTERPOLATION_FAILED",
        `Reference '${reference}' does not exist`,
      );
    }
    value = (value as Record<string, unknown>)[segment];
  }

  return value;
}

export function referenceExists(
  reference: string,
  context: ResolutionContext,
): boolean {
  try {
    return resolveReference(reference, context) !== undefined;
  } catch (error) {
    if (
      error instanceof ConductorEngineError &&
      error.code === "INTERPOLATION_FAILED"
    ) {
      return false;
    }
    throw error;
  }
}

function resolveOrPreserve(
  reference: string,
  context: ResolutionContext,
  options: InterpolationOptions,
): unknown {
  try {
    return resolveReference(reference, context);
  } catch (error) {
    if (
      options.preserveUnresolvedStepReferences === true &&
      reference.trim().startsWith("steps.") &&
      error instanceof ConductorEngineError &&
      error.code === "INTERPOLATION_FAILED"
    ) {
      return `\${${reference}}`;
    }
    throw error;
  }
}

function interpolateString(
  value: string,
  context: ResolutionContext,
  options: InterpolationOptions,
): JsonValue {
  const exactMatch = exactReferencePattern.exec(value);
  if (exactMatch !== null) {
    const reference = exactMatch[1];
    if (reference === undefined) {
      return value;
    }
    const resolved = resolveOrPreserve(reference.trim(), context, options);
    if (
      resolved === undefined ||
      typeof resolved === "bigint" ||
      typeof resolved === "symbol" ||
      typeof resolved === "function"
    ) {
      throw new ConductorEngineError(
        "INTERPOLATION_FAILED",
        `Reference '${reference}' did not resolve to a JSON value`,
      );
    }
    return resolved as JsonValue;
  }

  return value.replace(referencePattern, (_match, rawReference: string) => {
    const reference = rawReference.trim();
    const resolved = resolveOrPreserve(reference, context, options);

    if (
      resolved !== null &&
      typeof resolved === "object" &&
      !(
        options.preserveUnresolvedStepReferences === true &&
        typeof resolved === "string"
      )
    ) {
      throw new ConductorEngineError(
        "INTERPOLATION_FAILED",
        `Embedded reference '${reference}' must resolve to a primitive value`,
      );
    }

    return String(resolved);
  });
}

export function interpolateValue(
  value: JsonValue,
  context: ResolutionContext,
  options: InterpolationOptions = {},
): JsonValue {
  if (typeof value === "string") {
    return interpolateString(value, context, options);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, context, options));
  }

  if (value !== null && typeof value === "object") {
    if ("$select" in value) {
      const selector = interpolateValue(value.$select, context, options);
      const cases = value.cases;
      if (
        typeof selector !== "string" ||
        cases === null ||
        typeof cases !== "object" ||
        Array.isArray(cases)
      ) {
        throw new ConductorEngineError(
          "INTERPOLATION_FAILED",
          "A $select expression requires a string selector and an object of cases",
        );
      }
      if (!(selector in cases)) {
        throw new ConductorEngineError(
          "INTERPOLATION_FAILED",
          `Selection '${selector}' has no matching case`,
        );
      }
      return interpolateValue(cases[selector] as JsonValue, context, options);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        interpolateValue(item, context, options),
      ]),
    );
  }

  return value;
}

export function interpolateArgs(
  args: Record<string, JsonValue>,
  context: ResolutionContext,
  options: InterpolationOptions = {},
): Record<string, JsonValue> {
  return interpolateValue(args, context, options) as Record<string, JsonValue>;
}
