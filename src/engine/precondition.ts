import type { ResolutionContext } from "./interpolation.js";
import { referenceExists, resolveReference } from "./interpolation.js";
import { ConductorEngineError } from "./errors.js";

type ComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";

function unwrapReference(value: string): string | undefined {
  const trimmed = value.trim();
  const interpolation = /^\$\{([^{}]+)\}$/.exec(trimmed);
  if (interpolation?.[1] !== undefined) {
    return interpolation[1].trim();
  }

  if (trimmed.startsWith("params.") || trimmed.startsWith("steps.")) {
    return trimmed;
  }

  return undefined;
}

function parseLiteral(value: string): unknown {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("'") &&
    trimmed.endsWith("'") &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new ConductorEngineError(
      "PRECONDITION_INVALID",
      `Invalid precondition operand '${trimmed}'`,
    );
  }
}

function resolveOperand(value: string, context: ResolutionContext): unknown {
  const reference = unwrapReference(value);
  return reference === undefined
    ? parseLiteral(value)
    : resolveReference(reference, context);
}

function compare(
  left: unknown,
  operator: ComparisonOperator,
  right: unknown,
): boolean {
  switch (operator) {
    case "==":
      return Object.is(left, right);
    case "!=":
      return !Object.is(left, right);
    case ">":
    case ">=":
    case "<":
    case "<=": {
      if (
        !(
          (typeof left === "number" && typeof right === "number") ||
          (typeof left === "string" && typeof right === "string")
        )
      ) {
        throw new ConductorEngineError(
          "PRECONDITION_INVALID",
          `Operator '${operator}' requires two numbers or two strings`,
        );
      }

      if (operator === ">") return left > right;
      if (operator === ">=") return left >= right;
      if (operator === "<") return left < right;
      return left <= right;
    }
  }
}

export function evaluatePrecondition(
  expression: string,
  context: ResolutionContext,
): boolean {
  const trimmed = expression.trim();
  const existsMatch = /^(!)?exists\((.+)\)$/.exec(trimmed);
  if (existsMatch !== null) {
    const referenceSource = existsMatch[2];
    if (referenceSource === undefined) {
      throw new ConductorEngineError(
        "PRECONDITION_INVALID",
        `Invalid exists expression '${expression}'`,
      );
    }
    const reference = unwrapReference(referenceSource);
    if (reference === undefined) {
      throw new ConductorEngineError(
        "PRECONDITION_INVALID",
        "exists() requires a params.* or steps.* reference",
      );
    }
    const exists = referenceExists(reference, context);
    return existsMatch[1] === "!" ? !exists : exists;
  }

  const comparison = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*?)$/.exec(trimmed);
  if (comparison !== null) {
    const leftSource = comparison[1];
    const operator = comparison[2] as ComparisonOperator | undefined;
    const rightSource = comparison[3];
    if (
      leftSource === undefined ||
      operator === undefined ||
      rightSource === undefined ||
      leftSource.trim() === "" ||
      rightSource.trim() === ""
    ) {
      throw new ConductorEngineError(
        "PRECONDITION_INVALID",
        `Invalid comparison '${expression}'`,
      );
    }
    return compare(
      resolveOperand(leftSource, context),
      operator,
      resolveOperand(rightSource, context),
    );
  }

  const reference = unwrapReference(trimmed);
  if (reference !== undefined) {
    return Boolean(resolveReference(reference, context));
  }

  const literal = parseLiteral(trimmed);
  if (typeof literal !== "boolean") {
    throw new ConductorEngineError(
      "PRECONDITION_INVALID",
      "A precondition without an operator must resolve to a boolean",
    );
  }
  return literal;
}
