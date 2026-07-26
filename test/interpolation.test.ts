import { describe, expect, it } from "vitest";

import {
  interpolateArgs,
  resolveReference,
  type ResolutionContext,
} from "../src/engine/interpolation.js";
import { evaluatePrecondition } from "../src/engine/precondition.js";

const context: ResolutionContext = {
  params: {
    text: "Hello",
    frames: 72,
    enabled: true,
  },
  steps: {
    inspect: {
      status: "succeeded",
      result: {
        ready: true,
        count: 3,
        layers: [{ id: "layer-1" }],
      },
    },
  },
};

describe("interpolation", () => {
  it("selects preset values from an enum parameter", () => {
    expect(
      interpolateArgs(
        {
          Exposure: {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 0,
              "Vivid HDR": 0.1,
              "Impact HDR": 0.22,
            },
          },
        },
        {
          params: { strength: "Impact HDR" },
          steps: {},
        },
      ),
    ).toEqual({ Exposure: 0.22 });
  });

  it("fails clearly when a preset has no matching case", () => {
    expect(() =>
      interpolateArgs(
        {
          value: {
            $select: "${params.strength}",
            cases: { "Natural HDR": 0 },
          },
        },
        {
          params: { strength: "Unknown HDR" },
          steps: {},
        },
      ),
    ).toThrow("Selection 'Unknown HDR' has no matching case");
  });

  it("preserves the type of exact references and resolves nested outputs", () => {
    expect(
      interpolateArgs(
        {
          text: "${params.text}",
          outFrame: "${params.frames}",
          label: "Title: ${params.text}",
          layerId: "${steps.inspect.result.layers[0].id}",
        },
        context,
      ),
    ).toEqual({
      text: "Hello",
      outFrame: 72,
      label: "Title: Hello",
      layerId: "layer-1",
    });
  });

  it("rejects missing references", () => {
    expect(() =>
      resolveReference("steps.inspect.result.missing", context),
    ).toThrow(/does not exist/);
  });

  it("preserves unavailable prior-output references in dry-run mode", () => {
    expect(
      interpolateArgs(
        {
          layerId: "${steps.create.result.layerId}",
        },
        { params: {}, steps: {} },
        { preserveUnresolvedStepReferences: true },
      ),
    ).toEqual({
      layerId: "${steps.create.result.layerId}",
    });
  });
});

describe("preconditions", () => {
  it("evaluates references, comparisons, and exists checks without eval", () => {
    expect(
      evaluatePrecondition(
        "${steps.inspect.result.ready} == true",
        context,
      ),
    ).toBe(true);
    expect(
      evaluatePrecondition("steps.inspect.result.count >= 3", context),
    ).toBe(true);
    expect(
      evaluatePrecondition(
        "exists(steps.inspect.result.layers[0].id)",
        context,
      ),
    ).toBe(true);
    expect(
      evaluatePrecondition(
        "!exists(steps.inspect.result.warning)",
        context,
      ),
    ).toBe(true);
    expect(evaluatePrecondition("${params.enabled}", context)).toBe(true);
  });

  it("rejects non-boolean bare literals and incompatible comparisons", () => {
    expect(() => evaluatePrecondition("42", context)).toThrow(
      /must resolve to a boolean/,
    );
    expect(() =>
      evaluatePrecondition("steps.inspect.result.count > 'two'", context),
    ).toThrow(/requires two numbers or two strings/);
  });
});
