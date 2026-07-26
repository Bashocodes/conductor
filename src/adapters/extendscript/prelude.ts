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
  var item = app.project.itemByID(parseInt(compId, 10));
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

function cdProperty(layer, name) {
  var transform = layer.property("ADBE Transform Group");
  if (CD_TRANSFORM[name]) { return transform.property(CD_TRANSFORM[name]); }
  if (CD_AXIS[name]) { return transform.property(CD_AXIS[name][0]); }
  if (name === "tracking") { return cdTracking(layer); }
  var effects = layer.property("ADBE Effect Parade");
  if (effects) {
    for (var i = 1; i <= effects.numProperties; i++) {
      var fx = effects.property(i);
      for (var j = 1; j <= fx.numProperties; j++) {
        if (fx.property(j).name === name) { return fx.property(j); }
      }
      if (fx.name === name) { return fx; }
    }
  }
  throw new Error("Unknown property '" + name + "' on layer " + layer.name);
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
    // A frame is the finest grid AE keys land on; anything further away is a
    // different keyframe and must keep its own curve.
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
function cdApplyTrack(layer, name, times, values, inInfluence, outInfluence) {
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
        applied = applied.concat(cdApplyTrack(layer, sub, subTimes, subValues, inInfluence, outInfluence));
      }
    }
    return applied;
  }

  var prop = cdProperty(layer, name);
  for (i = 0; i < times.length; i++) {
    cdSetValueAtTime(layer, name, prop, times[i], values[i]);
  }
  var eased = cdEaseKeysAtTimes(prop, times, inInfluence, outInfluence);
  applied.push({ property: name, keyCount: prop.numKeys, easedKeys: eased });
  return applied;
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
