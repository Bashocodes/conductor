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
  [
    "addMarkers",
    {
      targetId: "27",
      markers: [
        { timeSeconds: 0.5, comment: "beat · frame 15" },
        { timeSeconds: 1, comment: "downbeat · frame 30" },
      ],
    },
  ],
  ["addTextLayer", TEXT_LAYER as unknown as Record<string, JsonValue>],
  [
    "addMediaLayer",
    {
      compId: "27",
      path: "/tmp/logo.png",
      name: "Brand Logo",
      widthPercent: 5.93,
      positionPreset: "Top Right",
      customXPercent: 92.22,
      customYPercent: 6.56,
      opacity: 50,
      motionBlur: false,
    },
  ],
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

/**
 * Strips comments and string literals so the ES3 checks below look at code
 * only. An earlier version matched the word "let" inside a prose comment and
 * failed every operation, which is a test bug rather than a source bug.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

describe("generated scripts obey the ES3 constraint", () => {
  it.each(ALL_OPERATIONS)("%s uses no syntax ExtendScript cannot parse", (operation, args) => {
    const source = codeOnly(script(operation, args));
    // ExtendScript is ES3: these would be syntax errors inside After Effects.
    expect(source).not.toMatch(/\bconst\s/);
    expect(source).not.toMatch(/\blet\s/);
    expect(source).not.toMatch(/=>/);
    expect(source).not.toMatch(/`/);
    expect(source).not.toMatch(/\.forEach\(/);
    expect(source).not.toMatch(/\.map\(/);
    expect(source).not.toMatch(/\bclass\s/);
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
    // Easing runs over every key on the property, not just the interior ones,
    // and there is no branch that can skip it.
    expect(source).toMatch(/for \(var i = 0; i < times\.length; i\+\+\)/);
    expect(source).toContain("cdEaseKeysAtTimes(prop, times, inInfluence, outInfluence)");
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

  it("writes and reads back inspectable composition markers", () => {
    const source = script("addMarkers", {
      targetId: "27",
      markers: [
        { timeSeconds: 0.5, comment: "beat · frame 15" },
        { timeSeconds: 1, comment: "downbeat · frame 30" },
      ],
    });
    expect(source).toContain("target.markerProperty");
    expect(source).toContain("new MarkerValue");
    expect(source).toContain("markerProp.keyTime(key)");
    expect(source).toContain("markerCount: verified.length");
  });

  it("sizes and positions a logo relative to the composition", () => {
    const source = script("addMediaLayer", {
      compId: "27",
      path: "/tmp/logo.png",
      name: "Brand Logo",
      widthPercent: 5.93,
      positionPreset: "Top Right",
      customXPercent: 92.22,
      customYPercent: 6.56,
      opacity: 50,
      motionBlur: false,
    });
    expect(source).toContain("comp.width * (5.93 / 100)");
    expect(source).toContain("xPercent = 92.2222");
    expect(source).toContain("ADBE Opacity");
  });

  it("omits absent cut evidence instead of returning invalid JSON", () => {
    const source = script("addMediaLayer", {
      compId: "27",
      name: "Beat Sync Media Edit",
      segments: [{
        path: "/tmp/clip.mp4",
        name: "Opening",
        timelineInSeconds: 0,
        timelineOutSeconds: 1,
        sourceInSeconds: 0,
      }],
      widthPercent: 100,
      positionPreset: "Custom",
      customXPercent: 50,
      customYPercent: 50,
      opacity: 100,
      motionBlur: true,
    });
    expect(source).toContain("if (segment.cutFrame !== undefined)");
    expect(source).not.toContain("cutFrame: segment.cutFrame");
  });

  it("converts normalized watermark positions into comp coordinates", () => {
    const source = script("setKeyframes", {
      ...KEYFRAMES,
      timeMode: "normalized",
      coordinateSpace: "normalized-comp",
      keyframes: [
        { time: 0, value: [0.18, 0.18] },
        { time: 1, value: [0.82, 0.76] },
      ],
    } as unknown as Record<string, JsonValue>);
    expect(source).toContain('coordinateSpace === "normalized-comp"');
    expect(source).toContain("values[v][0] * comp.width");
    expect(source).toContain("values[v][1] * comp.height");
  });

  it("offsets preview footage to a representative source time", () => {
    const source = script("precompose", {
      compId: "27",
      name: "Preview",
      sources: [{
        path: "/tmp/clip.mp4",
        role: "source",
        startTimeSeconds: 0,
        sourceTimeSeconds: 8.5,
      }],
      layerIds: [],
      collapseTransformations: false,
      motionBlur: false,
    });
    expect(source).toContain("startTimeSeconds - sourceOffset");
    expect(source).toContain("sources[s].sourceTimeSeconds");
  });

  it("guards every itemByID lookup", () => {
    /*
     * app.project.itemByID THROWS for an id that is not an item rather than
     * returning null, and a layer id is not an item id. Testing it for
     * falsiness produced After Effects' unhelpful
     * "internal verification failure, sorry! {Item Not Found}" mid-recipe.
     */
    const source = script("applyEffect", {
      targetId: "39",
      effect: "ADBE Gaussian Blur 2",
      settings: {},
      atTimeSeconds: 0,
      durationSeconds: 1,
    });
    const lookups = source.match(/app\.project\.itemByID/g) ?? [];
    expect(lookups.length).toBeGreaterThan(0);
    for (const line of source.split("\n")) {
      if (line.includes("app.project.itemByID")) {
        expect(line).toContain("try {");
      }
    }
  });

  it("never changes the project working space without an explicit opt-in", () => {
    /*
     * The working space reinterprets every composition already in an open
     * project. A recipe asking for one must not silently rewrite it.
     */
    const source = script("projectInfo", {
      action: "configure",
      settings: { workingSpace: "Rec.2100 HLG", bitDepth: 32 },
    });
    expect(source).toContain("allowWorkingSpaceChange");
    expect(source).toContain("refused.push");
  });

  it("fails rather than falling back when HDR output template is missing", () => {
    const source = script("queueRender", {
      compId: "27",
      outputPath: "/tmp/hdr.mp4",
      format: "QuickTime",
      codec: "ProRes 422 HQ",
      bitDepth: 10,
      colorSpace: "Rec.2100 HLG",
      outputModuleTemplate: "IG HDR HLG ProRes",
      postProcess: "hevc-hlg",
      renderSettings: { quality: "best" },
    });
    expect(source).toContain("Required output module template");
    expect(source).toContain("IG HDR HLG ProRes");
    expect(source).toContain(".conductor-intermediate.mov");
    expect(source).toContain("removedStaleQueueItems");
    expect(source).toContain("rq.item(q).remove()");
    expect(source).toContain("preserve unrelated or inaccessible queue items");
  });

  it("reports every effect parameter it could not apply", () => {
    const source = script("applyEffect", {
      targetId: "39",
      effect: "Levels",
      settings: { "Output White": 1 },
      atTimeSeconds: 0,
      durationSeconds: 1,
    });
    expect(source).toContain("appliedParameterCount");
    expect(source).toContain("refusedParameters");
    expect(source).toContain("Parameter was not found");
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
