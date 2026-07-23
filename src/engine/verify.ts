import type { ExpectedShape } from "../schema/recipe.js";
import { ConductorEngineError } from "./errors.js";

function actualType(value: unknown): ExpectedShape["type"] | "undefined" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "undefined";
}

function assertAtPath(
  value: unknown,
  shape: ExpectedShape,
  path: string,
): void {
  const received = actualType(value);
  if (received !== shape.type) {
    throw new ConductorEngineError(
      "VERIFY_FAILED",
      `Expected ${path} to be ${shape.type}, received ${received}`,
      { details: { path, expected: shape.type, received } },
    );
  }

  if (shape.type === "object") {
    const object = value as Record<string, unknown>;
    for (const key of shape.required ?? []) {
      if (!(key in object)) {
        throw new ConductorEngineError(
          "VERIFY_FAILED",
          `Expected ${path} to contain required property '${key}'`,
          { details: { path, missing: key } },
        );
      }
    }
    for (const [key, childShape] of Object.entries(shape.properties ?? {})) {
      if (key in object) {
        assertAtPath(object[key], childShape, `${path}.${key}`);
      }
    }
  }

  if (shape.type === "array" && shape.items !== undefined) {
    (value as unknown[]).forEach((item, index) => {
      assertAtPath(item, shape.items as ExpectedShape, `${path}[${index}]`);
    });
  }
}

export function verifyExpectedShape(
  value: unknown,
  shape: ExpectedShape,
): void {
  assertAtPath(value, shape, "result");
}
