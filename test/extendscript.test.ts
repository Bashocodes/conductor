import { describe, expect, it } from "vitest";

import { extendScriptAeAdapterConfig } from "../src/adapters/configs/extendScriptAe.js";
import { ScriptToolAdapter } from "../src/adapters/extendscript/adapter.js";
import { easingToKeyframeEase, es3Literal } from "../src/adapters/extendscript/operations.js";
import { AdapterError } from "../src/adapters/adapter.js";
import type { Easing, ToolOperation } from "../src/adapters/toolContract.js";
import type { JsonValue } from "../src/schema/json.js";

/**
 * These lock in what was verified against a live After Effects 26.3 on
 * 2026-07-25 through the AfterEffects MCP Agent panel. The live run is the
 * evidence; these tests are how it stays true.
 */

const adapter = new ScriptToolAdapter("aftereffects", extendScriptAeAdapterConfig);

function script(operation: ToolOperation, args: Record<string, JsonValue>): string {
  const mapped = adapter.mapCall(operation, args);
  expect(mapped.tool).toBe("execute_extend_script");
  const value = mapped.args.script_string;
  expect(typeof value).toBe("string");
  return value as string;
}

const EASING: Easing = {
  type: "cubic-bezier",
  profile: "overshoot-settle",
  controlPoints: [0.22, 1, 0.36, 1],
};

const CREATE_COMP = {
  name: "Demo",
  width: 1080,
  height: 1920,
  pixelAspect: 1,
  frameRate: 30,
  durationSeconds: 5,
  backgroundColor: "#0b0b0f",
};

const TEXT_LAYER = {
  compId: "27",
  name: "TITLE",
  text: "CONDUCTOR",
  font: "Helvetica",
  sizePreset: "large",
  alignment: "center",
  position: [540, 960],
  color: "#f2f3f5",
  motionBlur: true,
};

const KEYFRAMES = {
  layerId: "39",
  property: "position",
  timeMode: "seconds",
  keyframes: [
    { time: 0, value: [540, 1040] },
    { time: 1.1, value: [540, 960] },
  ],
  easing: EASING,
  motionBlur: true,
};

const ALL_OPERATIONS: Array<[ToolOperation, Record<string, JsonValue>]> = [
  ["createComp", CREATE_COMP],
  ["addTextLayer", TEXT_LAYER as unknown as Record<string, JsonValue>],
  ["setKeyframes", KEYFRAMES as unknown as Record<string, JsonValue>],
  [
    "applyEffect",
    {
      targetId: "39",
      effect: "ADBE Gaussian Blur 2",
      settings: { Blurriness: 12 },
      atTimeSeconds: 0,
      durationSeconds: 1,
    },
  ],
  [
    "precompose",
    {
      compId: "27",
      name: "Pre",
      sources: [],
      layerIds: ["39"],
      collapseTransformations: true,
      motionBlur: true,
    },
  ],
  [
    "queueRender",
    {
      compId: "27",
      outputPath: "/tmp/out.mov",
      format: "QuickTime",
      codec: "Apple ProRes 422",
      bitDepth: 16,
      colorSpace: "Rec.709",
      renderSettings: {},
    },
  ],
  ["projectInfo", { action: "inspect", settings: {} }],
];

describe("ExtendScript adapter", () => {
  it("maps every operation onto the single script tool", () => {
    for (const [operation, args] of ALL_OPERATIONS) {
      const mapped = adapter.mapCall(operation, args);
      expect(mapped.tool).toBe("execute_extend_script");
      expect(Object.keys(mapped.args)).toEqual(["script_string"]);
    }
  });

  it("rejects arguments the ToolContract does not accept", () => {
    expect(() => adapter.mapCall("createComp", { name: "" } as never)).toThrow(AdapterError);
  });

  it("describes the operation without inventing a program during a dry run", () => {
    const mapped = adapter.mapCall(
      "createComp",
      { name: "${params.title}" } as never,
      { allowUnresolvedReferences: true },
    );
    expect(String(mapped.args.script_string)).toContain("createComp");
    expect(String(mapped.args.script_string)).not.toContain("addComp");
  });
});

describe("generated scripts obey the ES3 constraint", () => {
  it.each(ALL_OPERATIONS)("%s uses no syntax ExtendScript cannot parse", (operation, args) => {
    const source = script(operation, args);
    // ExtendScript is ES3: these would be syntax errors inside After Effects.
    expect(source).not.toMatch(/\bconst\s/);
    expect(source).not.toMatch(/\blet\s/);
    expect(source).not.toMatch(/=>/);
    expect(source).not.toMatch(/`/);
    expect(source).not.toMatch(/\.forEach\(/);
  });

  it.each(ALL_OPERATIONS)("%s wraps its work in one undo group", (operation, args) => {
    const source = script(operation, args);
    expect(source).toContain("app.beginUndoGroup(");
    expect(source).toContain("app.endUndoGroup();");
    // The endUndoGroup must be in a finally, or a thrown error leaves After
    // Effects with an open undo group and a confusing history.
    expect(source).toMatch(/finally\s*\{\s*app\.endUndoGroup\(\);/);
  });
});

describe("craft rules are not optional", () => {
  it("turns motion blur on at both comp and layer level for animated work", () => {
    const source = script("setKeyframes", KEYFRAMES as unknown as Record<string, JsonValue>);
    expect(source).toContain("comp.motionBlur = true;");
    expect(source).toContain("layer.motionBlur = true;");
  });

  it("eases every keyframe and never leaves one linear", () => {
    const source = script("setKeyframes", KEYFRAMES as unknown as Record<string, JsonValue>);
    expect(source).toContain("setTemporalEaseAtKey");
    expect(source).toContain("KeyframeInterpolationType.BEZIER");
    expect(source).not.toContain("KeyframeInterpolationType.LINEAR");
    // The loop must cover every key, not just the interior ones.
    expect(source).toMatch(/for \(i = 1; i <= last; i\+\+\)/);
  });

  it("sizes the temporal ease by the property's temporal dimension, not its value", () => {
    /*
     * Verified live: Position reports a 3-element value but accepts exactly ONE
     * ease element, because spatial properties have a single speed along the
     * motion path. Scale reported 3 and accepted 3. Passing a 3-element ease to
     * Position raises a blocking modal inside After Effects that stalls the MCP
     * connection until a human dismisses it, so this helper is load-bearing.
     */
    const source = script("setKeyframes", KEYFRAMES as unknown as Record<string, JsonValue>);
    expect(source).toContain("PropertyValueType.TwoD_SPATIAL");
    expect(source).toContain("PropertyValueType.ThreeD_SPATIAL");
    expect(source).toMatch(/if \(!spatial && \(prop\.value instanceof Array\)\)/);
  });

  it("creates compositions with motion blur already enabled", () => {
    expect(script("createComp", CREATE_COMP)).toContain("comp.motionBlur = true;");
  });
});

describe("easingToKeyframeEase", () => {
  it("maps bezier control points onto After Effects influence", () => {
    // Live-confirmed: these control points produced in=64 / out=22 on the key.
    const mapped = easingToKeyframeEase(EASING);
    expect(mapped.outInfluence).toBeCloseTo(22, 6);
    expect(mapped.inInfluence).toBeCloseTo(64, 6);
  });

  it("keeps influence inside After Effects' accepted range", () => {
    const extreme = easingToKeyframeEase({
      type: "cubic-bezier",
      profile: "gentle-exit",
      controlPoints: [0, 0, 1, 1],
    });
    expect(extreme.outInfluence).toBeGreaterThanOrEqual(0.1);
    expect(extreme.inInfluence).toBeGreaterThanOrEqual(0.1);
    expect(extreme.outInfluence).toBeLessThanOrEqual(100);
    expect(extreme.inInfluence).toBeLessThanOrEqual(100);
  });
});

describe("es3Literal", () => {
  it("serializes the shapes a recipe can carry", () => {
    expect(es3Literal([1, 2])).toBe("[1,2]");
    expect(es3Literal({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
    expect(es3Literal(null)).toBe("null");
    expect(es3Literal(true)).toBe("true");
  });

  it("escapes strings so a quote cannot break out of the generated program", () => {
    expect(es3Literal('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(es3Literal("line\nbreak")).not.toContain("\n");
  });

  it("refuses non-finite numbers rather than emitting invalid source", () => {
    expect(() => es3Literal(Number.POSITIVE_INFINITY as unknown as JsonValue)).toThrow();
  });
});
