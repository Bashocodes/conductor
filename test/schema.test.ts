import { describe, expect, it } from "vitest";

import {
  buildParamsSchema,
  recipeSchema,
} from "../src/schema/recipe.js";

const validRecipe = {
  id: "title-card",
  title: "Title Card",
  description: "Creates a deterministic title card.",
  targetServers: ["aftereffects"],
  params: {
    text: {
      type: "string",
      description: "Title text.",
      default: "Hello",
      minLength: 1,
    },
    duration: {
      type: "number",
      description: "Duration in frames.",
      integer: true,
      min: 1,
    },
  },
  steps: [
    {
      id: "create-title",
      server: "aftereffects",
      operation: "projectInfo",
      args: {
        action: "inspect",
        settings: {},
      },
      verify: {
        type: "object",
        required: ["content"],
      },
    },
  ],
} as const;

describe("recipeSchema", () => {
  it("accepts a valid data-only recipe and applies step defaults", () => {
    const recipe = recipeSchema.parse(validRecipe);

    expect(recipe.steps[0]?.timeoutMs).toBe(30_000);
    expect(recipe.params.text?.description).toBe("Title text.");
  });

  it("rejects duplicate steps and servers outside targetServers", () => {
    const result = recipeSchema.safeParse({
      ...validRecipe,
      steps: [
        validRecipe.steps[0],
        {
          ...validRecipe.steps[0],
          server: "photoshop",
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "duplicate step id 'create-title'",
          "server 'photoshop' is not declared in targetServers",
        ]),
      );
    }
  });

  it("rejects an invalid enum default", () => {
    const result = recipeSchema.safeParse({
      ...validRecipe,
      params: {
        easing: {
          type: "enum",
          description: "Easing preset.",
          values: ["smooth", "snappy"],
          default: "linear",
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "default must be one of the enum values",
      );
    }
  });

  it("rejects defaults that violate their declared constraints", () => {
    const result = recipeSchema.safeParse({
      ...validRecipe,
      params: {
        frames: {
          type: "number",
          description: "Frame count.",
          integer: true,
          min: 1,
          default: 0.5,
        },
        color: {
          type: "string",
          description: "Hex color.",
          pattern: "^#[0-9A-F]{6}$",
          default: "red",
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "default must be an integer",
          "default cannot be less than min",
          "default does not match pattern",
        ]),
      );
    }
  });

  it("rejects executable or unknown step fields", () => {
    const result = recipeSchema.safeParse({
      ...validRecipe,
      steps: [
        {
          ...validRecipe.steps[0],
          shell: "open -a 'After Effects'",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("buildParamsSchema", () => {
  it("applies defaults and rejects missing required or unknown params", () => {
    const recipe = recipeSchema.parse(validRecipe);
    const paramsSchema = buildParamsSchema(recipe.params);

    expect(paramsSchema.parse({ duration: 48 })).toEqual({
      text: "Hello",
      duration: 48,
    });
    expect(paramsSchema.safeParse({}).success).toBe(false);
    expect(
      paramsSchema.safeParse({ duration: 48, surprise: true }).success,
    ).toBe(false);
  });
});
