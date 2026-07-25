import type { JsonValue } from "../../schema/json.js";
import type { Easing, ToolArgs, ToolOperation } from "../toolContract.js";
import { AE_PRELUDE } from "./prelude.js";

/**
 * Renders each ToolContract operation as an After Effects ExtendScript program.
 *
 * This is the half of Conductor that turns a recipe into technique. The
 * recipes decide *what* should happen; the code here decides how it is written
 * into After Effects, and it applies the house rules on every single call:
 * motion blur at both comp and layer level, temporal easing on every keyframe,
 * and one undo group per operation so a person can step back through an
 * agent's work the same way they step back through their own.
 */

/** Serializes a value into an ES3 literal. ExtendScript has no JSON parser. */
export function es3Literal(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot express non-finite number ${String(value)} in ExtendScript`);
    }
    return String(value);
  }
  if (typeof value === "string") {
    // ExtendScript is ES3: escape conservatively and never emit a raw newline.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(es3Literal).join(",")}]`;
  }
  return `{${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)}:${es3Literal(item)}`)
    .join(",")}}`;
}

/**
 * Converts a cubic-bezier easing into After Effects' speed/influence pair.
 *
 * After Effects does not accept bezier control points directly: a keyframe ease
 * is a speed and an influence percentage. The control points' x components
 * describe how long each side of the curve holds, which is what influence
 * means, so they map across directly. Terminal keyframes take speed 0 — that
 * is what makes a move settle instead of stopping dead.
 */
export function easingToKeyframeEase(easing: Easing): {
  outInfluence: number;
  inInfluence: number;
} {
  const [x1, , x2] = easing.controlPoints;
  const clamp = (value: number) => Math.min(100, Math.max(0.1, value));
  return {
    outInfluence: clamp(x1 * 100),
    inInfluence: clamp((1 - x2) * 100),
  };
}

function wrap(label: string, body: string): string {
  return `${AE_PRELUDE}
app.beginUndoGroup(${JSON.stringify(`Conductor: ${label}`)});
try {
${body}
} finally {
  app.endUndoGroup();
}
`;
}

function renderCreateComp(args: ToolArgs<"createComp">): string {
  return wrap(
    "create composition",
    `  var comp = app.project.items.addComp(
    ${es3Literal(args.name)},
    ${args.width},
    ${args.height},
    ${args.pixelAspect},
    ${args.durationSeconds},
    ${args.frameRate}
  );
  comp.bgColor = cdParseColor(${es3Literal(args.backgroundColor)});
  comp.motionBlur = true;
  return { compId: String(comp.id), name: comp.name, width: comp.width, height: comp.height, frameRate: comp.frameRate, durationSeconds: comp.duration };`,
  );
}

const SIZE_PRESETS: Record<string, number> = {
  small: 48,
  medium: 84,
  large: 148,
};

const JUSTIFICATION: Record<string, string> = {
  left: "ParagraphJustification.LEFT_JUSTIFY",
  center: "ParagraphJustification.CENTER_JUSTIFY",
  right: "ParagraphJustification.RIGHT_JUSTIFY",
};

function renderAddTextLayer(args: ToolArgs<"addTextLayer">): string {
  const size = SIZE_PRESETS[args.sizePreset] ?? SIZE_PRESETS.medium;
  const justification = JUSTIFICATION[args.alignment] ?? JUSTIFICATION.center;
  return wrap(
    "add text layer",
    `  var comp = cdComp(${es3Literal(args.compId)});
  comp.motionBlur = true;
  var layer = comp.layers.addText(${es3Literal(args.text)});
  layer.name = ${es3Literal(args.name)};
  layer.motionBlur = ${args.motionBlur ? "true" : "false"};

  var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var doc = textProp.value;
  doc.resetCharStyle();
  doc.font = ${es3Literal(args.font)};
  doc.fontSize = ${size};
  doc.fillColor = cdParseColor(${es3Literal(args.color)});
  doc.applyFill = true;
  doc.applyStroke = false;
  doc.justification = ${justification};
  textProp.setValue(doc);

  layer.property("ADBE Transform Group").property("ADBE Position").setValue(${es3Literal(
    args.position as unknown as JsonValue,
  )});
  return { layerId: String(layer.id), name: layer.name, index: layer.index, compId: String(comp.id) };`,
  );
}

function renderSetKeyframes(args: ToolArgs<"setKeyframes">): string {
  const { outInfluence, inInfluence } = easingToKeyframeEase(args.easing);
  const times = args.keyframes.map((keyframe) => keyframe.time);
  const values = args.keyframes.map((keyframe) => keyframe.value);
  return wrap(
    "set keyframes",
    `  var layer = cdFindLayer(${es3Literal(args.layerId)});
  var comp = layer.containingComp;
  comp.motionBlur = true;
  layer.motionBlur = ${args.motionBlur ? "true" : "false"};

  var prop = cdProperty(layer, ${es3Literal(args.property)});
  var times = ${es3Literal(times)};
  var values = ${es3Literal(values as JsonValue[])};
  var mode = ${es3Literal(args.timeMode)};
  var span = comp.duration;

  var i;
  for (i = 0; i < times.length; i++) {
    var t = (mode === "normalized") ? (times[i] * span) : times[i];
    prop.setValueAtTime(t, values[i]);
  }

  // Ease every keyframe. Speed 0 makes the value arrive and leave at rest, so
  // the move settles instead of stopping dead; the influences carry the shape
  // of the requested curve. Linear keyframes are the loudest amateur tell, so
  // this loop is not optional and has no opt-out.
  var last = prop.numKeys;
  for (i = 1; i <= last; i++) {
    prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    prop.setTemporalEaseAtKey(
      i,
      cdEase(prop, 0, ${inInfluence}),
      cdEase(prop, 0, ${outInfluence})
    );
  }
  return { applied: true, keyCount: prop.numKeys, property: ${es3Literal(args.property)}, layerId: String(layer.id) };`,
  );
}

function renderApplyEffect(args: ToolArgs<"applyEffect">): string {
  return wrap(
    "apply effect",
    `  var layer = cdFindLayer(${es3Literal(args.targetId)});
  var effects = layer.property("ADBE Effect Parade");
  var fx = effects.addProperty(${es3Literal(args.effect)});
  var settings = ${es3Literal(args.settings as unknown as JsonValue)};
  var applied = [];
  for (var key in settings) {
    if (!settings.hasOwnProperty(key)) { continue; }
    var target = null;
    try { target = fx.property(key); } catch (e) { target = null; }
    if (target !== null) {
      try { target.setValue(settings[key]); applied.push(key); } catch (e2) { /* leave at default */ }
    }
  }
  return { effectId: String(layer.id) + ":" + fx.name, name: fx.name, appliedParameters: applied, layerId: String(layer.id) };`,
  );
}

function renderPrecompose(args: ToolArgs<"precompose">): string {
  return wrap(
    "precompose",
    `  var comp = cdComp(${es3Literal(args.compId)});
  var wanted = ${es3Literal(args.layerIds)};
  var indices = [];
  for (var i = 0; i < wanted.length; i++) {
    var id = parseInt(wanted[i], 10);
    for (var j = 1; j <= comp.numLayers; j++) {
      if (comp.layer(j).id === id) { indices.push(j); break; }
    }
  }
  if (indices.length === 0) { throw new Error("No matching layers to precompose"); }
  var pre = comp.layers.precompose(indices, ${es3Literal(args.name)}, true);
  var host = null;
  for (var k = 1; k <= comp.numLayers; k++) {
    if (comp.layer(k).source === pre) { host = comp.layer(k); break; }
  }
  if (host !== null) {
    host.motionBlur = ${args.motionBlur ? "true" : "false"};
    host.collapseTransformation = ${args.collapseTransformations ? "true" : "false"};
  }
  return { precompId: String(pre.id), layerId: host === null ? "" : String(host.id), name: pre.name };`,
  );
}

function renderQueueRender(args: ToolArgs<"queueRender">): string {
  return wrap(
    "queue render",
    `  var comp = cdComp(${es3Literal(args.compId)});
  var item = app.project.renderQueue.items.add(comp);
  item.render = true;
  var om = item.outputModule(1);
  try { om.applyTemplate(${es3Literal(args.format)}); } catch (e) { /* keep the default template */ }
  om.file = new File(${es3Literal(args.outputPath)});
  return {
    queued: true,
    outputPath: om.file.fsName,
    renderQueueIndex: item.index,
    templateApplied: om.templateNames.length > 0
  };`,
  );
}

function renderProjectInfo(args: ToolArgs<"projectInfo">): string {
  if (args.action === "configure") {
    return wrap(
      "configure project",
      `  var settings = ${es3Literal(args.settings as unknown as JsonValue)};
  var changed = [];
  if (settings.workingSpace !== undefined) { app.project.workingSpace = settings.workingSpace; changed.push("workingSpace"); }
  if (settings.bitsPerChannel !== undefined) { app.project.bitsPerChannel = settings.bitsPerChannel; changed.push("bitsPerChannel"); }
  if (settings.expressionEngine !== undefined) { app.project.expressionEngine = settings.expressionEngine; changed.push("expressionEngine"); }
  return { configured: changed, workingSpace: app.project.workingSpace, bitsPerChannel: app.project.bitsPerChannel };`,
    );
  }

  return wrap(
    "inspect project",
    `  var p = app.project;
  var comps = [];
  for (var i = 1; i <= p.numItems; i++) {
    var it = p.item(i);
    if (it instanceof CompItem) {
      comps.push({ compId: String(it.id), name: it.name, width: it.width, height: it.height, frameRate: it.frameRate, durationSeconds: it.duration, numLayers: it.numLayers });
    }
  }
  return {
    application: "After Effects",
    version: app.version,
    projectName: p.file ? p.file.name : "(unsaved)",
    workingSpace: p.workingSpace,
    bitsPerChannel: p.bitsPerChannel,
    expressionEngine: p.expressionEngine,
    numItems: p.numItems,
    compositions: comps
  };`,
  );
}

const RENDERERS: {
  [Operation in ToolOperation]: (args: ToolArgs<Operation>) => string;
} = {
  createComp: renderCreateComp,
  addTextLayer: renderAddTextLayer,
  setKeyframes: renderSetKeyframes,
  applyEffect: renderApplyEffect,
  precompose: renderPrecompose,
  queueRender: renderQueueRender,
  projectInfo: renderProjectInfo,
};

export function renderAeScript<Operation extends ToolOperation>(
  operation: Operation,
  args: ToolArgs<Operation>,
): string {
  const render = RENDERERS[operation] as (value: ToolArgs<Operation>) => string;
  return render(args);
}
