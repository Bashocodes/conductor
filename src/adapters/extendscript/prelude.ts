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

/** Addresses a transform or effect property by a small, stable vocabulary. */
function cdProperty(layer, name) {
  var transform = layer.property("ADBE Transform Group");
  var map = {
    position: "ADBE Position",
    scale: "ADBE Scale",
    opacity: "ADBE Opacity",
    rotation: "ADBE Rotate Z",
    anchorPoint: "ADBE Anchor Point"
  };
  if (map[name]) { return transform.property(map[name]); }
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
