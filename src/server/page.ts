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
  .banner.bad { background: rgba(240,122,122,.1); border: 1px solid rgba(240,122,122,.35); color: #ffc9c9; }
  .banner.warn { background: rgba(224,175,104,.1); border: 1px solid rgba(224,175,104,.35); color: #f3ddb6; }
  code { font-family: var(--mono); font-size: .93em; }
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
    </div>

    <div>
      <div class="panel" style="margin-bottom:22px">
        <h2 id="paramsTitle">Parameters</h2>
        <div id="params"><div class="empty">Choose a recipe.</div></div>
        <div class="actions">
          <button class="act" id="btnDry" disabled>Preview plan</button>
          <button class="act primary" id="btnRun" disabled>Run in After Effects</button>
          <button class="act" id="btnDoctor">Re-check connection</button>
        </div>
      </div>

      <div class="panel">
        <h2 id="outTitle">Output</h2>
        <div id="out"><div class="empty">Nothing yet. Preview a plan, or run a recipe.</div></div>
      </div>
    </div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
let recipes = [];
let selected = null;
let running = false;

function setStatus(kind, text) {
  $("dot").className = "dot " + kind;
  $("statusText").textContent = text;
}

function banner(kind, html) {
  $("banner").innerHTML = html ? '<div class="banner ' + kind + '">' + html + "</div>" : "";
}

async function api(path, options) {
  const response = await fetch(path, options);
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

function renderParams() {
  if (!selected) return;
  $("paramsTitle").textContent = selected.title;
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
      if (required) control.placeholder = "required";
    }
    control.id = "p_" + name;
    control.dataset.kind = def.type;
    const label = document.createElement("label");
    label.htmlFor = control.id;
    label.innerHTML = escapeHtml(name) + (required ? ' <span class="req">*</span>' : "");
    field.appendChild(label);
    field.appendChild(control);
    if (def.description) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = def.description;
      field.appendChild(hint);
    }
    host.appendChild(field);
  }
  $("btnDry").disabled = false;
  $("btnRun").disabled = running;
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

$("btnDoctor").onclick = checkDoctor;

$("btnDry").onclick = async () => {
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
  $("btnRun").disabled = true;
  $("btnDry").disabled = true;
  $("outTitle").textContent = "Running in After Effects";
  $("out").innerHTML = '<div class="empty">Starting…</div>';
  const steps = [];

  const source = new EventSource("/api/run?recipe=" + encodeURIComponent(selected.id) +
    "&params=" + encodeURIComponent(JSON.stringify(collectParams())));

  const redraw = () => { $("out").innerHTML = ""; $("out").appendChild(renderSteps(steps)); };

  source.addEventListener("step", (event) => { steps.push(JSON.parse(event.data)); redraw(); });
  source.addEventListener("done", (event) => {
    const payload = JSON.parse(event.data);
    redraw();
    const note = el("div", "banner " + (payload.status === "completed" ? "warn" : "bad"));
    if (payload.status === "completed") {
      note.appendChild(el("b", null, "Finished."));
      note.appendChild(document.createTextNode(
        " Look at After Effects — press ⌘Z to step back through the work. Journal: "));
      note.appendChild(el("code", null, payload.journalPath || ""));
    } else {
      note.appendChild(el("b", null, "Run failed."));
      note.appendChild(document.createTextNode(" " + (payload.error || "")));
    }
    $("out").prepend(note);
    source.close(); running = false; $("btnRun").disabled = false; $("btnDry").disabled = false;
  });
  source.onerror = () => {
    source.close(); running = false; $("btnRun").disabled = false; $("btnDry").disabled = false;
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
