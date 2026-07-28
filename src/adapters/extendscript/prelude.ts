/**
 * ExtendScript prelude shared by every generated After Effects script.
 *
 * After Effects runs ExtendScript, which is ES3: `var` only, no `const`/`let`,
 * no arrow functions, no template literals, and none of `Array.prototype`'s
 * iteration helpers. Everything below is written to that constraint on purpose
 * — it is executed by AE, not by Node.
 *
 * The helpers encode the two things that are easy to get wrong and expensive to
 * debug through a modal dialog:
 *
 * 1. `cdEase` sizes the temporal-ease array correctly. The array length is the
 *    property's TEMPORAL dimension, which is not its value dimension. Spatial
 *    properties (Position, Anchor Point) carry ONE ease — a single speed along
 *    the motion path — even though their value is [x, y] or [x, y, z]. Scale,
 *    being multi-dimensional but not spatial, takes one per dimension. Passing
 *    the wrong length raises a blocking "Value array does not have N elements"
 *    modal, which stalls the whole MCP connection until a human dismisses it.
 *
 * 2. `cdFindLayer` resolves the stable numeric layer id rather than an index.
 *    Layer indices shift whenever anything is added, removed or reordered.
 */
export const AE_PRELUDE = `
function cdEase(prop, speed, influence) {
  var vt = prop.propertyValueType;
  var spatial = (vt == PropertyValueType.TwoD_SPATIAL || vt == PropertyValueType.ThreeD_SPATIAL);
  var n = 1;
  if (!spatial && (prop.value instanceof Array)) { n = prop.value.length; }
  var inf = influence; if (inf < 0.1) { inf = 0.1; } if (inf > 100) { inf = 100; }
  var out = [];
  for (var i = 0; i < n; i++) { out.push(new KeyframeEase(speed, inf)); }
  return out;
}

function cdComp(compId) {
  // itemByID throws rather than returning null for an unknown id, so the
  // failure has to be caught and reported in terms the caller can act on.
  var item = null;
  try { item = app.project.itemByID(parseInt(compId, 10)); } catch (e) { item = null; }
  if (!item) { throw new Error("No item with id " + compId); }
  if (!(item instanceof CompItem)) { throw new Error("Item " + compId + " is not a composition"); }
  return item;
}

function cdFindLayer(layerId) {
  var wanted = parseInt(layerId, 10);
  var p = app.project;
  for (var i = 1; i <= p.numItems; i++) {
    var item = p.item(i);
    if (!(item instanceof CompItem)) { continue; }
    for (var j = 1; j <= item.numLayers; j++) {
      if (item.layer(j).id === wanted) { return item.layer(j); }
    }
  }
  throw new Error("No layer with id " + layerId);
}

/**
 * The property vocabulary a recipe may address.
 *
 * Whole properties take their natural value (a vector for position, a number
 * for opacity). Axis names animate one component of a vector property while
 * leaving the others at their current value, which is what a title that rises
 * without drifting sideways needs. Anything not named here is looked up among
 * the layer's effects, so a recipe can drive an effect parameter by its name.
 */
var CD_TRANSFORM = {
  position: "ADBE Position",
  scale: "ADBE Scale",
  opacity: "ADBE Opacity",
  rotation: "ADBE Rotate Z",
  anchorPoint: "ADBE Anchor Point"
};

var CD_AXIS = {
  positionX: ["ADBE Position", 0],
  positionY: ["ADBE Position", 1],
  positionZ: ["ADBE Position", 2],
  scaleX: ["ADBE Scale", 0],
  scaleY: ["ADBE Scale", 1],
  anchorPointX: ["ADBE Anchor Point", 0],
  anchorPointY: ["ADBE Anchor Point", 1]
};

/**
 * Effect parameter names a recipe is likely to use, mapped to what After
 * Effects actually calls them. Confirmed against a live host.
 */
var CD_PARAM_ALIASES = {
  progress: "Transition Completion",
  completion: "Transition Completion",
  angle: "Wipe Angle",
  blurLength: "Blur Length",
  amount: "Intensity"
};

function cdSameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Finds a parameter inside one effect, tolerating case and the alias table.
 * After Effects labels parameters for humans ("Transition Completion"), while
 * recipes name intents ("progress").
 */
function cdEffectParam(fx, name) {
  var wanted = CD_PARAM_ALIASES[name] ? CD_PARAM_ALIASES[name] : name;
  for (var j = 1; j <= fx.numProperties; j++) {
    if (cdSameName(fx.property(j).name, wanted)) { return fx.property(j); }
  }
  return null;
}

/**
 * @param scopeEffect optional effect name; when a target was addressed as
 *        "layerId:Effect Name", only that effect's parameters are searched, so
 *        two effects exposing an "Intensity" cannot be confused.
 */
function cdProperty(layer, name, scopeEffect) {
  var transform = layer.property("ADBE Transform Group");
  if (CD_TRANSFORM[name]) { return transform.property(CD_TRANSFORM[name]); }
  if (CD_AXIS[name]) { return transform.property(CD_AXIS[name][0]); }
  if (name === "tracking") { return cdTracking(layer); }

  var effects = layer.property("ADBE Effect Parade");
  var available = [];
  if (effects) {
    for (var i = 1; i <= effects.numProperties; i++) {
      var fx = effects.property(i);
      if (scopeEffect && !cdSameName(fx.name, scopeEffect)) { continue; }
      var found = cdEffectParam(fx, name);
      if (found !== null) { return found; }
      for (var j = 1; j <= fx.numProperties; j++) { available.push(fx.name + "." + fx.property(j).name); }
      if (cdSameName(fx.name, name)) { return fx; }
    }
  }
  throw new Error(
    "Unknown property '" + name + "' on layer " + layer.name +
    (available.length > 0 ? ". Available: " + available.join(", ") : "")
  );
}

/** Splits a target addressed as "layerId" or "layerId:Effect Name". */
function cdSplitTarget(targetId) {
  var text = String(targetId);
  var colon = text.indexOf(":");
  if (colon < 0) { return { id: text, effect: null }; }
  return { id: text.substring(0, colon), effect: text.substring(colon + 1) };
}

/**
 * Tracking lives on a text animator, not on the layer, so it has to be created
 * before it can be keyframed. Reuses the animator Conductor made earlier rather
 * than stacking a new one on every call.
 */
function cdTracking(layer) {
  var textProp = layer.property("ADBE Text Properties");
  if (!textProp) { throw new Error("Layer " + layer.name + " has no text properties"); }
  var animators = textProp.property("ADBE Text Animators");
  var animator = null;
  for (var i = 1; i <= animators.numProperties; i++) {
    if (animators.property(i).name === "Conductor Tracking") { animator = animators.property(i); break; }
  }
  if (animator === null) {
    animator = animators.addProperty("ADBE Text Animator");
    animator.name = "Conductor Tracking";
    animator.property("ADBE Text Animator Properties").addProperty("ADBE Text Tracking Amount");
  }
  return animator.property("ADBE Text Animator Properties").property("ADBE Text Tracking Amount");
}

/**
 * Writes one keyframe, expanding a scalar into a full vector when an axis name
 * was used so the untouched components keep the value they already had.
 */
function cdSetValueAtTime(layer, name, prop, time, value) {
  if (CD_AXIS[name]) {
    var index = CD_AXIS[name][1];
    var current = prop.valueAtTime(time, false);
    var vector = [];
    for (var i = 0; i < current.length; i++) { vector.push(current[i]); }
    if (index >= vector.length) { throw new Error("Property " + name + " has no axis " + index); }
    vector[index] = value;
    prop.setValueAtTime(time, vector);
    return;
  }
  prop.setValueAtTime(time, value);
}

/**
 * Eases exactly the keys this call wrote — never every key on the property.
 *
 * A property usually carries more than one gesture: an entrance with an
 * overshoot-settle curve, then an exit with a gentle one. Easing the whole
 * property would let whichever step ran last flatten every earlier gesture to
 * its own curve, which is precisely the character Conductor exists to protect.
 *
 * Keys are located by time rather than index because indices shift as keys are
 * inserted earlier in the property.
 */
function cdEaseKeysAtTimes(prop, times, inInfluence, outInfluence) {
  var eased = 0;
  for (var i = 0; i < times.length; i++) {
    var index = prop.nearestKeyIndex(times[i]);
    if (index < 1 || index > prop.numKeys) { continue; }
    // AE accepts continuous key times. The 1 ms tolerance only absorbs
    // ExtendScript number transport/lookup noise; it must not snap a
    // sample-derived effect envelope onto the edit-frame grid.
    if (Math.abs(prop.keyTime(index) - times[i]) > 0.001) { continue; }
    prop.setInterpolationTypeAtKey(index, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    prop.setTemporalEaseAtKey(index, cdEase(prop, 0, inInfluence), cdEase(prop, 0, outInfluence));
    eased++;
  }
  return eased;
}

/**
 * Applies one timed track of values.
 *
 * A recipe may name a single property, or name several at once by giving each
 * keyframe an object value like { positionY: 540, opacity: 100 }. Animating
 * them together on one time grid with one easing is what keeps a move reading
 * as a single gesture rather than several coincidental ones.
 */
function cdApplyTrack(layer, name, times, values, inInfluence, outInfluence, scopeEffect) {
  var applied = [];
  var i;
  var compound = (values.length > 0 && values[0] !== null &&
    typeof values[0] === "object" && !(values[0] instanceof Array));

  if (compound) {
    var seen = {};
    for (i = 0; i < values.length; i++) {
      for (var key in values[i]) {
        if (values[i].hasOwnProperty(key)) { seen[key] = true; }
      }
    }
    for (var sub in seen) {
      if (!seen.hasOwnProperty(sub)) { continue; }
      var subTimes = [];
      var subValues = [];
      for (i = 0; i < values.length; i++) {
        if (values[i][sub] !== undefined) { subTimes.push(times[i]); subValues.push(values[i][sub]); }
      }
      if (subTimes.length > 0) {
        applied = applied.concat(cdApplyTrack(layer, sub, subTimes, subValues, inInfluence, outInfluence, scopeEffect));
      }
    }
    return applied;
  }

  var prop = cdProperty(layer, name, scopeEffect);

  /*
   * setValueAtTime costs more the more keys the property already holds, so
   * writing a track one key at a time is quadratic: a 1289-beat light envelope
   * (3869 keys) measured 10.1 s that way, which overran the 20 s ceiling the
   * After Effects MCP bridge imposes on a single script and failed the step
   * with no usable error. setValuesAtTimes writes the same 3869 keys in 50 ms.
   *
   * It is safe for the gesture-layering this file protects: it adds to the
   * property rather than replacing it (verified — three existing keys survived
   * a batch write with their values intact) and it sorts unsorted input.
   *
   * Axis writes cannot use it. Each one reads the vector at its own time and
   * substitutes a single component, and every write changes what the next read
   * sees, so those must stay sequential. Axis tracks are short gestures, not
   * beat envelopes, so they never approach the ceiling.
   */
  if (times.length > 0) {
    var batched = false;
    if (!CD_AXIS[name] && typeof prop.setValuesAtTimes === "function") {
      try { prop.setValuesAtTimes(times, values); batched = true; } catch (e) { batched = false; }
    }
    if (!batched) {
      for (i = 0; i < times.length; i++) {
        cdSetValueAtTime(layer, name, prop, times[i], values[i]);
      }
    }
  }
  var eased = cdEaseKeysAtTimes(prop, times, inInfluence, outInfluence);
  applied.push({ property: name, keyCount: prop.numKeys, easedKeys: eased });
  return applied;
}

/**
 * Imports a media file and places it on a composition.
 *
 * Reuses footage already in the project rather than importing the same file
 * twice, which would leave a recipe's second run with a project full of
 * duplicates.
 */
function cdImportFootage(path) {
  var file = new File(path);
  if (!file.exists) { throw new Error("Media file not found: " + path); }

  var p = app.project;
  for (var i = 1; i <= p.numItems; i++) {
    var item = p.item(i);
    if (item instanceof FootageItem && item.mainSource && item.mainSource.file &&
        item.mainSource.file.fsName === file.fsName) {
      return item;
    }
  }
  return p.importFile(new ImportOptions(file));
}

function cdImportFootageLayer(comp, path, startTimeSeconds, sourceTimeSeconds) {
  var footage = cdImportFootage(path);
  var layer = comp.layers.add(footage);
  var sourceOffset = (sourceTimeSeconds === undefined) ? 0 : sourceTimeSeconds;
  layer.startTime = startTimeSeconds - sourceOffset;
  layer.inPoint = startTimeSeconds;
  layer.outPoint = comp.duration;
  layer.motionBlur = true;
  return layer;
}

/**
 * Descriptive effect names mapped to After Effects match names.
 *
 * Recipes describe an intent ("Directional Blur"); After Effects addresses
 * effects by locale-stable match names that rarely resemble the label shown in
 * the UI — Directional Blur is "ADBE Motion Blur", Levels is
 * "ADBE Easy Levels2". Every entry below was confirmed to load on a live
 * After Effects 26.3 rather than taken from documentation.
 *
 * A match name passed straight through still works, so a recipe can address
 * any effect this map has not learned yet.
 */
var CD_EFFECT_ALIASES = {
  "Directional Blur": "ADBE Motion Blur",
  "Gaussian Blur": "ADBE Gaussian Blur 2",
  "Radial Blur": "ADBE Radial Blur",
  "Levels": "ADBE Easy Levels2",
  "Levels (Individual Controls)": "ADBE Pro Levels2",
  "Exposure": "ADBE Exposure2",
  "Curves": "ADBE CurvesCustom",
  "Glow": "ADBE Glo2",
  "Photo Filter": "ADBE Photo Filter",
  "Tritone": "ADBE Tritone",
  "Black & White": "ADBE Black&White",
  "Noise": "ADBE Noise",
  "Brightness & Contrast": "ADBE Brightness & Contrast 2",
  "Tint": "ADBE Tint",
  "Fill": "ADBE Fill",
  "Ramp": "ADBE Ramp",
  "Hue/Saturation": "ADBE HUE SATURATION",
  "Vibrance": "ADBE Vibrance",
  "Radial Light Burst": "CC Light Burst 2.5",
  "Directional Luma Matte": "ADBE Linear Wipe",
  "Linear Wipe": "ADBE Linear Wipe",
  "Set Matte": "ADBE Set Matte3"
};

function cdAddEffect(layer, name) {
  var effects = layer.property("ADBE Effect Parade");
  var matchName = CD_EFFECT_ALIASES[name] ? CD_EFFECT_ALIASES[name] : name;
  try {
    return effects.addProperty(matchName);
  } catch (e) {
    throw new Error(
      "After Effects has no effect '" + name + "'" +
      (matchName === name ? "" : " (tried match name '" + matchName + "')") +
      ". Pass an After Effects match name, or add an alias."
    );
  }
}

/**
 * Resolves an effect target that may be either a layer or a whole composition.
 *
 * An effect cannot be attached to a composition, so when a recipe asks to treat
 * one as a unit — a light burst that washes the whole transition — the correct
 * After Effects idiom is an adjustment layer spanning the composition. Reuses
 * the one Conductor made earlier instead of stacking a new one per effect.
 */
function cdEffectTarget(targetId) {
  var numeric = parseInt(targetId, 10);
  // itemByID THROWS for an id that is not an item — it does not return null —
  // and a layer id is not an item id, so this must be guarded rather than
  // tested for falsiness. The thrown message is an unhelpful
  // "internal verification failure, sorry! {Item Not Found}".
  var item = null;
  try { item = app.project.itemByID(numeric); } catch (e) { item = null; }
  if (item && item instanceof CompItem) {
    for (var i = 1; i <= item.numLayers; i++) {
      if (item.layer(i).name === "Conductor Adjustments") { return item.layer(i); }
    }
    var adjustment = item.layers.addSolid([1, 1, 1], "Conductor Adjustments", item.width, item.height, 1);
    adjustment.adjustmentLayer = true;
    adjustment.moveToBeginning();
    adjustment.motionBlur = true;
    return adjustment;
  }
  return cdFindLayer(targetId);
}

/**
 * Applies a font, tolerating names a person would type.
 *
 * After Effects wants a PostScript name and rejects anything else outright —
 * "Sans Serif" fails with 'Unable to set "font". Contains invalid character
 * 32', because of the space. A recipe should not have to know that, and a
 * default that cannot be applied is worse than no default.
 *
 * Tries the requested name, then a few common spellings of it, then falls back
 * to the font After Effects already chose for the layer, which is always valid.
 * Reports which one actually stuck rather than pretending the request worked.
 */
var CD_FONT_FALLBACKS = {
  "sans serif": ["Helvetica", "ArialMT", "HelveticaNeue"],
  "sans-serif": ["Helvetica", "ArialMT", "HelveticaNeue"],
  "serif": ["Times-Roman", "TimesNewRomanPSMT", "Georgia"],
  "monospace": ["Menlo-Regular", "Courier", "CourierNewPSMT"],
  "helvetica": ["Helvetica", "HelveticaNeue"],
  "arial": ["ArialMT", "Arial"]
};

function cdApplyFont(textProp, requested) {
  var doc = textProp.value;
  var fallbackFont = doc.font;

  var candidates = [requested];
  var aliases = CD_FONT_FALLBACKS[String(requested).toLowerCase()];
  if (aliases) { for (var a = 0; a < aliases.length; a++) { candidates.push(aliases[a]); } }
  // Last resort: whatever After Effects already picked, which is always valid.
  candidates.push(fallbackFont);

  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] === undefined || candidates[i] === null) { continue; }
    try {
      var attempt = textProp.value;
      attempt.font = candidates[i];
      textProp.setValue(attempt);
      return { applied: candidates[i], requested: requested, substituted: (candidates[i] !== requested) };
    } catch (e) { /* try the next spelling */ }
  }
  return { applied: fallbackFont, requested: requested, substituted: true };
}

function cdParseColor(hex) {
  var s = String(hex);
  if (s.charAt(0) === "#") { s = s.substring(1); }
  if (s.length === 3) { s = s.charAt(0)+s.charAt(0)+s.charAt(1)+s.charAt(1)+s.charAt(2)+s.charAt(2); }
  return [
    parseInt(s.substring(0, 2), 16) / 255,
    parseInt(s.substring(2, 4), 16) / 255,
    parseInt(s.substring(4, 6), 16) / 255
  ];
}
`;
