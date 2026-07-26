/**
 * The Conductor console, as one self-contained HTML document.
 *
 * Deliberately a single string with no build step: Conductor's build is `tsc`
 * and nothing else, and a local control panel is not worth a bundler. No
 * external fonts, scripts, or styles are referenced, so the page works with no
 * network at all — which matters, because the whole point of this tool is that
 * it runs against applications on your own machine.
 */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conductor</title>
<style>
  :root {
    --bg: #0c0d10; --panel: #14161b; --line: #242832; --line-2: #333947;
    --ink: #e9ecf2; --ink-2: #a4acbb; --ink-3: #6b7488;
    --accent: #7aa2f7; --ok: #79c99a; --warn: #e0af68; --bad: #f07a7a;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--ink);
         font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 28px 24px 80px; }

  header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
           padding-bottom: 18px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
  .tag { font: 11px/1 var(--mono); color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  .status { margin-left: auto; display: flex; align-items: center; gap: 8px;
            font: 12px/1 var(--mono); color: var(--ink-2); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ink-3); flex: none; }
  .dot.ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(121,201,154,.16); }
  .dot.bad { background: var(--bad); box-shadow: 0 0 0 3px rgba(240,122,122,.16); }
  .dot.busy { background: var(--warn); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }

  .grid { display: grid; grid-template-columns: 300px minmax(0,1fr); gap: 22px; margin-top: 22px; }
  @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .panel h2 { font-size: 11px; font-family: var(--mono); letter-spacing: .1em;
              text-transform: uppercase; color: var(--ink-3); margin-bottom: 12px; }

  .recipe { width: 100%; text-align: left; padding: 11px 12px; margin-bottom: 8px;
            background: transparent; border: 1px solid var(--line); border-radius: 9px;
            color: var(--ink); cursor: pointer; font: inherit; }
  .recipe:hover { border-color: var(--line-2); background: #171a20; }
  .recipe[aria-pressed="true"] { border-color: var(--accent); background: #171c28; }
  .recipe b { display: block; font-weight: 600; font-size: 13px; }
  .recipe span { display: block; margin-top: 3px; color: var(--ink-3); font-size: 11.5px; line-height: 1.45; }

  .field { margin-bottom: 13px; }
  .field label { display: block; font-size: 12px; color: var(--ink-2); margin-bottom: 5px; }
  .field .req { color: var(--warn); }
  .field .hint { margin-top: 4px; font-size: 11px; color: var(--ink-3); line-height: 1.45; }
  input, select { width: 100%; padding: 8px 10px; background: #0f1116; color: var(--ink);
                  border: 1px solid var(--line-2); border-radius: 7px; font: 13px var(--mono); }
  .row { display: flex; gap: 8px; align-items: stretch; }
  .row input { flex: 1; min-width: 0; }
  button.browse { flex: none; padding: 0 14px; border-radius: 7px; border: 1px solid var(--line-2);
                  background: #1a1e26; color: var(--ink); font: 600 12.5px/1 inherit; cursor: pointer; white-space: nowrap; }
  button.browse:hover { border-color: var(--accent); }
  .needs { align-self: center; font-size: 12px; color: var(--warn); }
  .queued-title { margin-top: 12px; font-weight: 700; font-size: 12.5px; }
  .queued-note { margin-top: 5px; font-size: 12px; line-height: 1.5; opacity: .92; }
  .queued-row { display: flex; gap: 9px; align-items: center; margin-top: 9px; flex-wrap: wrap; }
  .queued-row code { flex: 1; min-width: 260px; padding: 6px 9px; border-radius: 6px;
                     background: rgba(0,0,0,.28); font-size: 11.5px; word-break: break-all; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  input[type=checkbox] { width: auto; }

  .actions { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 16px;
             padding-top: 16px; border-top: 1px solid var(--line); }
  button.act { padding: 9px 15px; border-radius: 8px; border: 1px solid var(--line-2);
               background: #1a1e26; color: var(--ink); font: 600 13px/1 inherit; cursor: pointer; }
  button.act:hover:not(:disabled) { border-color: var(--accent); }
  button.act.primary { background: var(--accent); border-color: var(--accent); color: #0b1020; }
  button.act:disabled { opacity: .45; cursor: not-allowed; }

  .steps { list-style: none; }
  .steps li { display: flex; gap: 11px; align-items: flex-start; padding: 9px 0;
              border-bottom: 1px solid var(--line); }
  .steps li:last-child { border-bottom: 0; }
  .steps .mark { flex: none; width: 18px; text-align: center; font: 12px var(--mono); }
  .steps .id { font: 12.5px var(--mono); }
  .steps .meta { margin-top: 2px; font-size: 11.5px; color: var(--ink-3); }
  .steps .err { margin-top: 4px; font: 11.5px/1.5 var(--mono); color: var(--bad); word-break: break-word; }
  .s-ok { color: var(--ok); } .s-fail { color: var(--bad); }
  .s-skip { color: var(--ink-3); } .s-run { color: var(--warn); }

  pre { background: #0f1116; border: 1px solid var(--line); border-radius: 9px;
        padding: 13px; overflow: auto; max-height: 460px;
        font: 11.5px/1.55 var(--mono); color: var(--ink-2); }
  .empty { color: var(--ink-3); font-size: 13px; padding: 6px 0; }
  .banner { padding: 11px 13px; border-radius: 9px; font-size: 12.5px; margin-bottom: 14px; }
  .banner.ok { background: rgba(121,201,154,.1); border: 1px solid rgba(121,201,154,.35); color: #c9f5d9; }
  .banner.bad { background: rgba(240,122,122,.1); border: 1px solid rgba(240,122,122,.35); color: #ffc9c9; }
  .banner.warn { background: rgba(224,175,104,.1); border: 1px solid rgba(224,175,104,.35); color: #f3ddb6; }
  pre.render-log { max-height: 220px; margin-top: 10px; white-space: pre-wrap; }
  code { font-family: var(--mono); font-size: .93em; }

  .lab-intro { margin-bottom: 16px; padding: 12px 13px; border: 1px solid rgba(122,162,247,.28);
               border-radius: 9px; background: rgba(122,162,247,.06); color: var(--ink-2); font-size: 12px; }
  .lab-section { margin-top: 17px; padding-top: 15px; border-top: 1px solid var(--line); }
  .lab-section h3 { margin-bottom: 10px; color: var(--ink); font-size: 13px; font-weight: 650; }
  .lab-section-note { margin: -6px 0 11px; color: var(--ink-3); font-size: 11px; }
  .compact-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 0 12px; }
  @media (max-width: 640px) { .compact-grid { grid-template-columns: 1fr; } }
  .check-field { display: flex; align-items: center; gap: 8px; margin: 2px 0 13px; color: var(--ink-2); }
  .check-field label { cursor: pointer; font-size: 12px; }
  .brand-row { display: flex; gap: 8px; align-items: stretch; }
  .brand-row select { min-width: 0; flex: 1; }

  .look-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 9px; }
  @media (max-width: 1100px) { .look-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
  @media (max-width: 640px) { .look-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  .look-card { position: relative; overflow: hidden; min-height: 118px; padding: 0;
               border: 1px solid var(--line); border-radius: 9px; background: #0f1116;
               color: var(--ink); text-align: left; cursor: pointer; }
  .look-card:hover { border-color: var(--line-2); }
  .look-card[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .look-card img, .look-card video { display: block; width: 100%; height: 90px; object-fit: cover; background: #0b0c10; }
  .look-placeholder { height: 90px; display: grid; place-items: center;
                      background: radial-gradient(circle at 70% 20%, rgba(122,162,247,.18), transparent 42%),
                                  linear-gradient(145deg,#171a22,#0d0f14); color: var(--ink-3); font: 10px var(--mono); }
  .look-card b { display: block; padding: 7px 8px 1px; font-size: 11.5px; line-height: 1.2; }
  .look-card span { display: block; min-height: 34px; padding: 2px 8px 8px; color: var(--ink-3); font-size: 9.5px; line-height: 1.35; }
  .look-badge { position: absolute; top: 6px; right: 6px; padding: 2px 5px; border-radius: 99px;
                background: rgba(8,9,12,.8); color: var(--ink-2); font: 9px var(--mono); }
  .look-card[aria-pressed="true"] .look-badge { background: var(--accent); color: #0b1020; }

  .preview-progress { margin-top: 10px; color: var(--ink-2); font-size: 11.5px; min-height: 18px; }
  .preview-progress strong { color: var(--ink); }

  .viewer { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center;
            padding: 24px; background: rgba(3,4,7,.9); backdrop-filter: blur(12px); }
  .viewer[hidden] { display: none; }
  .viewer-shell { width: min(900px,96vw); max-height: 94vh; display: flex; flex-direction: column;
                  border: 1px solid var(--line-2); border-radius: 13px; overflow: hidden; background: #090a0d; }
  .viewer-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
                 border-bottom: 1px solid var(--line); }
  .viewer-head b { flex: 1; }
  .viewer video { display: block; width: 100%; max-height: calc(94vh - 100px); background: #000; }
  .viewer-nav { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px; }
  .viewer-nav .act { min-width: 42px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Conductor</h1>
    <span class="tag">motion recipes over MCP</span>
    <div class="status"><span class="dot" id="dot"></span><span id="statusText">checking…</span></div>
  </header>

  <div id="banner"></div>

  <div class="grid">
    <div>
      <div class="panel">
        <h2>Recipes</h2>
        <div id="recipes"><div class="empty">Loading…</div></div>
      </div>
      <div class="panel" style="margin-top:22px">
        <h2>Utilities</h2>
        <button class="recipe" id="btnPrivacyClean">
          <b>Privacy Clean Copy</b>
          <span>Choose an image or video. Conductor removes identifying metadata and saves a verified, non-destructive copy beside the original.</span>
        </button>
      </div>
    </div>

    <div>
      <div class="panel" style="margin-bottom:22px">
        <h2 id="paramsTitle">Parameters</h2>
        <div id="params"><div class="empty">Choose a recipe.</div></div>
        <div class="actions">
          <button class="act" id="btnDry" disabled>Preview plan</button>
          <button class="act primary" id="btnRun" disabled>Build &amp; render</button>
          <button class="act" id="btnDoctor">Re-check connection</button>
          <span class="needs" id="needs"></span>
        </div>
      </div>

      <div class="panel">
        <h2 id="outTitle">Output</h2>
        <div id="out"><div class="empty">Nothing yet. Preview a plan, or run a recipe.</div></div>
      </div>
    </div>
  </div>
</div>

<div class="viewer" id="lookViewer" hidden role="dialog" aria-modal="true" aria-labelledby="viewerTitle">
  <div class="viewer-shell">
    <div class="viewer-head">
      <b id="viewerTitle">Cinematic preview</b>
      <button class="act" id="viewerFullscreen" type="button">Full screen</button>
      <button class="act" id="viewerClose" type="button">Close</button>
    </div>
    <video id="viewerVideo" muted loop controls playsinline></video>
    <div class="viewer-nav">
      <button class="act" id="viewerPrev" type="button" aria-label="Previous look">←</button>
      <span id="viewerCount" class="tag"></span>
      <button class="act" id="viewerNext" type="button" aria-label="Next look">→</button>
    </div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
/* Minted per server start and injected here. Another origin cannot read this
   page, so it cannot learn the token — which is what stops a web page you
   happen to visit from driving your creative applications. */
const TOKEN = "__CONDUCTOR_SESSION_TOKEN__";
let recipes = [];
let selected = null;
let running = false;
const CINEMATIC_LOOKS = [
  ["Clean Cinema", "Balanced contrast, restrained color and fine texture."],
  ["Golden Hour", "Warm sunlight, protected highlights and healthy skin tones."],
  ["Teal & Amber", "Cool shadows and warm highlights with controlled separation."],
  ["Dream Bloom", "Soft highlight bloom with a delicate rose atmosphere."],
  ["Film Noir", "Sculpted monochrome, silver tint and tactile grain."],
  ["Neon Night", "Cyan-violet separation, deep night contrast and luminous glow."],
  ["Bleach Bypass", "Lower color, harder contrast and a photochemical edge."],
];
let cinematicPreviews = {};
let viewerIndex = 0;

function setStatus(kind, text) {
  $("dot").className = "dot " + kind;
  $("statusText").textContent = text;
}

function banner(kind, html) {
  $("banner").innerHTML = html ? '<div class="banner ' + kind + '">' + html + "</div>" : "";
}

async function api(path, options) {
  const settings = options || {};
  settings.headers = Object.assign({}, settings.headers, { "x-conductor-token": TOKEN });
  const response = await fetch(path, settings);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
  return body;
}

async function checkDoctor() {
  setStatus("busy", "checking…");
  try {
    const report = await api("/api/doctor");
    if (report.ok) {
      setStatus("ok", report.servers.map((s) => s.name + " · " + s.toolCount + " tool(s)").join(" · "));
      banner("", "");
    } else {
      setStatus("bad", "not connected");
      banner("bad",
        "<b>After Effects is not reachable.</b> " + escapeHtml(report.detail || "") +
        "<br>Open After Effects, then <code>Window → Extensions → AfterEffects MCP Agent</code> and make sure it says Connected." +
        (report.sockets !== undefined ? " <br>Established panel sockets: <code>" + report.sockets + "</code> (healthy is 2)." : ""));
    }
  } catch (error) {
    setStatus("bad", "not connected");
    banner("bad", "<b>Could not reach After Effects.</b> " + escapeHtml(String(error.message)));
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderRecipes() {
  $("recipes").innerHTML = "";
  for (const recipe of recipes) {
    const button = document.createElement("button");
    button.className = "recipe";
    button.setAttribute("aria-pressed", String(selected && selected.id === recipe.id));
    button.innerHTML = "<b>" + escapeHtml(recipe.title) + "</b><span>" + escapeHtml(recipe.description) + "</span>";
    button.onclick = () => { selected = recipe; renderRecipes(); renderParams(); };
    $("recipes").appendChild(button);
  }
}

/** Turns camelCase into something readable: outputPath -> Output path. */
function humanLabel(name) {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function savedLogoLibrary(defaultPath) {
  try {
    const stored = JSON.parse(localStorage.getItem("conductor.logoLibrary") || "[]");
    const paths = Array.isArray(stored) ? stored.filter((value) => typeof value === "string") : [];
    return [...new Set([defaultPath, ...paths])];
  } catch {
    return [defaultPath];
  }
}

function storeLogoLibrary(paths) {
  try { localStorage.setItem("conductor.logoLibrary", JSON.stringify(paths)); }
  catch { /* the library is a convenience; recipe parameters remain authoritative */ }
}

function createParamControl(name, def) {
  let control;
  if (def.type === "enum") {
    control = document.createElement("select");
    for (const value of def.values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      if (value === def.default) option.selected = true;
      control.appendChild(option);
    }
  } else {
    control = document.createElement("input");
    control.type = def.type === "number"
      ? "number"
      : (def.type === "boolean" ? "checkbox" : "text");
    if (def.type === "boolean") control.checked = Boolean(def.default);
    else if (def.default !== undefined) control.value = String(def.default);
    if (def.type === "number") {
      if (def.min !== undefined) control.min = def.min;
      if (def.max !== undefined) control.max = def.max;
    }
  }
  control.id = "p_" + name;
  control.dataset.kind = def.type;
  control.addEventListener("input", () => {
    if (def.path === "save-file") control.dataset.autoSuggested = "false";
    if (selected && selected.id === "cinematic-look-lab" && name === "clip") {
      cinematicPreviews = {};
      renderLookCards();
    }
    updateReadiness();
  });
  return control;
}

function appendParamField(host, name, def, compact) {
  const field = el("div", "field");
  if (compact) field.classList.add("compact");
  const required = def.default === undefined && def.type !== "boolean";
  const control = createParamControl(name, def);
  const label = el("label", null, humanLabel(name));
  label.htmlFor = control.id;
  if (required) label.appendChild(el("span", "req", " *"));
  field.appendChild(label);

  if (def.path) {
    const row = el("div", "row");
    row.appendChild(control);
    const browse = el(
      "button",
      "browse",
      def.path === "save-file" ? "Save as…" : "Choose…",
    );
    browse.type = "button";
    browse.onclick = () => { void chooseFile(def, control); };
    row.appendChild(browse);
    field.appendChild(row);
    if (def.path === "save-file") void suggestOutput(name, def, control);
  } else {
    field.appendChild(control);
  }
  if (def.description) field.appendChild(el("div", "hint", def.description));
  host.appendChild(field);
  return control;
}

function appendCheckField(host, name, def) {
  const row = el("div", "check-field");
  const control = createParamControl(name, def);
  const label = el("label", null, def.description);
  label.htmlFor = control.id;
  row.appendChild(control);
  row.appendChild(label);
  host.appendChild(row);
  return control;
}

function renderLookCards() {
  const grid = $("lookGrid");
  if (!grid) return;
  const chosen = $("p_look") ? $("p_look").value : CINEMATIC_LOOKS[0][0];
  grid.innerHTML = "";
  CINEMATIC_LOOKS.forEach(([look, description], index) => {
    const card = el("button", "look-card");
    card.type = "button";
    card.dataset.look = look;
    card.setAttribute("aria-pressed", String(chosen === look));
    const preview = cinematicPreviews[look];
    if (preview) {
      const video = document.createElement("video");
      video.src = preview.videoUrl;
      video.poster = preview.thumbnailUrl;
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("aria-label", look + " preview");
      card.appendChild(video);
    } else {
      card.appendChild(el("div", "look-placeholder", "preview not generated"));
    }
    card.appendChild(el("b", null, look));
    card.appendChild(el("span", null, description));
    card.appendChild(el("span", "look-badge", chosen === look ? "SELECTED" : String(index + 1)));
    card.onclick = () => {
      $("p_look").value = look;
      renderLookCards();
      updateReadiness();
      if (cinematicPreviews[look]) openLookViewer(index);
    };
    grid.appendChild(card);
  });
}

function renderCinematicParams() {
  const defs = selected.params;
  const host = $("params");
  host.innerHTML = "";
  host.appendChild(el(
    "div",
    "lab-intro",
    "Generate all seven two-second comparisons from the same representative moment. "
      + "Choose in the gallery, inspect it larger with arrow navigation, then render only the winner.",
  ));

  appendParamField(host, "clip", defs.clip);
  appendParamField(host, "strength", defs.strength);

  const look = document.createElement("input");
  look.type = "hidden";
  look.id = "p_look";
  look.dataset.kind = "enum";
  look.value = defs.look.default;
  host.appendChild(look);
  const renderMode = document.createElement("input");
  renderMode.type = "hidden";
  renderMode.id = "p_renderMode";
  renderMode.dataset.kind = "enum";
  renderMode.value = "Full";
  host.appendChild(renderMode);

  const lookSection = el("div", "lab-section");
  lookSection.appendChild(el("h3", null, "Seven-look comparison"));
  lookSection.appendChild(el(
    "div",
    "lab-section-note",
    "Every sample uses the exact AE-native effect chain and HLG pipeline used by the final render.",
  ));
  const grid = el("div", "look-grid");
  grid.id = "lookGrid";
  lookSection.appendChild(grid);
  const progress = el("div", "preview-progress");
  progress.id = "previewProgress";
  lookSection.appendChild(progress);
  host.appendChild(lookSection);

  const branding = el("div", "lab-section");
  branding.appendChild(el("h3", null, "Project branding"));
  branding.appendChild(el(
    "div",
    "lab-section-note",
    "Brand layers sit above the grade, so their identity colors remain stable.",
  ));
  appendCheckField(branding, "logoEnabled", defs.logoEnabled);

  const logoField = el("div", "field");
  const logoLabel = el("label", null, "Logo library");
  logoLabel.htmlFor = "p_logoPath";
  logoField.appendChild(logoLabel);
  const logoRow = el("div", "brand-row");
  const logoSelect = document.createElement("select");
  logoSelect.id = "p_logoPath";
  logoSelect.dataset.kind = "string";
  const logos = savedLogoLibrary(defs.logoPath.default);
  for (const path of logos) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path.split("/").pop();
    logoSelect.appendChild(option);
  }
  logoSelect.addEventListener("input", updateReadiness);
  logoRow.appendChild(logoSelect);
  const addLogo = el("button", "browse", "Add logo…");
  addLogo.type = "button";
  addLogo.onclick = async () => {
    try {
      const result = await api("/api/choose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "open-file",
          prompt: "Choose a transparent logo image",
        }),
      });
      if (!result.path) return;
      const updated = [...new Set([...savedLogoLibrary(defs.logoPath.default), result.path])];
      storeLogoLibrary(updated);
      const option = document.createElement("option");
      option.value = result.path;
      option.textContent = result.path.split("/").pop();
      logoSelect.appendChild(option);
      logoSelect.value = result.path;
      updateReadiness();
    } catch (error) {
      banner("bad", escapeHtml(error.message));
    }
  };
  logoRow.appendChild(addLogo);
  logoField.appendChild(logoRow);
  logoField.appendChild(el(
    "div",
    "hint",
    "The bundled Sample mark is ready; added logo paths stay in this browser’s local library.",
  ));
  branding.appendChild(logoField);

  const logoGrid = el("div", "compact-grid");
  appendParamField(logoGrid, "logoPosition", defs.logoPosition, true);
  appendParamField(logoGrid, "logoWidthPercent", defs.logoWidthPercent, true);
  appendParamField(logoGrid, "logoVisibility", defs.logoVisibility, true);
  appendParamField(logoGrid, "logoXPercent", defs.logoXPercent, true);
  appendParamField(logoGrid, "logoYPercent", defs.logoYPercent, true);
  branding.appendChild(logoGrid);

  appendCheckField(branding, "watermarkEnabled", defs.watermarkEnabled);
  const watermarkGrid = el("div", "compact-grid");
  appendParamField(watermarkGrid, "watermarkText", defs.watermarkText, true);
  appendParamField(watermarkGrid, "watermarkFont", defs.watermarkFont, true);
  appendParamField(watermarkGrid, "watermarkVisibility", defs.watermarkVisibility, true);
  appendParamField(watermarkGrid, "watermarkMotion", defs.watermarkMotion, true);
  appendParamField(watermarkGrid, "watermarkSpeed", defs.watermarkSpeed, true);
  branding.appendChild(watermarkGrid);
  host.appendChild(branding);

  const delivery = el("div", "lab-section");
  delivery.appendChild(el("h3", null, "Selected-look delivery"));
  appendParamField(delivery, "outputPath", defs.outputPath);
  host.appendChild(delivery);

  $("btnDry").textContent = "Generate 7 previews";
  $("btnRun").textContent = "Render selected look";
  renderLookCards();
  updateReadiness();
}

async function chooseFile(def, control) {
  try {
    const result = await api("/api/choose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: def.path,
        prompt: def.description || "Choose a file",
        suggestedName: control.value ? control.value.split("/").pop() : undefined,
      }),
    });
    if (result.path) {
      control.value = result.path;
      if (def.path === "save-file") control.dataset.autoSuggested = "false";
      if (
        selected &&
        selected.id === "cinematic-look-lab" &&
        control.id === "p_clip"
      ) {
        cinematicPreviews = {};
        renderLookCards();
      }
      updateReadiness();
    }
  } catch (error) {
    banner("bad", escapeHtml(error.message));
  }
}

/** Fills a blank save-path with somewhere real, so no field starts as a dead end. */
async function suggestOutput(name, def, control, force) {
  if (control.value && !force) return;
  try {
    const result = await api("/api/suggest-output?recipe=" + encodeURIComponent(selected.id) +
      "&ext=" + encodeURIComponent(def.suggestedExtension || "mov"));
    if (result.path && (!control.value || force)) {
      control.value = result.path;
      control.dataset.autoSuggested = "true";
      updateReadiness();
    }
  } catch { /* a suggestion is a courtesy, not a requirement */ }
}

/** After a successful render, prepare a fresh automatic filename for the next clip. */
async function refreshAutoSuggestedOutputs() {
  if (!selected) return;
  for (const [name, def] of Object.entries(selected.params)) {
    if (def.path !== "save-file") continue;
    const control = $("p_" + name);
    if (!control || control.dataset.autoSuggested !== "true") continue;
    control.value = "";
    await suggestOutput(name, def, control, true);
  }
}

/** Required fields drive the Run button, so a click can never land on a validation error. */
function updateReadiness() {
  if (!selected) return;
  const missing = [];
  for (const [name, def] of Object.entries(selected.params)) {
    const required = def.default === undefined && def.type !== "boolean";
    const control = $("p_" + name);
    if (required && control && !control.value.trim()) missing.push(name);
  }
  $("btnRun").disabled = running || missing.length > 0;
  $("btnDry").disabled = running || missing.length > 0;
  $("needs").textContent = missing.length === 0
    ? ""
    : "Still needed: " + missing.map(humanLabel).join(", ");
}

function renderParams() {
  if (!selected) return;
  $("paramsTitle").textContent = selected.title;
  if (selected.id === "cinematic-look-lab") {
    renderCinematicParams();
    return;
  }
  $("btnDry").textContent = "Preview plan";
  $("btnRun").textContent = "Build & render";
  const host = $("params");
  host.innerHTML = "";
  for (const [name, def] of Object.entries(selected.params)) {
    const field = document.createElement("div");
    field.className = "field";
    const required = def.default === undefined && def.type !== "boolean";
    let control;
    if (def.type === "enum") {
      control = document.createElement("select");
      for (const value of def.values) {
        const option = document.createElement("option");
        option.value = value; option.textContent = value;
        if (value === def.default) option.selected = true;
        control.appendChild(option);
      }
    } else {
      control = document.createElement("input");
      control.type = def.type === "number" ? "number" : (def.type === "boolean" ? "checkbox" : "text");
      if (def.type === "boolean") control.checked = Boolean(def.default);
      else if (def.default !== undefined) control.value = String(def.default);
      if (def.type === "number") { if (def.min !== undefined) control.min = def.min; if (def.max !== undefined) control.max = def.max; }
      if (required) control.placeholder = def.path ? "choose a file…" : "required";
    }
    control.id = "p_" + name;
    control.dataset.kind = def.type;
    control.addEventListener("input", () => {
      if (def.path === "save-file") control.dataset.autoSuggested = "false";
      updateReadiness();
    });

    const label = el("label", null, humanLabel(name));
    label.htmlFor = control.id;
    if (required) label.appendChild(el("span", "req", " *"));
    field.appendChild(label);

    if (def.path) {
      // Nobody types an absolute path. The server opens the real Finder dialog.
      const row = el("div", "row");
      row.appendChild(control);
      const browse = el("button", "browse", def.path === "save-file" ? "Save as…" : "Choose…");
      browse.type = "button";
      browse.onclick = () => { void chooseFile(def, control); };
      row.appendChild(browse);
      field.appendChild(row);
      if (def.path === "save-file") void suggestOutput(name, def, control);
    } else {
      field.appendChild(control);
    }

    if (def.description) field.appendChild(el("div", "hint", def.description));
    host.appendChild(field);
  }
  updateReadiness();
}

function collectParams() {
  const params = {};
  for (const [name, def] of Object.entries(selected.params)) {
    const control = $("p_" + name);
    if (!control) continue;
    if (def.type === "boolean") { params[name] = control.checked; continue; }
    const raw = control.value;
    if (raw === "") continue;
    params[name] = def.type === "number" ? Number(raw) : raw;
  }
  return params;
}

/** Builds a node with text set safely. Never interpolate into innerHTML here:
 *  step ids and error messages come from After Effects, not from us. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function finishInteraction() {
  running = false;
  updateReadiness();
}

function appendOutputRow(parent, entry, buttonText) {
  const row = el("div", "queued-row");
  row.appendChild(el("code", null, entry.outputPath));
  const reveal = el("button", "browse", buttonText);
  reveal.type = "button";
  reveal.onclick = () => {
    void api("/api/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: entry.outputPath }),
    }).catch((error) => banner("bad", escapeHtml(error.message)));
  };
  row.appendChild(reveal);
  parent.appendChild(row);
}

async function startPrivacyClean() {
  const utility = $("btnPrivacyClean");
  utility.disabled = true;
  $("outTitle").textContent = "Privacy Clean";
  $("out").innerHTML = '<div class="empty">Choose an image or video…</div>';
  try {
    const chosen = await api("/api/choose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "open-file",
        prompt: "Choose an image or video to clean",
      }),
    });
    if (!chosen.path) {
      $("out").innerHTML = '<div class="empty">Nothing was changed.</div>';
      return;
    }

    $("out").innerHTML = '<div class="empty">Removing embedded metadata and verifying the copy…</div>';
    const result = await api("/api/privacy-clean", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: chosen.path }),
    });

    const panel = el("div", "banner ok");
    panel.appendChild(el("b", null, "Privacy-clean copy verified."));
    panel.appendChild(document.createTextNode(
      " The original was preserved and the media was not recompressed."));
    panel.appendChild(el(
      "div",
      "queued-note",
      result.removedMetadataFields > 0
        ? "Removed " + result.removedMetadataFields + " embedded metadata field"
          + (result.removedMetadataFields === 1 ? "." : "s.")
        : "No identifying embedded metadata was present; a clean copy was still created.",
    ));
    appendOutputRow(panel, result, "Show in Finder");
    $("out").innerHTML = "";
    $("out").appendChild(panel);
  } catch (error) {
    $("out").innerHTML =
      '<div class="banner bad"><b>Privacy Clean failed.</b> '
      + escapeHtml(error.message) + "</div>";
  } finally {
    utility.disabled = false;
  }
}

function renderSteps(steps) {
  const marks = { succeeded: ["✓", "s-ok"], failed: ["✕", "s-fail"], skipped: ["–", "s-skip"], running: ["●", "s-run"] };
  const list = el("ul", "steps");
  for (const step of steps) {
    const [glyph, cls] = marks[step.status] || ["•", ""];
    const li = document.createElement("li");
    li.appendChild(el("span", "mark " + cls, glyph));
    const body = el("div");
    body.appendChild(el("div", "id", step.id));
    body.appendChild(el("div", "meta",
      (step.operation || "") +
      (step.durationMs !== undefined ? " · " + Math.round(step.durationMs) + " ms" : "")));
    if (step.error && step.error.message) body.appendChild(el("div", "err", step.error.message));
    li.appendChild(body);
    list.appendChild(li);
  }
  return list;
}

/**
 * Renders only the queue entries created by the recipe that just completed.
 * Older items may still be waiting in After Effects; silently rendering those
 * would turn convenience into a nasty surprise.
 */
function startRender(queued) {
  const indices = queued.map((entry) => entry.renderQueueIndex);
  if (indices.some((index) => !Number.isInteger(index) || index < 1)) {
    const failure = el("div", "banner bad");
    failure.appendChild(el("b", null, "Could not start the render."));
    failure.appendChild(document.createTextNode(
      " Conductor could not identify the exact render queue item it just created."));
    $("out").prepend(failure);
    finishInteraction();
    return;
  }

  $("outTitle").textContent = "Rendering";
  const panel = el("div", "banner warn");
  const status = el("div");
  status.appendChild(el("b", null, "Starting Adobe’s renderer…"));
  panel.appendChild(status);
  const log = el("pre", "render-log");
  log.hidden = true;
  panel.appendChild(log);
  $("out").prepend(panel);

  const source = new EventSource(
    "/api/render?token=" + encodeURIComponent(TOKEN)
      + "&indices=" + encodeURIComponent(indices.join(",")),
  );
  let settled = false;

  source.addEventListener("start", (event) => {
    const payload = JSON.parse(event.data);
    status.textContent = "Rendering " + payload.indices.length + " output"
      + (payload.indices.length === 1 ? "" : "s") + "…";
  });
  source.addEventListener("item", (event) => {
    const payload = JSON.parse(event.data);
    status.textContent =
      payload.status === "completed"
        ? "Finished output " + payload.position + " of " + payload.total + "."
        : payload.status === "encoding"
          ? "Encoding and verifying 10-bit HLG output "
            + payload.position + " of " + payload.total + "…"
          : "Rendering output " + payload.position + " of " + payload.total + "…";
  });
  source.addEventListener("log", (event) => {
    const payload = JSON.parse(event.data);
    log.hidden = false;
    log.textContent = (log.textContent + payload.text + "\n").slice(-20_000);
    log.scrollTop = log.scrollHeight;
  });
  source.addEventListener("done", (event) => {
    settled = true;
    const payload = JSON.parse(event.data);
    source.close();
    panel.className = "banner " + (payload.status === "completed" ? "ok" : "bad");
    panel.innerHTML = "";
    if (payload.status === "completed") {
      const hlg = queued.some((entry) => entry.postProcess === "hevc-hlg");
      panel.appendChild(el("b", null, hlg ? "HDR render finished and verified." : "Render finished."));
      panel.appendChild(document.createTextNode(
        hlg
          ? " The delivery is HEVC Main 10 with BT.2020 and HLG metadata."
          : " Your file" + (queued.length === 1 ? " is" : "s are") + " ready."));
      for (const entry of queued) appendOutputRow(panel, entry, "Show in Finder");
      // An automatically suggested path belongs to the render that just
      // finished. Reusing it for the next clip would silently overwrite the
      // previous delivery and can leave duplicate AE output modules.
      void refreshAutoSuggestedOutputs();
    } else {
      panel.appendChild(el("b", null, "Render failed."));
      panel.appendChild(document.createTextNode(" " + (payload.error || "")));
      if (payload.tail) {
        const tail = el("pre", "render-log", payload.tail);
        panel.appendChild(tail);
      }
    }
    finishInteraction();
  });
  source.onerror = () => {
    if (settled) return;
    settled = true;
    source.close();
    panel.className = "banner bad";
    panel.textContent = "Lost the connection while rendering.";
    finishInteraction();
  };
}

function runRecipeOnce(params, onStep) {
  return new Promise((resolve, reject) => {
    const source = new EventSource(
      "/api/run?token=" + encodeURIComponent(TOKEN)
        + "&recipe=" + encodeURIComponent(selected.id)
        + "&params=" + encodeURIComponent(JSON.stringify(params)),
    );
    let settled = false;
    let stepFailure = "";
    source.addEventListener("step", (event) => {
      const step = JSON.parse(event.data);
      if (step.status === "failed" && step.error && step.error.message) {
        stepFailure = step.id + ": " + step.error.message;
      }
      if (onStep) onStep(step);
    });
    source.addEventListener("done", (event) => {
      settled = true;
      source.close();
      const payload = JSON.parse(event.data);
      if (payload.status === "completed") {
        resolve(Array.isArray(payload.queued) ? payload.queued : []);
      } else {
        reject(new Error(
          (payload.error || "After Effects could not build the preview.")
            + (stepFailure ? " — " + stepFailure : "")
            + (Array.isArray(payload.fieldErrors) && payload.fieldErrors.length
              ? " " + payload.fieldErrors.join("; ")
              : ""),
        ));
      }
    });
    source.onerror = () => {
      if (settled) return;
      settled = true;
      source.close();
      reject(new Error("Lost the connection while building the preview."));
    };
  });
}

function renderQueuedOnce(queued, onStatus) {
  return new Promise((resolve, reject) => {
    const indices = queued.map((entry) => entry.renderQueueIndex);
    if (
      indices.length === 0 ||
      indices.some((index) => !Number.isInteger(index) || index < 1)
    ) {
      reject(new Error("Conductor did not receive an exact Adobe render queue item."));
      return;
    }
    const source = new EventSource(
      "/api/render?token=" + encodeURIComponent(TOKEN)
        + "&indices=" + encodeURIComponent(indices.join(",")),
    );
    let settled = false;
    source.addEventListener("item", (event) => {
      if (onStatus) onStatus(JSON.parse(event.data));
    });
    source.addEventListener("done", (event) => {
      settled = true;
      source.close();
      const payload = JSON.parse(event.data);
      if (payload.status === "completed") resolve(payload);
      else reject(new Error(
        (payload.error || "Adobe could not render the preview.")
          + (payload.tail ? "\n" + payload.tail : ""),
      ));
    });
    source.onerror = () => {
      if (settled) return;
      settled = true;
      source.close();
      reject(new Error("Lost the connection while rendering the preview."));
    };
  });
}

function setPreviewProgress(message, strong) {
  const progress = $("previewProgress");
  if (!progress) return;
  progress.innerHTML = "";
  if (strong) progress.appendChild(el("strong", null, strong));
  if (message) progress.appendChild(document.createTextNode((strong ? " " : "") + message));
}

async function generateCinematicPreviews() {
  running = true;
  updateReadiness();
  cinematicPreviews = {};
  renderLookCards();
  $("outTitle").textContent = "Cinematic preview laboratory";
  $("out").innerHTML =
    '<div class="banner warn"><b>Building seven real After Effects samples.</b> '
    + "Each look is rendered and color-managed individually; this is not a CSS mock-up.</div>";
  const baseParams = collectParams();
  const originalLook = baseParams.look || CINEMATIC_LOOKS[0][0];
  try {
    for (let index = 0; index < CINEMATIC_LOOKS.length; index += 1) {
      const look = CINEMATIC_LOOKS[index][0];
      setPreviewProgress(
        "Building " + look + " in After Effects…",
        "Look " + (index + 1) + " of " + CINEMATIC_LOOKS.length + ".",
      );
      const output = await api(
        "/api/cinematic/preview-output?look=" + encodeURIComponent(look),
      );
      const params = Object.assign({}, baseParams, {
        look,
        renderMode: "Preview",
        outputPath: output.path,
      });
      let latestStep = "";
      const queued = await runRecipeOnce(params, (step) => {
        if (step.status === "running" || step.status === "succeeded") latestStep = step.id;
        setPreviewProgress(
          "Building " + look + (latestStep ? " · " + latestStep : "") + "…",
          "Look " + (index + 1) + " of " + CINEMATIC_LOOKS.length + ".",
        );
      });
      await renderQueuedOnce(queued, (status) => {
        setPreviewProgress(
          status.status === "encoding"
            ? "Encoding the verified HLG sample for " + look + "…"
            : "Adobe is rendering " + look + "…",
          "Look " + (index + 1) + " of " + CINEMATIC_LOOKS.length + ".",
        );
      });
      const registered = await api("/api/cinematic/register-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ look, path: output.path }),
      });
      cinematicPreviews[look] = registered;
      renderLookCards();
    }
    $("p_look").value = originalLook;
    $("p_renderMode").value = "Full";
    renderLookCards();
    setPreviewProgress(
      "Click any thumbnail to inspect it larger. Use ← and → to compare.",
      "All seven previews are ready.",
    );
    $("out").innerHTML =
      '<div class="banner ok"><b>Seven-look comparison complete.</b> '
      + "Select a look in the gallery, inspect it at larger size, then use "
      + "<b>Render selected look</b> for the full source.</div>";
  } catch (error) {
    $("p_renderMode").value = "Full";
    setPreviewProgress("The completed thumbnails remain available.", "Preview generation stopped.");
    $("out").innerHTML =
      '<div class="banner bad"><b>Could not finish all seven previews.</b> '
      + escapeHtml(error.message) + "</div>";
  } finally {
    finishInteraction();
  }
}

function nextAvailablePreview(start, direction) {
  let index = start;
  for (let count = 0; count < CINEMATIC_LOOKS.length; count += 1) {
    index = (index + direction + CINEMATIC_LOOKS.length) % CINEMATIC_LOOKS.length;
    if (cinematicPreviews[CINEMATIC_LOOKS[index][0]]) return index;
  }
  return start;
}

function updateLookViewer() {
  const look = CINEMATIC_LOOKS[viewerIndex][0];
  const preview = cinematicPreviews[look];
  if (!preview) return;
  $("viewerTitle").textContent = look;
  $("viewerCount").textContent =
    (viewerIndex + 1) + " / " + CINEMATIC_LOOKS.length + " · " + look;
  const video = $("viewerVideo");
  if (video.src !== new URL(preview.videoUrl, location.href).href) {
    video.src = preview.videoUrl;
    video.load();
  }
  $("p_look").value = look;
  renderLookCards();
  void video.play().catch(() => undefined);
}

function openLookViewer(index) {
  viewerIndex = index;
  $("lookViewer").hidden = false;
  updateLookViewer();
}

function closeLookViewer() {
  $("lookViewer").hidden = true;
  const video = $("viewerVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
}

$("viewerClose").onclick = closeLookViewer;
$("viewerPrev").onclick = () => {
  viewerIndex = nextAvailablePreview(viewerIndex, -1);
  updateLookViewer();
};
$("viewerNext").onclick = () => {
  viewerIndex = nextAvailablePreview(viewerIndex, 1);
  updateLookViewer();
};
$("viewerFullscreen").onclick = () => {
  const video = $("viewerVideo");
  if (video.requestFullscreen) void video.requestFullscreen();
};
$("lookViewer").addEventListener("click", (event) => {
  if (event.target === $("lookViewer")) closeLookViewer();
});
document.addEventListener("keydown", (event) => {
  if ($("lookViewer").hidden) return;
  if (event.key === "Escape") closeLookViewer();
  if (event.key === "ArrowLeft") $("viewerPrev").click();
  if (event.key === "ArrowRight") $("viewerNext").click();
});

$("btnDoctor").onclick = checkDoctor;
$("btnPrivacyClean").onclick = () => { void startPrivacyClean(); };

$("btnDry").onclick = async () => {
  if (selected && selected.id === "cinematic-look-lab") {
    await generateCinematicPreviews();
    return;
  }
  $("outTitle").textContent = "Planned steps — nothing was touched";
  $("out").innerHTML = '<div class="empty">Resolving…</div>';
  try {
    const plan = await api("/api/dry-run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: selected.id, params: collectParams() }),
    });
    const summary = plan.steps.map((s) => ({ id: s.id, status: "skipped", operation: s.operation }));
    $("out").innerHTML = "";
    $("out").appendChild(renderSteps(summary));
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(plan, null, 2);
    $("out").appendChild(pre);
  } catch (error) {
    $("out").innerHTML = '<div class="banner bad">' + escapeHtml(error.message) + "</div>";
  }
};

$("btnRun").onclick = () => {
  running = true;
  updateReadiness();
  $("outTitle").textContent = "Running in After Effects";
  $("out").innerHTML = '<div class="empty">Starting…</div>';
  const steps = [];
  let settled = false;

  // EventSource cannot send headers, so the token travels as a query parameter.
  // It is not a secret from you — only from other origins, which cannot read it.
  const source = new EventSource("/api/run?token=" + encodeURIComponent(TOKEN) +
    "&recipe=" + encodeURIComponent(selected.id) +
    "&params=" + encodeURIComponent(JSON.stringify(collectParams())));

  const redraw = () => { $("out").innerHTML = ""; $("out").appendChild(renderSteps(steps)); };

  source.addEventListener("step", (event) => { steps.push(JSON.parse(event.data)); redraw(); });
  source.addEventListener("done", (event) => {
    settled = true;
    const payload = JSON.parse(event.data);
    source.close();
    redraw();
    if (payload.status === "completed") {
      const queued = Array.isArray(payload.queued) ? payload.queued : [];
      const note = el("div", "banner " + (queued.length > 0 ? "warn" : "ok"));
      note.appendChild(el("b", null, "Built in After Effects."));
      note.appendChild(document.createTextNode(
        " The composition is there now — press ⌘Z to step back through the work."));
      if (queued.length > 0) {
        note.appendChild(el("div", "queued-title", "Rendering now"));
        note.appendChild(el("div", "queued-note",
          "Conductor is handing the exact queue item it just created to Adobe’s "
          + "renderer. You do not need to open the Render Queue or press ⌘M."));
        for (const entry of queued) {
          appendOutputRow(note, entry, "Show folder");
          if (entry.templateApplied === null) {
            note.appendChild(el("div", "queued-note",
              "After Effects kept its default output module, so the format and file "
              + "extension are whatever that template specifies — not necessarily what "
              + "you typed."));
          }
        }
      }
      $("out").prepend(note);
      if (queued.length > 0) {
        startRender(queued);
        return;
      }
    } else {
      const note = el("div", "banner bad");
      note.appendChild(el("b", null, "Run failed."));
      note.appendChild(document.createTextNode(" " + (payload.error || "")));
      // Name the field and the reason. "failed validation" on its own tells
      // someone nothing they can act on.
      if (Array.isArray(payload.fieldErrors) && payload.fieldErrors.length > 0) {
        const list = el("ul");
        list.style.margin = "8px 0 0 18px";
        for (const detail of payload.fieldErrors) list.appendChild(el("li", null, detail));
        note.appendChild(list);
      }
      $("out").prepend(note);
    }
    finishInteraction();
  });
  source.onerror = () => {
    if (settled) return;
    settled = true;
    source.close();
    finishInteraction();
    $("out").prepend(Object.assign(document.createElement("div"),
      { className: "banner bad", textContent: "Lost the connection to Conductor." }));
  };
};

(async function start() {
  try {
    recipes = (await api("/api/recipes")).recipes;
    renderRecipes();
    if (recipes.length > 0) { selected = recipes[0]; renderRecipes(); renderParams(); }
  } catch (error) {
    $("recipes").innerHTML = '<div class="empty">' + escapeHtml(error.message) + "</div>";
  }
  await checkDoctor();
})();
</script>
</body>
</html>
`;
