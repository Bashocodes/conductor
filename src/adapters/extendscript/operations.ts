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
    `  // A target may name an effect too ("layerId:Effect Name"), which is what
  // applyEffect hands back, so a following step can animate that effect's
  // parameters without ambiguity.
  var target = cdSplitTarget(${es3Literal(args.layerId)});
  var layer = cdFindLayer(target.id);
  var comp = layer.containingComp;
  comp.motionBlur = true;
  layer.motionBlur = ${args.motionBlur ? "true" : "false"};

  var rawTimes = ${es3Literal(times)};
  var values = ${es3Literal(values as JsonValue[])};
  var mode = ${es3Literal(args.timeMode)};
  var span = comp.duration;

  // Normalized time lets a recipe describe a shape that holds at any duration.
  var times = [];
  for (var i = 0; i < rawTimes.length; i++) {
    times.push((mode === "normalized") ? (rawTimes[i] * span) : rawTimes[i]);
  }

  // cdApplyTrack writes the keys and eases every one of them. Linear keyframes
  // are the loudest amateur tell, so easing is not optional and has no opt-out.
  var applied = cdApplyTrack(layer, ${es3Literal(args.property)}, times, values, ${inInfluence}, ${outInfluence}, target.effect);

  var total = 0;
  for (var k = 0; k < applied.length; k++) { total += applied[k].keyCount; }
  return { applied: true, keyCount: total, properties: applied, property: ${es3Literal(args.property)}, layerId: String(layer.id) };`,
  );
}

function renderApplyEffect(args: ToolArgs<"applyEffect">): string {
  return wrap(
    "apply effect",
    `  // The target may be a layer or a whole composition; a composition resolves to
  // a shared adjustment layer, which is how After Effects treats a comp as one.
  var layer = cdEffectTarget(${es3Literal(args.targetId)});
  var fx = cdAddEffect(layer, ${es3Literal(args.effect)});
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
  var sources = ${es3Literal(args.sources as unknown as JsonValue)};
  var indices = [];
  var imported = [];

  // Sources name files that are not in the project yet. Import each one, place
  // it on the composition at its start time, and precompose it along with any
  // layers addressed by id. A transition recipe describes the clips it needs
  // this way, so precompose without import would leave it nothing to work on.
  for (var s = 0; s < sources.length; s++) {
    var layer = cdImportFootageLayer(comp, sources[s].path, sources[s].startTimeSeconds);
    indices.push(layer.index);
    imported.push({ path: sources[s].path, role: sources[s].role, layerId: String(layer.id) });
  }

  for (var i = 0; i < wanted.length; i++) {
    var id = parseInt(wanted[i], 10);
    for (var j = 1; j <= comp.numLayers; j++) {
      if (comp.layer(j).id === id) { indices.push(j); break; }
    }
  }
  if (indices.length === 0) { throw new Error("No layers or sources to precompose"); }
  var pre = comp.layers.precompose(indices, ${es3Literal(args.name)}, true);
  var host = null;
  for (var k = 1; k <= comp.numLayers; k++) {
    if (comp.layer(k).source === pre) { host = comp.layer(k); break; }
  }
  if (host !== null) {
    host.motionBlur = ${args.motionBlur ? "true" : "false"};
    host.collapseTransformation = ${args.collapseTransformations ? "true" : "false"};
  }
  return { precompId: String(pre.id), layerId: host === null ? "" : String(host.id), name: pre.name, imported: imported };`,
  );
}

function renderQueueRender(args: ToolArgs<"queueRender">): string {
  return wrap(
    "queue render",
    `  var comp = cdComp(${es3Literal(args.compId)});
  var rq = app.project.renderQueue;
  var item = rq.items.add(comp);
  item.render = true;

  // Render settings templates and output module templates are different lists.
  // Ask for Best Settings by name; if this install renamed it, leave the
  // default rather than guessing.
  var renderSettingsApplied = null;
  var rsWanted = ${es3Literal(String(args.renderSettings.quality ?? "best") === "best" ? "Best Settings" : "Current Settings")};
  var rsList = (item.templates instanceof Array) ? item.templates : [];
  for (var r = 0; r < rsList.length; r++) {
    if (rsList[r] === rsWanted) { item.applyTemplate(rsWanted); renderSettingsApplied = rsWanted; break; }
  }

  var om = item.outputModule(1);
  // AE 26 exposes output module templates as om.templates. There is no
  // om.templateNames — reading it throws, which is how this was found.
  var omList = (om.templates instanceof Array) ? om.templates : [];
  var wanted = ${es3Literal(args.format)};
  var templateApplied = null;
  for (var t = 0; t < omList.length; t++) {
    if (omList[t] === wanted) { om.applyTemplate(wanted); templateApplied = wanted; break; }
  }

  om.file = new File(${es3Literal(args.outputPath)});
  return {
    queued: true,
    outputPath: om.file.fsName,
    renderQueueIndex: rq.numItems,
    // Reported rather than assumed: the caller can see whether the format it
    // asked for existed on this installation, instead of quietly getting the
    // default output module and discovering it after a long render.
    templateRequested: wanted,
    templateApplied: templateApplied,
    renderSettingsApplied: renderSettingsApplied,
    availableTemplates: omList
  };`,
  );
}

function renderProjectInfo(args: ToolArgs<"projectInfo">): string {
  if (args.action === "configure") {
    return wrap(
      "configure project",
      `  var settings = ${es3Literal(args.settings as unknown as JsonValue)};
  var p = app.project;
  var before = { workingSpace: p.workingSpace, bitsPerChannel: p.bitsPerChannel };
  var changed = [];
  var refused = [];

  // Bit depth is safe: it is a small enumeration and an invalid value throws
  // rather than prompting. Recipes may call it bitDepth.
  var depth = (settings.bitsPerChannel !== undefined) ? settings.bitsPerChannel : settings.bitDepth;
  if (depth !== undefined && depth !== p.bitsPerChannel) {
    try { p.bitsPerChannel = depth; changed.push("bitsPerChannel"); }
    catch (e) { refused.push({ setting: "bitsPerChannel", reason: String(e) }); }
  }

  /*
   * Working space is deliberately NOT changed to an arbitrary requested value.
   * It is a project-wide colour-management setting that silently alters how
   * every existing composition in someone's open project is interpreted, and
   * After Effects answers an unrecognised name with a modal dialog, which
   * stalls the MCP connection until a human dismisses it. So: apply it only
   * when it already matches, and otherwise report the mismatch and let a
   * person decide.
   */
  if (settings.workingSpace !== undefined && settings.workingSpace !== p.workingSpace) {
    refused.push({
      setting: "workingSpace",
      requested: settings.workingSpace,
      current: p.workingSpace,
      reason: "Changing the project working space affects every existing composition; set it in After Effects, or pass allowWorkingSpaceChange."
    });
    if (settings.allowWorkingSpaceChange === true) {
      try { p.workingSpace = settings.workingSpace; changed.push("workingSpace"); refused.pop(); }
      catch (e2) { refused[refused.length - 1].reason = String(e2); }
    }
  }

  return {
    configured: changed,
    refused: refused,
    before: before,
    workingSpace: p.workingSpace,
    bitsPerChannel: p.bitsPerChannel
  };`,
    );
  }

  if (args.mediaPath !== undefined) {
    // Inspecting a file, not the project: a grade recipe needs the source's
    // real dimensions and rate before it can build a matching composition.
    return wrap(
      "inspect media",
      `  var footage = cdImportFootage(${es3Literal(args.mediaPath)});
  var source = footage.mainSource;
  return {
    path: source.file ? source.file.fsName : ${es3Literal(args.mediaPath)},
    name: footage.name,
    footageId: String(footage.id),
    width: footage.width,
    height: footage.height,
    pixelAspect: footage.pixelAspect,
    frameRate: footage.frameRate,
    durationSeconds: footage.duration,
    hasVideo: footage.hasVideo,
    hasAudio: footage.hasAudio,
    // Colour management state matters for an HDR grade, so report the project
    // working space alongside the clip rather than assuming one.
    projectWorkingSpace: app.project.workingSpace,
    projectBitsPerChannel: app.project.bitsPerChannel
  };`,
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
