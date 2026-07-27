/**
 * The Conductor console source, as one self-contained HTML document.
 *
 * Deliberately a single string rather than a browser bundle. The local server
 * serves this document directly. The static-console build extracts its one
 * stylesheet and one script into same-origin assets for the Director Worker,
 * while the local copy still works with no network at all.
 *
 * Note for anyone editing the script below: this is a String.raw template, so a
 * backtick or a `${` in the page's own JavaScript would be read by TypeScript
 * rather than by the browser. The page therefore concatenates strings and never
 * uses template literals.
 */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conductor</title>
<style>
  :root {
    --bg: #0c0d10; --panel: #14161b; --panel-2: #10131a;
    --line: #242832; --line-2: #333947;
    --ink: #e9ecf2; --ink-2: #a4acbb; --ink-3: #6b7488;
    --accent: #7aa2f7; --ok: #79c99a; --warn: #e0af68; --bad: #f07a7a;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--ink);
         font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  [hidden] { display: none !important; }
  .shell-tabs { height: 64px; padding: 0 22px; display: flex; align-items: stretch;
                border-bottom: 1px solid rgba(255,255,255,.045); background: rgba(7,7,10,.92); }
  .shell-tabs a { padding: 0 14px; display: inline-flex; align-items: center;
                  border-bottom: 2px solid transparent; color: rgba(242,239,234,.54);
                  font-size: 13px; text-decoration: none; }
  .shell-tabs a:hover { color: #f2efea; }
  .shell-tabs a.active { color: #a9c9e7; border-bottom-color: #8eabc8; }
  .connection-gate { min-height: calc(100vh - 64px); display: grid; place-items: center;
                     padding: 32px 22px; }
  .connection-card { width: min(560px,100%); padding: 22px; border: 1px solid var(--line);
                     border-radius: 12px; background: var(--panel); }
  .connection-card h1 { margin-bottom: 8px; font-size: 18px; }
  .connection-card p { color: var(--ink-2); line-height: 1.6; }
  .connection-command { display: block; margin: 16px 0; padding: 11px 12px;
                        border: 1px solid var(--line-2); border-radius: 8px;
                        background: #0f1116; color: var(--ink); user-select: all; }
  .connection-card button { padding: 9px 15px; border: 1px solid var(--line-2);
                            border-radius: 8px; background: #1a1e26; color: var(--ink);
                            cursor: pointer; }
  .connection-card button:hover:not(:disabled) { border-color: var(--accent); }
  .connection-card button:disabled { opacity: .45; cursor: wait; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 26px 24px 60px; }

  header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
           padding-bottom: 16px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
  .tag { font: 11px/1 var(--mono); color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  .status { margin-left: auto; display: flex; align-items: center; gap: 8px;
            font: 12px/1 var(--mono); color: var(--ink-2); max-width: 46ch;
            text-align: right; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ink-3); flex: none; }
  .dot.ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(121,201,154,.16); }
  .dot.bad { background: var(--bad); box-shadow: 0 0 0 3px rgba(240,122,122,.16); }
  .dot.busy { background: var(--warn); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }

  /* Controls on the left, the frame they describe on the right. Judging a
     watermark's size by reading "2.6%" is not judging it at all. */
  .grid { display: grid; grid-template-columns: 226px minmax(320px,1fr) minmax(300px,392px);
          gap: 20px; margin-top: 20px; align-items: start; }
  @media (max-width: 1360px) { .grid { grid-template-columns: 226px minmax(0,1fr); }
                               .stage-col { grid-column: 1 / -1; } }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .rail, .stage-col { position: sticky; top: 20px; }
  @media (max-width: 1360px) { .stage-col { position: static; } }
  @media (max-width: 900px) { .rail { position: static; } }

  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .panel-spaced-top { margin-top: 22px; }
  .panel-spaced-bottom { margin-bottom: 22px; }
  .panel h2 { font-size: 11px; font-family: var(--mono); letter-spacing: .1em;
              text-transform: uppercase; color: var(--ink-3); margin-bottom: 12px; }
  .panel-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
  .panel-title h2 { margin: 0; }
  .panel-title .sub { font-size: 11.5px; color: var(--ink-3); }

  .recipe { width: 100%; text-align: left; padding: 11px 12px; margin-bottom: 8px;
            background: transparent; border: 1px solid var(--line); border-radius: 9px;
            color: var(--ink); cursor: pointer; font: inherit; }
  .recipe:hover { border-color: var(--line-2); background: #171a20; }
  .recipe[aria-pressed="true"] { border-color: var(--accent); background: #171c28; }
  .recipe b { display: block; font-weight: 600; font-size: 13px; }
  .recipe span { display: block; margin-top: 3px; color: var(--ink-3); font-size: 11.5px; line-height: 1.45; }
  .rail-note { margin-top: 10px; color: var(--ink-3); font-size: 11px; line-height: 1.5; }

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
  button.browse:hover:not(:disabled) { border-color: var(--accent); }
  button.browse:disabled { opacity: .45; cursor: not-allowed; }
  .needs { align-self: center; font-size: 12px; color: var(--warn); }
  .queued-title { margin-top: 12px; font-weight: 700; font-size: 12.5px; }
  .queued-note { margin-top: 5px; font-size: 12px; line-height: 1.5; opacity: .92; }
  .queued-row { display: flex; gap: 9px; align-items: center; margin-top: 9px; flex-wrap: wrap; }
  .queued-row code { flex: 1; min-width: 260px; padding: 6px 9px; border-radius: 6px;
                     background: rgba(0,0,0,.28); font-size: 11.5px; word-break: break-all; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  input[type=checkbox] { width: auto; }

  /* Sliders: a number with no sense of its own range is not a control. */
  .slider-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .slider-head label { flex: 1; margin: 0; }
  .slider-head .value { font: 12px var(--mono); color: var(--ink); }
  input[type=range] { -webkit-appearance: none; appearance: none; width: 100%;
                      height: 22px; padding: 0; background: transparent; border: 0; }
  input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: #262b36; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
      width: 15px; height: 15px; margin-top: -5.5px; border-radius: 50%;
      background: var(--accent); border: 0; cursor: pointer; }
  input[type=range]:focus { outline: none; }
  input[type=range]:focus::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(122,162,247,.22); }

  /* Segmented control: every option visible, one click to change. */
  .segmented { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px;
               background: #0f1116; border: 1px solid var(--line-2); border-radius: 8px; }
  .segmented button { flex: 1 1 auto; padding: 6px 9px; border: 0; border-radius: 6px;
                      background: transparent; color: var(--ink-2);
                      font: 600 12px/1.2 inherit; cursor: pointer; white-space: nowrap; }
  /* Excluding the pressed state is not decoration: :hover would otherwise
     out-specify it, so pointing at the current choice would un-highlight it. */
  .segmented button:not([aria-pressed="true"]):hover:not(:disabled) { background: #191d26; color: var(--ink); }
  .segmented button[aria-pressed="true"] { background: var(--accent); color: #0b1020; }
  .segmented button:disabled { opacity: .5; cursor: not-allowed; }

  .actions { position: sticky; bottom: 0; display: flex; gap: 9px; flex-wrap: wrap; align-items: center;
             margin: 16px -16px -16px; padding: 14px 16px;
             border-top: 1px solid var(--line); background: var(--panel);
             border-radius: 0 0 11px 11px; }
  button.act { padding: 9px 15px; border-radius: 8px; border: 1px solid var(--line-2);
               background: #1a1e26; color: var(--ink); font: 600 13px/1 inherit; cursor: pointer; }
  button.act:hover:not(:disabled) { border-color: var(--accent); }
  button.act.primary { background: var(--accent); border-color: var(--accent); color: #0b1020; }
  button.act:disabled { opacity: .45; cursor: not-allowed; }
  button.act.small { padding: 6px 10px; font-size: 12px; }

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

  .lab-section { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
  .lab-section:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
  .lab-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .lab-head h3 { flex: 1; color: var(--ink); font-size: 13.5px; font-weight: 650; }
  .lab-section-note { margin: 0 0 12px; color: var(--ink-3); font-size: 11.5px; line-height: 1.5; }
  .lab-body[data-off="true"] { opacity: .38; pointer-events: none; filter: saturate(.4); }
  .compact-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 0 14px; }
  @media (max-width: 680px) { .compact-grid { grid-template-columns: 1fr; } }
  .brand-row { display: flex; gap: 8px; align-items: stretch; }
  .brand-row select { min-width: 0; flex: 1; }

  /* An on/off switch, because "should this layer exist" is not a form field. */
  .switch { position: relative; flex: none; width: 40px; height: 22px; }
  .switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0;
                  opacity: 0; cursor: pointer; z-index: 2; }
  .switch span { position: absolute; inset: 0; border-radius: 99px; background: #272c37;
                 border: 1px solid var(--line-2); transition: background .15s ease; }
  .switch span::after { content: ""; position: absolute; top: 2px; left: 2px;
                        width: 16px; height: 16px; border-radius: 50%; background: var(--ink-3);
                        transition: transform .15s ease, background .15s ease; }
  .switch input:checked + span { background: rgba(122,162,247,.28); border-color: var(--accent); }
  .switch input:checked + span::after { transform: translateX(18px); background: var(--accent); }
  .switch input:focus-visible + span { box-shadow: 0 0 0 3px rgba(122,162,247,.25); }

  .clip-info { margin: -6px 0 12px; font: 11.5px var(--mono); color: var(--ink-2); min-height: 16px; }
  .clip-info b { color: var(--ink); font-weight: 600; }

  .look-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; }
  @media (max-width: 1080px) { .look-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
  @media (max-width: 720px) { .look-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  .look-card { display: flex; flex-direction: column; overflow: hidden;
               border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); }
  .look-card[data-selected="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .look-card[data-busy="true"] { border-color: var(--warn); }
  .look-pick { position: relative; display: block; width: 100%; padding: 0; flex: 1;
               background: transparent; border: 0; color: var(--ink); text-align: left; cursor: pointer; }
  .look-pick:hover { background: #171a21; }
  .look-pick video, .look-pick img { display: block; width: 100%; height: 92px;
                                     object-fit: cover; background: #0b0c10; }
  .look-placeholder { height: 92px; display: grid; place-items: center;
                      background: radial-gradient(circle at 70% 20%, rgba(122,162,247,.16), transparent 44%),
                                  linear-gradient(145deg,#171a22,#0d0f14); color: var(--ink-3); font: 9.5px var(--mono);
                      letter-spacing: .06em; text-transform: uppercase; }
  .look-pick b { display: block; padding: 8px 9px 1px; font-size: 12px; line-height: 1.25; }
  .look-pick span.desc { display: block; min-height: 32px; padding: 2px 9px 8px;
                         color: var(--ink-3); font-size: 9.8px; line-height: 1.38; }
  .look-badge { position: absolute; top: 6px; right: 6px; padding: 2px 6px; border-radius: 99px;
                background: rgba(8,9,12,.82); color: var(--ink-2); font: 9px var(--mono); }
  .look-card[data-selected="true"] .look-badge { background: var(--accent); color: #0b1020; }
  .look-card[data-busy="true"] .look-badge { background: var(--warn); color: #241a08; }
  .look-actions { display: flex; gap: 5px; padding: 0 7px 7px; }
  .look-actions button { flex: 1; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--line-2);
                         background: #1a1e26; color: var(--ink-2); font: 600 10.5px/1.3 inherit; cursor: pointer; }
  .look-actions button:hover:not(:disabled) { border-color: var(--accent); color: var(--ink); }
  .look-actions button:disabled { opacity: .4; cursor: not-allowed; }

  .preview-progress { margin-top: 11px; color: var(--ink-2); font-size: 11.5px; min-height: 18px; }
  .preview-progress strong { color: var(--ink); }

  .motion-preview { margin-top: 4px; display: flex; gap: 14px; align-items: flex-start; }
  .motion-stage { flex: none; border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden;
                  background: repeating-conic-gradient(#12151c 0% 25%, #0e1116 0% 50%) 50% / 14px 14px; }
  .motion-legend { color: var(--ink-3); font-size: 11px; line-height: 1.6; }
  .motion-legend b { color: var(--ink-2); font-weight: 600; }

  /* The stage: the delivered frame, at the delivered aspect ratio. */
  .stage-tabs { display: flex; gap: 4px; padding: 3px; margin-bottom: 12px;
                background: #0f1116; border: 1px solid var(--line-2); border-radius: 8px; }
  .stage-tabs button { flex: 1; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent;
                       color: var(--ink-2); font: 600 12px/1.2 inherit; cursor: pointer; }
  .stage-tabs button:not([aria-pressed="true"]):hover:not(:disabled) { background: #191d26; color: var(--ink); }
  .stage-tabs button[aria-pressed="true"] { background: var(--accent); color: #0b1020; }
  .stage-tabs button:disabled { opacity: .4; cursor: not-allowed; }
  .stage-frame { position: relative; width: 100%; margin: 0 auto; overflow: hidden;
                 aspect-ratio: 9 / 16;
                 border: 1px solid var(--line-2); border-radius: 10px; background: #05060a;
                 background-image: repeating-conic-gradient(#111419 0% 25%, #0c0f14 0% 50%);
                 background-size: 18px 18px; }
  .stage-frame img.base { display: block; width: 100%; height: 100%; object-fit: cover; }
  .stage-frame .placeholder { position: absolute; inset: 0; display: grid; place-items: center;
                              padding: 18px; text-align: center; color: var(--ink-3);
                              font: 10.5px/1.7 var(--mono); letter-spacing: .04em; }
  .stage-frame img.logo { position: absolute; display: block; pointer-events: none;
                          width: 5.93%; left: 92.22%; top: 6.56%;
                          transform: translate(-50%, -50%); opacity: .5; }
  .stage-frame svg.mark { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .stage-caption { margin-top: 9px; color: var(--ink-3); font-size: 11px; line-height: 1.55; }
  .stage-caption b { color: var(--ink-2); font-weight: 600; }
  .stage-safe { position: absolute; pointer-events: none; border: 1px dashed rgba(122,162,247,.28); }
  .delivery-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .delivery-note { margin-top: 10px; padding: 9px 10px; border-radius: 8px;
                   background: rgba(224,175,104,.08); border: 1px solid rgba(224,175,104,.28);
                   color: #f3ddb6; font-size: 11px; line-height: 1.55; }
  .delivery-path { margin-top: 8px; padding: 7px 9px; border-radius: 6px; background: rgba(0,0,0,.3);
                   font: 11px var(--mono); color: var(--ink-2); word-break: break-all; }

  .viewer { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center;
            padding: 24px; background: rgba(3,4,7,.9); backdrop-filter: blur(12px); }
  .viewer[hidden] { display: none; }
  .viewer-shell { width: min(900px,96vw); max-height: 94vh; display: flex; flex-direction: column;
                  border: 1px solid var(--line-2); border-radius: 13px; overflow: hidden; background: #090a0d; }
  .viewer-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
                 border-bottom: 1px solid var(--line); }
  .viewer-head b { flex: 1; }
  .viewer video { display: block; width: 100%; max-height: calc(94vh - 100px); background: #000; }
  .viewer-image { display: block; width: 100%; max-height: calc(94vh - 100px);
                  object-fit: contain; background: #000; }
  .viewer-nav { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px; }
  .viewer-nav .act { min-width: 42px; }
  .field-errors { margin: 8px 0 0 18px; }
</style>
</head>
<body>
<nav class="shell-tabs" aria-label="Workspace">
  <a href="/director/">Director</a>
  <a class="active" href="/conductor/" aria-current="page">Conductor</a>
</nav>

<main class="connection-gate" id="connectionGate">
  <section class="connection-card" id="connectionCard" data-connection-state="not-started" aria-live="polite">
    <h1 id="connectionTitle">Connect to local Conductor</h1>
    <p id="connectionMessage">Start Conductor on this machine, then connect when you are ready.</p>
    <code class="connection-command" id="startCommand">conductor serve --no-open</code>
    <button type="button" id="retryConnection">Connect to local Conductor</button>
  </section>
</main>

<div class="wrap" id="console" hidden>
  <header>
    <h1>Conductor</h1>
    <span class="tag">motion recipes over MCP</span>
    <div class="status"><span class="dot" id="dot"></span><span id="statusText">checking…</span></div>
  </header>

  <div id="banner"></div>

  <div class="grid">
    <div class="rail">
      <div class="panel">
        <h2>Recipes</h2>
        <div id="recipes"><div class="empty">Loading…</div></div>
      </div>
      <div class="panel panel-spaced-top">
        <h2>Utilities</h2>
        <button class="recipe" id="btnPrivacyClean">
          <b>Privacy Clean Copy</b>
          <span>Choose an image or video. Conductor removes identifying metadata and saves a verified, non-destructive copy beside the original.</span>
        </button>
      </div>
    </div>

    <div>
      <div class="panel panel-spaced-bottom">
        <div class="panel-title">
          <h2 id="paramsTitle">Parameters</h2>
          <span class="sub" id="paramsSub"></span>
        </div>
        <div id="params"><div class="empty">Choose a recipe.</div></div>
        <div class="actions">
          <button class="act primary" id="btnRun" disabled>Build &amp; render</button>
          <button class="act" id="btnDry" disabled>Preview plan</button>
          <button class="act" id="btnDoctor">Re-check connection</button>
          <span class="needs" id="needs"></span>
        </div>
      </div>

      <div class="panel">
        <h2 id="outTitle">Output</h2>
        <div id="out"><div class="empty">Nothing yet. Preview a plan, or run a recipe.</div></div>
      </div>
    </div>

    <div class="stage-col" id="stageCol" hidden>
      <div class="panel">
        <div class="stage-tabs" role="tablist">
          <button type="button" id="tabPreview" aria-pressed="true">Live preview</button>
          <button type="button" id="tabDelivery" aria-pressed="false" disabled>Rendered</button>
        </div>
        <div id="stagePreview">
          <div class="stage-frame" id="stageFrame"></div>
          <div class="stage-caption" id="stageCaption"></div>
        </div>
        <div id="stageDelivery" hidden></div>
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
    <video id="viewerVideo" muted loop controls playsinline crossorigin="anonymous"></video>
    <img class="viewer-image" id="viewerImage" alt="" hidden crossorigin="anonymous">
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
let TOKEN = "__CONDUCTOR_SESSION_TOKEN__";
const API_BASE = "__CONDUCTOR_API_BASE__";
const HOSTED_CONSOLE = TOKEN === "";
const UNREACHABLE_TIMEOUT_MS = 5000;

if (!TOKEN && window.location.protocol === "https:") {
  $("startCommand").textContent =
    "CONDUCTOR_PUBLIC_ORIGIN=" + window.location.origin + " conductor serve --no-open";
}

function apiUrl(path) {
  return new URL(path, API_BASE || window.location.href).href;
}

function setStylesheetRule(selector, declarations) {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = Array.from(sheet.cssRules); } catch { continue; }
    const rule = rules.find((candidate) => candidate.selectorText === selector);
    if (!rule) continue;
    for (const [property, value] of Object.entries(declarations)) {
      rule.style.setProperty(property, value);
    }
    return;
  }
  throw new Error("Missing console stylesheet rule: " + selector);
}

function browserLoopbackFailureMessage() {
  const agent = navigator.userAgent;
  if (/Firefox\//.test(agent)) {
    return "Firefox blocked or could not reach the HTTPS → loopback connection. Use Chrome for the hosted console, or open http://127.0.0.1:4173 directly.";
  }
  if (/Safari\//.test(agent) && !/(Chrome|Chromium|CriOS)\//.test(agent)) {
    return "Safari blocked or could not reach the HTTPS → loopback connection. Use Chrome for the hosted console, or open http://127.0.0.1:4173 directly.";
  }
  return "Conductor is not reachable on this machine. Start it with the command below, allow Chrome’s Local Network Access prompt if it appears, then try again.";
}

function showConnectionState(state) {
  const card = $("connectionCard");
  const retry = $("retryConnection");
  $("connectionGate").hidden = false;
  $("console").hidden = true;
  card.dataset.connectionState = state;

  if (state === "not-started") {
    $("connectionTitle").textContent = "Connect to local Conductor";
    $("connectionMessage").textContent =
      "Start Conductor on this machine, then connect when you are ready.";
    retry.textContent = "Connect to local Conductor";
    retry.disabled = false;
    return;
  }
  if (state === "awaiting-permission") {
    $("connectionTitle").textContent = "Allow local Conductor access";
    $("connectionMessage").textContent =
      "Chrome may be waiting for your Local Network Access decision. Choose Allow to continue; Conductor will wait here without timing you out.";
    retry.textContent = "Awaiting permission…";
    retry.disabled = true;
    return;
  }

  $("connectionTitle").textContent = "Local Conductor was refused or is unreachable";
  $("connectionMessage").textContent = browserLoopbackFailureMessage();
  retry.textContent = "Try again";
  retry.disabled = false;
}

async function loopbackPermissionStatus() {
  if (!navigator.permissions || typeof navigator.permissions.query !== "function") return null;
  // Chrome 145 split the old permission into local-network and
  // loopback-network. The old name remains an alias in current Chrome and is
  // also useful while older supported releases are still in circulation.
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      return await navigator.permissions.query({ name });
    } catch { /* this browser does not expose that permission name */ }
  }
  return null;
}

async function connectToLocalConductor() {
  if (TOKEN && TOKEN !== "__CONDUCTOR_SESSION_TOKEN__") return true;

  showConnectionState("awaiting-permission");
  const controller = new AbortController();
  // Start fetch synchronously in the click handler, before the first await, so
  // Chrome sees the request as user-initiated and can show its LNA prompt.
  const permissionPromise = loopbackPermissionStatus();
  const responsePromise = fetch(apiUrl("/api/session"), {
    cache: "no-store",
    signal: controller.signal,
    targetAddressSpace: "loopback",
  });
  let permission = null;
  let timer = null;
  let permissionChanged = null;

  const armUnreachableTimeout = () => {
    if (timer !== null) return;
    timer = setTimeout(() => controller.abort(), UNREACHABLE_TIMEOUT_MS);
  };

  try {
    permission = await permissionPromise;
    if (permission === null || permission.state === "granted") {
      armUnreachableTimeout();
    } else if (permission.state === "denied") {
      controller.abort();
    } else {
      // A prompt is a human decision, not a network timeout. Only start the
      // unreachable timer after Chrome reports that permission was granted.
      permissionChanged = () => {
        if (permission.state === "granted") {
          $("connectionMessage").textContent =
            "Permission accepted. Looking for the Conductor engine on this machine.";
          armUnreachableTimeout();
        } else if (permission.state === "denied") {
          controller.abort();
        }
      };
      permission.addEventListener("change", permissionChanged);
    }

    const response = await responsePromise;
    const body = await response.json();
    if (!response.ok || typeof body.token !== "string") {
      throw new Error(body.error || ("HTTP " + response.status));
    }
    TOKEN = body.token;
    return true;
  } catch (error) {
    console.warn("Conductor loopback probe failed:", error);
    showConnectionState("refused-unreachable");
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (permission !== null && permissionChanged !== null) {
      permission.removeEventListener("change", permissionChanged);
    }
  }
}

const LAB = "cinematic-look-lab";
/* The Studio recipe is a strict superset of the technical grade — its
   "Technical HDR" look IS that grade — so offering both as separate pages only
   asked people to guess which one they wanted. The recipe is still there for
   the CLI and the library; it just no longer needs a page of its own. */
const HIDDEN_RECIPES = ["hdr-safe-grade"];

const CINEMATIC_LOOKS = [
  ["Technical HDR", "No look at all. Colour-managed HLG only — the honest baseline."],
  ["Clean Cinema", "Balanced contrast, restrained colour and fine texture."],
  ["Golden Hour", "Warm sunlight, protected highlights and healthy skin tones."],
  ["Teal & Amber", "Cool shadows and warm highlights with controlled separation."],
  ["Dream Bloom", "Soft highlight bloom with a delicate rose atmosphere."],
  ["Film Noir", "Sculpted monochrome, silver tint and tactile grain."],
  ["Neon Night", "Cyan-violet separation, deep night contrast and luminous glow."],
  ["Bleach Bypass", "Lower colour, harder contrast and a photochemical edge."],
];
const WATERMARK_MOTIONS = ["Drift", "Orbit", "Figure Eight", "Vertical", "Horizontal", "Static"];

let recipes = [];
let selected = null;
let running = false;
let cinematicPreviews = {};
let viewerIndex = 0;
let selectedLook = CINEMATIC_LOOKS[1][0];
let generatingLook = null;
let clipInfo = null;
let clipInfoToken = 0;
let sourceFrameUrl = null;
let stageTab = "preview";
let lastDelivery = null;

/* Mirrors the placement constants in the ExtendScript that actually positions
   the logo. If these two ever disagree, the stage is lying. */
const LOGO_PRESETS = {
  "Top Right": [92.2222, 6.5625],
  "Top Left": [7.7778, 6.5625],
  "Bottom Right": [92.2222, 93.4375],
  "Bottom Left": [7.7778, 93.4375],
};

/* Motion belongs to the console, not to the recipe: the recipe receives the
   finished path. Keeping the shape controls here is what lets speed be a real
   number rather than three buttons. */
let motionState = {
  motion: "Drift",
  secondsPerLoop: 10,
  travel: 55,
  centerX: 50,
  centerY: 50,
};

function loadMotionState() {
  try {
    const stored = JSON.parse(localStorage.getItem("conductor.watermarkMotion") || "null");
    if (stored && typeof stored === "object") {
      motionState = Object.assign({}, motionState, stored);
    }
  } catch { /* a remembered preference is a convenience, never a requirement */ }
}

function saveMotionState() {
  try { localStorage.setItem("conductor.watermarkMotion", JSON.stringify(motionState)); }
  catch { /* private browsing; the controls still work for this session */ }
}

/* ---------------------------------------------------------------------------
 * Watermark motion. Mirrors src/recipes/watermarkMotion.ts so the console can
 * draw the path and honour the clip's real duration without a round trip.
 * ------------------------------------------------------------------------ */
const EDGE_MARGIN = 0.05;

function clampToFrame(value) {
  return Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value));
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/* Drift's vertical component swings three times per loop, so a fixed
   per-loop sample count would give it a third of the resolution. */
function harmonic(motion) {
  if (motion === "Drift") return 3;
  if (motion === "Figure Eight") return 2;
  return 1;
}

function unitOffset(motion, u) {
  const tau = Math.PI * 2;
  if (motion === "Orbit") return [Math.cos(tau * u), Math.sin(tau * u)];
  if (motion === "Figure Eight") return [Math.sin(tau * u), Math.sin(tau * u * 2) / 2];
  if (motion === "Vertical") return [0, Math.sin(tau * u)];
  if (motion === "Horizontal") return [Math.sin(tau * u), 0];
  if (motion === "Static") return [0, 0];
  return [Math.sin(tau * u * 2 + 0.7), Math.sin(tau * u * 3)];
}

function watermarkPathKeyframes(options) {
  const centerX = clampToFrame(options.centerXPercent / 100);
  const centerY = clampToFrame(options.centerYPercent / 100);
  if (options.motion === "Static" || options.travel <= 0) {
    const value = [round4(centerX), round4(centerY)];
    return [{ time: 0, value }, { time: 1, value }];
  }
  const cycles = Math.max(0.05, options.cycles);
  const perOscillation = Math.max(8, options.samplesPerCycle || 24);
  const amplitude = (Math.min(100, Math.max(0, options.travel)) / 100) * 0.45;
  const samples = Math.min(
    600,
    Math.max(4, Math.ceil(cycles * perOscillation * harmonic(options.motion))),
  );
  const keyframes = [];
  for (let index = 0; index <= samples; index += 1) {
    const time = index / samples;
    const offset = unitOffset(options.motion, time * cycles);
    keyframes.push({
      time: round4(time),
      value: [
        round4(clampToFrame(centerX + offset[0] * amplitude)),
        round4(clampToFrame(centerY + offset[1] * amplitude)),
      ],
    });
  }
  return keyframes;
}

function fullDurationSeconds() {
  return clipInfo && clipInfo.durationSeconds > 0 ? clipInfo.durationSeconds : 10;
}

function previewDurationSeconds() {
  if (clipInfo && clipInfo.previewDurationSeconds > 0) return clipInfo.previewDurationSeconds;
  return Math.min(2, fullDurationSeconds());
}

/** The path the recipe receives, at the rate this clip will actually play. */
function watermarkPathFor(renderMode) {
  const duration = renderMode === "Preview" ? previewDurationSeconds() : fullDurationSeconds();
  return watermarkPathKeyframes({
    motion: motionState.motion,
    cycles: duration / Math.max(0.5, motionState.secondsPerLoop),
    travel: motionState.travel,
    centerXPercent: motionState.centerX,
    centerYPercent: motionState.centerY,
  });
}

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
  const response = await fetch(apiUrl(path), settings);
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

/** Builds a node with text set safely. Never interpolate into innerHTML here:
 *  step ids and error messages come from After Effects, not from us. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function visibleRecipes() {
  return recipes.filter((recipe) => HIDDEN_RECIPES.indexOf(recipe.id) < 0);
}

function renderRecipes() {
  $("recipes").innerHTML = "";
  for (const recipe of visibleRecipes()) {
    const button = document.createElement("button");
    button.className = "recipe";
    button.setAttribute("aria-pressed", String(Boolean(selected) && selected.id === recipe.id));
    button.innerHTML = "<b>" + escapeHtml(recipe.title) + "</b><span>" + escapeHtml(recipe.description) + "</span>";
    button.onclick = () => { selected = recipe; renderRecipes(); renderParams(); };
    $("recipes").appendChild(button);
  }
  $("recipes").appendChild(el(
    "div",
    "rail-note",
    "The technical HDR grade lives inside HDR Cinema Studio as the "
      + "“Technical HDR” look — pick it and switch the logo and watermark off.",
  ));
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
    if (selected && selected.id === LAB && name === "clip") onClipChanged();
    updateReadiness();
    stageNeedsRepaint();
  });
  return control;
}

/** Repaints the stage after any control changes, when there is one on screen. */
function stageNeedsRepaint() {
  if (selected && selected.id === LAB) renderStage();
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

/**
 * A number with a range is a slider. Typed numbers are still available — the
 * readout is an input — but the point of a slider is that you can feel the
 * range instead of guessing at it.
 */
function appendSlider(host, name, def, options) {
  const settings = options || {};
  const min = settings.min !== undefined ? settings.min : (def.min !== undefined ? def.min : 0);
  const max = settings.max !== undefined ? settings.max : (def.max !== undefined ? def.max : 100);
  const step = settings.step !== undefined ? settings.step : (def.integer ? 1 : 0.1);
  const initial = settings.value !== undefined ? settings.value : def.default;

  const field = el("div", "field");
  const head = el("div", "slider-head");
  const label = el("label", null, settings.label || humanLabel(name));
  head.appendChild(label);
  const readout = el("span", "value");
  head.appendChild(readout);
  field.appendChild(head);

  const control = document.createElement("input");
  control.type = "range";
  control.min = String(min);
  control.max = String(max);
  control.step = String(step);
  control.value = String(initial === undefined ? min : initial);
  control.id = "p_" + name;
  control.dataset.kind = "number";
  label.htmlFor = control.id;

  const format = settings.format || ((value) => String(Math.round(value * 100) / 100) + (settings.unit || ""));
  const paint = () => { readout.textContent = format(Number(control.value)); };
  paint();
  control.addEventListener("input", () => {
    paint();
    if (settings.onInput) settings.onInput(Number(control.value));
    updateReadiness();
    stageNeedsRepaint();
  });

  field.appendChild(control);
  if (settings.hint || def.description) {
    field.appendChild(el("div", "hint", settings.hint || def.description));
  }
  host.appendChild(field);
  return control;
}

/** An enum small enough to show whole is a segmented control, not a menu. */
function appendSegmented(host, name, values, initial, options) {
  const settings = options || {};
  const field = el("div", "field");
  if (settings.label !== null) {
    field.appendChild(el("label", null, settings.label || humanLabel(name)));
  }

  const holder = document.createElement("input");
  holder.type = "hidden";
  holder.id = "p_" + name;
  holder.dataset.kind = "enum";
  holder.value = initial;
  field.appendChild(holder);

  const group = el("div", "segmented");
  const buttons = [];
  for (const value of values) {
    const button = el("button", null, settings.short ? settings.short(value) : value);
    button.type = "button";
    button.setAttribute("aria-pressed", String(value === initial));
    button.onclick = () => {
      if (running) return;
      holder.value = value;
      for (const other of buttons) {
        other.setAttribute("aria-pressed", String(other.dataset.value === value));
      }
      if (settings.onChange) settings.onChange(value);
      updateReadiness();
      stageNeedsRepaint();
    };
    button.dataset.value = value;
    buttons.push(button);
    group.appendChild(button);
  }
  field.appendChild(group);
  if (settings.hint) field.appendChild(el("div", "hint", settings.hint));
  host.appendChild(field);
  return holder;
}

/** A section that can be switched off entirely, and visibly is. */
function appendToggleSection(host, title, note, name, def) {
  const section = el("div", "lab-section");
  const head = el("div", "lab-head");
  head.appendChild(el("h3", null, title));

  const control = createParamControl(name, def);
  const wrapper = el("label", "switch");
  wrapper.appendChild(control);
  wrapper.appendChild(el("span"));
  wrapper.title = def.description;
  head.appendChild(wrapper);
  section.appendChild(head);
  if (note) section.appendChild(el("div", "lab-section-note", note));

  const body = el("div", "lab-body");
  body.dataset.off = String(!control.checked);
  control.addEventListener("change", () => {
    body.dataset.off = String(!control.checked);
    updateReadiness();
    stageNeedsRepaint();
  });
  section.appendChild(body);
  host.appendChild(section);
  return body;
}

function appendSection(host, title, note) {
  const section = el("div", "lab-section");
  const head = el("div", "lab-head");
  head.appendChild(el("h3", null, title));
  section.appendChild(head);
  if (note) section.appendChild(el("div", "lab-section-note", note));
  const body = el("div");
  section.appendChild(body);
  host.appendChild(section);
  return { section, head, body };
}

/* ---------------------------------------------------------------------------
 * The look gallery
 * ------------------------------------------------------------------------ */

function lookDescription(look) {
  for (const entry of CINEMATIC_LOOKS) if (entry[0] === look) return entry[1];
  return "";
}

function renderLookCards() {
  const grid = $("lookGrid");
  if (!grid) return;
  grid.innerHTML = "";
  CINEMATIC_LOOKS.forEach(([look, description], index) => {
    const preview = cinematicPreviews[look];
    const busy = generatingLook === look;
    const card = el("div", "look-card");
    card.dataset.selected = String(selectedLook === look);
    card.dataset.busy = String(busy);

    const pick = el("button", "look-pick");
    pick.type = "button";
    pick.title = preview
      ? "Put this look on the stage — click again to clear it, double-click to inspect it larger"
      : "Select this look and build its sample";
    if (preview && preview.imageUrl) {
      const image = document.createElement("img");
      image.crossOrigin = "anonymous";
      image.src = apiUrl(preview.imageUrl);
      image.alt = look + " sample";
      pick.appendChild(image);
    } else if (preview) {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.src = apiUrl(preview.videoUrl);
      video.poster = apiUrl(preview.thumbnailUrl);
      video.preload = "metadata";
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute("aria-label", look + " preview");
      pick.appendChild(video);
      pick.onmouseenter = () => { void video.play().catch(() => undefined); };
      pick.onmouseleave = () => { video.pause(); video.currentTime = 0; };
    } else {
      pick.appendChild(el("div", "look-placeholder", busy ? "building…" : "no sample yet"));
    }
    pick.appendChild(el("b", null, look));
    pick.appendChild(el("span", "desc", description));
    pick.appendChild(el(
      "span",
      "look-badge",
      busy ? "…" : (selectedLook === look ? "SELECTED" : String(index + 1)),
    ));
    pick.onclick = () => { selectLook(look, { toggle: true, generate: true }); };
    pick.ondblclick = () => { if (cinematicPreviews[look]) openLookViewer(index); };
    card.appendChild(pick);

    const actions = el("div", "look-actions");
    const generate = el("button", null, busy ? "Building…" : (preview ? "Regenerate" : "Generate"));
    generate.type = "button";
    generate.disabled = running;
    generate.title = "Build one After Effects frame of " + look;
    generate.onclick = () => { void generateOneLook(look); };
    actions.appendChild(generate);

    const view = el("button", null, "View");
    view.type = "button";
    view.disabled = !preview;
    view.title = preview ? "Inspect this sample at a larger size" : "Generate a sample first";
    view.onclick = () => { openLookViewer(index); };
    actions.appendChild(view);
    card.appendChild(actions);

    grid.appendChild(card);
  });
  const generateAll = $("btnGenerateAll");
  if (generateAll) generateAll.disabled = running;
}

/**
 * Selecting the look that is already selected clears it.
 *
 * "No look" is a real answer — it is what Technical HDR means — and a radio
 * group with no way back to it is a trap. Clicking the chosen card again
 * returns to the ungraded baseline.
 */
function selectLook(look, options) {
  const settings = options || {};
  const cleared = settings.toggle === true && selectedLook === look;
  selectedLook = cleared ? CINEMATIC_LOOKS[0][0] : look;
  renderLookCards();
  const run = $("btnRun");
  if (run) run.textContent = "Render " + selectedLook;
  updateReadiness();
  renderStage();
  if (!cleared && settings.generate === true) void autoGenerateStill(selectedLook);
}

/* ---------------------------------------------------------------------------
 * The clip, and what the console knows about it
 * ------------------------------------------------------------------------ */

function renderClipInfo() {
  const line = $("clipInfo");
  if (!line) return;
  line.innerHTML = "";
  const control = $("p_clip");
  if (!control || control.value.trim() === "") {
    line.appendChild(el("span", null, "Choose a clip to grade."));
    return;
  }
  if (clipInfo === null) {
    line.appendChild(el("span", null, "Reading the clip in After Effects…"));
    return;
  }
  if (clipInfo.unavailable) {
    line.appendChild(el("span", null,
      "After Effects could not read this clip yet, so speed is estimated against a 10-second clip."));
    return;
  }
  const parts = [
    clipInfo.width + "×" + clipInfo.height,
    (Math.round(clipInfo.frameRate * 100) / 100) + " fps",
    (Math.round(clipInfo.durationSeconds * 10) / 10) + " s",
    clipInfo.hasAudio ? "audio" : "no audio",
  ];
  const strong = el("b", null, parts.join("  ·  "));
  line.appendChild(strong);
  line.appendChild(document.createTextNode(
    "   samples use the middle " + (Math.round(previewDurationSeconds() * 10) / 10) + " s",
  ));
}

let clipInfoTimer = null;
function onClipChanged() {
  cinematicPreviews = {};
  clipInfo = null;
  sourceFrameUrl = null;
  renderLookCards();
  renderClipInfo();
  renderStage();
  if (clipInfoTimer !== null) clearTimeout(clipInfoTimer);
  clipInfoTimer = setTimeout(() => { void adoptClip(); }, 500);
}

/**
 * Everything the console can learn about a clip without being asked.
 *
 * A frame is pulled straight from the file first, so the stage has something
 * real immediately — you can place a logo before After Effects has done
 * anything. The graded sample for the selected look follows.
 */
async function adoptClip() {
  await refreshClipInfo();
  await refreshSourceFrame();
  await autoGenerateStill(selectedLook);
}

async function refreshSourceFrame() {
  const control = $("p_clip");
  const path = control ? control.value.trim() : "";
  if (path === "" || path.charAt(0) !== "/") return;
  const ticket = clipInfoToken;
  try {
    const frame = await api("/api/source-frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clip: path,
        timeSeconds: clipInfo && clipInfo.durationSeconds > 0
          ? Math.max(0, (clipInfo.durationSeconds - previewDurationSeconds()) / 2)
          : 0,
      }),
    });
    if (ticket !== clipInfoToken) return;
    sourceFrameUrl = apiUrl(frame.imageUrl);
    renderStage();
  } catch { /* the stage simply stays empty until a look is generated */ }
}

async function refreshClipInfo() {
  const control = $("p_clip");
  const path = control ? control.value.trim() : "";
  if (path === "" || path.charAt(0) !== "/") { clipInfo = null; renderClipInfo(); return; }
  const ticket = ++clipInfoToken;
  try {
    const info = await api("/api/inspect-clip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (ticket !== clipInfoToken) return;
    clipInfo = info.available ? info : { unavailable: true };
  } catch {
    if (ticket !== clipInfoToken) return;
    clipInfo = { unavailable: true };
  }
  renderClipInfo();
  renderStage();
}

/** Used before a run, so the speed the path encodes matches this clip. */
async function ensureClipInfo() {
  if (clipInfo !== null && !clipInfo.unavailable) return;
  await refreshClipInfo();
}

/* ---------------------------------------------------------------------------
 * The parameter form
 * ------------------------------------------------------------------------ */

function renderCinematicParams() {
  const defs = selected.params;
  const host = $("params");
  host.innerHTML = "";
  $("paramsSub").textContent =
    "Grade, look, branding and delivery in one pass — switch off what you do not want.";

  const source = appendSection(
    host,
    "Source",
    "Everything below is built from this clip at its own size, rate and duration.",
  );
  appendParamField(source.body, "clip", defs.clip);
  const info = el("div", "clip-info");
  info.id = "clipInfo";
  source.body.appendChild(info);

  appendSegmented(source.body, "strength", defs.strength.values, defs.strength.default, {
    label: "HDR intensity",
    hint: defs.strength.description,
    short: (value) => value.replace(" HDR", ""),
  });

  const looks = appendSection(
    host,
    "Look",
    "Each sample is one real After Effects frame through the exact effect chain "
      + "the master uses — about ten seconds each, against a minute for a moving "
      + "sample. Selecting a look puts it on the stage and builds it if it is "
      + "missing; click it again to clear it.",
  );
  const generateAll = el("button", "act small", "Generate all " + CINEMATIC_LOOKS.length);
  generateAll.type = "button";
  generateAll.id = "btnGenerateAll";
  generateAll.onclick = () => { void generateAllLooks(); };
  looks.head.appendChild(generateAll);
  const grid = el("div", "look-grid");
  grid.id = "lookGrid";
  looks.body.appendChild(grid);
  const progress = el("div", "preview-progress");
  progress.id = "previewProgress";
  looks.body.appendChild(progress);

  const logo = appendToggleSection(
    host,
    "Brand logo",
    "Brand layers sit above the grade, so their identity colours stay exactly as drawn.",
    "logoEnabled",
    defs.logoEnabled,
  );
  const logoField = el("div", "field");
  const logoLabel = el("label", null, "Logo library");
  logoLabel.htmlFor = "p_logoPath";
  logoField.appendChild(logoLabel);
  const logoRow = el("div", "brand-row");
  const logoSelect = document.createElement("select");
  logoSelect.id = "p_logoPath";
  logoSelect.dataset.kind = "string";
  for (const path of savedLogoLibrary(defs.logoPath.default)) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path.split("/").pop();
    logoSelect.appendChild(option);
  }
  logoSelect.addEventListener("input", () => { updateReadiness(); renderStage(); });
  logoRow.appendChild(logoSelect);
  const addLogo = el("button", "browse", "Add…");
  addLogo.type = "button";
  addLogo.onclick = async () => {
    try {
      const result = await api("/api/choose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "open-file", prompt: "Choose a transparent logo image" }),
      });
      if (!result.path) return;
      storeLogoLibrary([...new Set([...savedLogoLibrary(defs.logoPath.default), result.path])]);
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
  logo.appendChild(logoField);

  const customPosition = el("div", "compact-grid");
  appendSegmented(logo, "logoPosition", defs.logoPosition.values, defs.logoPosition.default, {
    label: "Placement",
    short: (value) => value.replace("Top ", "T").replace("Bottom ", "B"),
    onChange: (value) => { customPosition.hidden = value !== "Custom"; },
  });
  const logoGrid = el("div", "compact-grid");
  appendSlider(logoGrid, "logoWidthPercent", defs.logoWidthPercent, {
    label: "Size", unit: "% of frame width", step: 0.1, hint: "",
  });
  appendSlider(logoGrid, "logoVisibility", defs.logoVisibility, {
    label: "Visibility", unit: "% visible", step: 1, hint: "",
  });
  logo.appendChild(logoGrid);
  appendSlider(customPosition, "logoXPercent", defs.logoXPercent, {
    label: "Custom centre X", unit: "%", step: 0.1, hint: "",
  });
  appendSlider(customPosition, "logoYPercent", defs.logoYPercent, {
    label: "Custom centre Y", unit: "%", step: 0.1, hint: "",
  });
  customPosition.hidden = defs.logoPosition.default !== "Custom";
  logo.appendChild(customPosition);

  const mark = appendToggleSection(
    host,
    "Moving watermark",
    "A username that travels a continuous curve, so it cannot be cropped out of a "
      + "single corner and never stops dead mid-frame.",
    "watermarkEnabled",
    defs.watermarkEnabled,
  );
  const markGrid = el("div", "compact-grid");
  appendParamField(markGrid, "watermarkText", defs.watermarkText, true);
  appendParamField(markGrid, "watermarkFont", defs.watermarkFont, true);
  mark.appendChild(markGrid);
  const markSizes = el("div", "compact-grid");
  appendSlider(markSizes, "watermarkSizePercent", defs.watermarkSizePercent, {
    label: "Type size", unit: "% of frame height", step: 0.1, hint: "",
    onInput: renderStage,
  });
  appendSlider(markSizes, "watermarkVisibility", defs.watermarkVisibility, {
    label: "Visibility", unit: "% visible", step: 1, hint: "",
    onInput: renderStage,
  });
  mark.appendChild(markSizes);

  appendSegmented(mark, "watermarkMotionShape", WATERMARK_MOTIONS, motionState.motion, {
    label: "Motion",
    onChange: (value) => { motionState.motion = value; saveMotionState(); renderStage(); },
  });
  const motionGrid = el("div", "compact-grid");
  appendSlider(motionGrid, "watermarkSecondsPerLoop", { type: "number" }, {
    label: "Speed",
    min: 1.5,
    max: 60,
    step: 0.5,
    value: motionState.secondsPerLoop,
    format: (value) => "one loop / " + value + " s",
    hint: "",
    onInput: (value) => { motionState.secondsPerLoop = value; saveMotionState(); renderStage(); },
  });
  appendSlider(motionGrid, "watermarkTravel", { type: "number" }, {
    label: "Travel",
    min: 0,
    max: 100,
    step: 1,
    value: motionState.travel,
    unit: "% of frame",
    hint: "",
    onInput: (value) => { motionState.travel = value; saveMotionState(); renderStage(); },
  });
  appendSlider(motionGrid, "watermarkCenterX", { type: "number" }, {
    label: "Centre X",
    min: 0, max: 100, step: 1, value: motionState.centerX, unit: "%", hint: "",
    onInput: (value) => { motionState.centerX = value; saveMotionState(); renderStage(); },
  });
  appendSlider(motionGrid, "watermarkCenterY", { type: "number" }, {
    label: "Centre Y",
    min: 0, max: 100, step: 1, value: motionState.centerY, unit: "%", hint: "",
    onInput: (value) => { motionState.centerY = value; saveMotionState(); renderStage(); },
  });
  mark.appendChild(motionGrid);

  const delivery = appendSection(
    host,
    "Delivery",
    "The selected look is rendered from the whole clip, encoded as HEVC Main 10 "
      + "with BT.2020 and HLG metadata, and verified before Conductor reports success.",
  );
  appendParamField(delivery.body, "outputPath", defs.outputPath);

  $("btnDry").textContent = "Preview plan";
  selectLook(selectedLook);
  renderLookCards();
  renderClipInfo();
  renderStage();
  updateReadiness();
  showStageTab(lastDelivery === null ? "preview" : stageTab);
  void adoptClip();
}

/** One loop of SMIL motion, or nothing at all when the mark is held still. */
function motionAnimation(path, still) {
  if (still) return "";
  return '<animateMotion dur="' + motionState.secondsPerLoop
    + 's" repeatCount="indefinite" path="' + path + '"></animateMotion>';
}

function numberValue(id, fallback) {
  const control = $(id);
  return control ? Number(control.value) : fallback;
}

function isOn(id) {
  const control = $(id);
  return control ? control.checked : false;
}

/**
 * Draws the frame as it will be delivered: the graded still under the brand
 * layers, at the clip's real aspect ratio and at real sizes.
 *
 * The base image comes from After Effects. Everything on top of it is drawn
 * here, in the browser, which is the whole point — a logo's opacity or a
 * watermark's size answers instantly instead of costing a render.
 */
function renderStage() {
  const column = $("stageCol");
  if (!column) return;
  const isLab = Boolean(selected) && selected.id === LAB;
  column.hidden = !isLab;
  if (!isLab) return;

  const frame = $("stageFrame");
  const width = clipInfo && clipInfo.width > 0 ? clipInfo.width : 1080;
  const height = clipInfo && clipInfo.height > 0 ? clipInfo.height : 1920;
  setStylesheetRule(".stage-frame", { "aspect-ratio": width + " / " + height });

  const preview = cinematicPreviews[selectedLook];
  const baseUrl = preview && preview.imageUrl
    ? apiUrl(preview.imageUrl)
    : sourceFrameUrl;
  frame.innerHTML = "";

  if (baseUrl) {
    const base = el("img", "base");
    base.crossOrigin = "anonymous";
    base.src = baseUrl;
    base.alt = "Frame preview";
    frame.appendChild(base);
  } else {
    frame.appendChild(el(
      "div",
      "placeholder",
      clipInfo === null
        ? "choose a clip to see the frame"
        : "generating the frame…",
    ));
  }

  if (isOn("p_logoEnabled")) {
    const logoSelect = $("p_logoPath");
    const logoPath = logoSelect ? logoSelect.value : "";
    if (logoPath) {
      const placement = $("p_logoPosition") ? $("p_logoPosition").value : "Top Right";
      const preset = LOGO_PRESETS[placement];
      const x = preset ? preset[0] : numberValue("p_logoXPercent", 92.22);
      const y = preset ? preset[1] : numberValue("p_logoYPercent", 6.56);
      const logo = el("img", "logo");
      logo.crossOrigin = "anonymous";
      logo.src = apiUrl("/api/local-image?token=" + encodeURIComponent(TOKEN)
        + "&path=" + encodeURIComponent(logoPath));
      logo.alt = "";
      // After Effects places the layer by its centre, so the overlay must be
      // centred on the same point rather than anchored at a corner.
      setStylesheetRule(".stage-frame img.logo", {
        width: numberValue("p_logoWidthPercent", 5.93) + "%",
        left: x + "%",
        top: y + "%",
        transform: "translate(-50%, -50%)",
        opacity: String(numberValue("p_logoVisibility", 50) / 100),
      });
      logo.onerror = () => { logo.remove(); };
      frame.appendChild(logo);
    }
  }

  let markPath = null;
  if (isOn("p_watermarkEnabled")) {
    const keyframes = watermarkPathKeyframes({
      motion: motionState.motion,
      cycles: 1,
      travel: motionState.travel,
      centerXPercent: motionState.centerX,
      centerYPercent: motionState.centerY,
      samplesPerCycle: 48,
    });
    markPath = keyframes;
    let path = "";
    for (let index = 0; index < keyframes.length; index += 1) {
      const point = keyframes[index].value;
      path += (index === 0 ? "M" : "L")
        + (Math.round(point[0] * 1000) / 10) + " "
        + (Math.round(point[1] * 1000) / 10) + " ";
    }
    const still = motionState.motion === "Static" || motionState.travel <= 0;
    const size = numberValue("p_watermarkSizePercent", 2.6);
    const opacity = numberValue("p_watermarkVisibility", 10) / 100;
    const textControl = $("p_watermarkText");
    const label = (textControl ? textControl.value : "") || "watermark";
    // viewBox 100x100 with non-uniform scaling would distort the type, so the
    // box is the frame's own proportion and lengths are percentages of it.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mark");
    svg.setAttribute("viewBox", "0 0 100 " + (100 * height / width));
    svg.setAttribute("preserveAspectRatio", "none");
    const scaleY = 100 * height / width;
    const scaledPath = path.replace(/([\d.]+) ([\d.]+) /g, (whole, px, py) =>
      px + " " + (Math.round(Number(py) * scaleY) / 100) + " ");
    // AE anchors text on its baseline, and so does SVG by default: the mark
    // sits on the path in the browser exactly where it will sit in the render.
    svg.innerHTML =
      '<text text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="'
      + (Math.round(size * scaleY / 100 * 100) / 100)
      + '" fill="#ffffff" fill-opacity="' + (Math.round(opacity * 100) / 100) + '">'
      + escapeHtml(label)
      + (still
        ? '<animate attributeName="x" values="' + (Math.round(keyframes[0].value[0] * 1000) / 10)
          + ';' + (Math.round(keyframes[0].value[0] * 1000) / 10) + '" dur="1s"></animate>'
          + '<animate attributeName="y" values="'
          + (Math.round(keyframes[0].value[1] * scaleY * 100) / 100) + ';'
          + (Math.round(keyframes[0].value[1] * scaleY * 100) / 100) + '" dur="1s"></animate>'
        : motionAnimation(scaledPath, false))
      + "</text>";
    frame.appendChild(svg);
  }

  // The motion path clamps where the mark is ANCHORED, not how wide it is, so
  // a long enough string runs off the edge — in the render exactly as here.
  //
  // getBBox alone cannot answer this: the mark carries no x of its own (its
  // position comes from the motion), so its box always sits astride the
  // origin. The width is what getBBox is for; where that width travels comes
  // from the path.
  let overflow = false;
  const markText = frame.querySelector("svg.mark text");
  if (markText && markPath !== null) {
    try {
      const half = markText.getBBox().width / 2;
      let leftMost = 100;
      let rightMost = 0;
      for (const keyframe of markPath) {
        leftMost = Math.min(leftMost, keyframe.value[0] * 100);
        rightMost = Math.max(rightMost, keyframe.value[0] * 100);
      }
      overflow = leftMost - half < 0 || rightMost + half > 100;
    } catch { /* not laid out yet; the next repaint will catch it */ }
  }

  const caption = $("stageCaption");
  caption.innerHTML = "";
  const source = preview
    ? "<b>" + escapeHtml(selectedLook) + "</b> — a real After Effects frame, converted for display."
    : (sourceFrameUrl
      ? "<b>Source frame</b> — the clip untouched. Generate " + escapeHtml(selectedLook)
        + " to see the grade."
      : "<b>No frame yet.</b>");
  caption.innerHTML = source
    + "<br>Brand layers are drawn here at their real size and visibility; the grade is not."
    + (overflow
      ? "<br><b>At this size the watermark runs past the frame edge</b> — it will be "
        + "cropped in the render too."
      : "");
}

function showStageTab(tab) {
  stageTab = tab;
  $("tabPreview").setAttribute("aria-pressed", String(tab === "preview"));
  $("tabDelivery").setAttribute("aria-pressed", String(tab === "delivery"));
  $("stagePreview").hidden = tab !== "preview";
  $("stageDelivery").hidden = tab !== "delivery";
}

/**
 * The delivered file, offered the only way it can be offered honestly.
 *
 * Chrome cannot decode HEVC Main 10 HLG — a <video> pointed at the delivery
 * never even reports its duration — so playing it in this page would mean
 * building an SDR proxy, which is exactly the degradation this pipeline exists
 * to prevent. QuickTime plays the delivered file itself, in HDR.
 */
function renderDelivery() {
  const host = $("stageDelivery");
  if (!host) return;
  host.innerHTML = "";
  $("tabDelivery").disabled = lastDelivery === null;
  if (lastDelivery === null) {
    host.appendChild(el("div", "empty", "Nothing rendered yet in this session."));
    return;
  }
  host.appendChild(el("div", "stage-caption",
    "Verified 10-bit HEVC Main 10, BT.2020 with HLG metadata."));
  host.appendChild(el("div", "delivery-path", lastDelivery.outputPath));
  const row = el("div", "delivery-row");
  const play = el("button", "act primary small", "Play in QuickTime");
  play.type = "button";
  play.onclick = () => {
    void api("/api/delivery/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: lastDelivery.id }),
    }).catch((error) => banner("bad", escapeHtml(error.message)));
  };
  row.appendChild(play);
  const reveal = el("button", "act small", "Show in Finder");
  reveal.type = "button";
  reveal.onclick = () => {
    void api("/api/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: lastDelivery.outputPath }),
    }).catch((error) => banner("bad", escapeHtml(error.message)));
  };
  row.appendChild(reveal);
  host.appendChild(row);
  host.appendChild(el("div", "delivery-note",
    "This plays in QuickTime rather than in the page because a browser cannot "
    + "decode HEVC Main 10 HLG. Showing it here would mean converting it to SDR "
    + "first, and the delivery is the one thing that must not be degraded."));
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
      if (selected && selected.id === LAB && control.id === "p_clip") onClipChanged();
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
    if (required && control && !String(control.value).trim()) missing.push(name);
  }
  $("btnRun").disabled = running || missing.length > 0;
  $("btnDry").disabled = running || missing.length > 0;
  $("needs").textContent = missing.length === 0
    ? ""
    : "Still needed: " + missing.map(humanLabel).join(", ");
  const generateAll = $("btnGenerateAll");
  if (generateAll) generateAll.disabled = running || missing.indexOf("clip") >= 0;
  for (const button of document.querySelectorAll(".look-actions button")) {
    if (button.textContent === "View") continue;
    button.disabled = running || missing.indexOf("clip") >= 0;
  }
}

function renderParams() {
  if (!selected) return;
  $("paramsTitle").textContent = selected.title;
  $("paramsSub").textContent = "";
  clipInfo = null;
  sourceFrameUrl = null;
  renderDelivery();
  if (selected.id === LAB) {
    $("btnRun").textContent = "Render " + selectedLook;
    renderCinematicParams();
    return;
  }
  $("btnDry").textContent = "Preview plan";
  $("btnRun").textContent = "Build & render";
  renderStage();
  const host = $("params");
  host.innerHTML = "";
  for (const [name, def] of Object.entries(selected.params)) {
    // A number with both ends known is a slider; a short enum is segmented.
    // Only when a default exists: a slider always holds a value, so it would
    // quietly answer a required question on the person's behalf.
    if (
      def.type === "number" &&
      def.min !== undefined &&
      def.max !== undefined &&
      def.default !== undefined
    ) {
      appendSlider(host, name, def, {});
      continue;
    }
    if (def.type === "enum" && def.values.length <= 5 && def.default !== undefined) {
      appendSegmented(host, name, def.values, def.default, { hint: def.description });
      continue;
    }
    appendParamField(host, name, def);
  }
  updateReadiness();
}

function collectParams(renderMode) {
  const params = {};
  for (const [name, def] of Object.entries(selected.params)) {
    const control = $("p_" + name);
    if (!control) continue;
    if (def.type === "boolean") { params[name] = control.checked; continue; }
    const raw = String(control.value);
    if (raw === "") continue;
    params[name] = def.type === "number" ? Number(raw) : raw;
  }
  if (selected.id === LAB) {
    // These three are console state, not form fields. renderMode in particular
    // is never written to the DOM: a preview that forgot to put it back would
    // silently deliver a two-second master.
    params.look = selectedLook;
    params.renderMode = renderMode === "Preview" ? "Preview" : "Full";
    params.watermarkPath = watermarkPathFor(params.renderMode);
  }
  return params;
}

function finishInteraction() {
  running = false;
  generatingLook = null;
  renderLookCards();
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
      body: JSON.stringify({ mode: "open-file", prompt: "Choose an image or video to clean" }),
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

  const source = new EventSource(apiUrl(
    "/api/render?token=" + encodeURIComponent(TOKEN)
      + "&indices=" + encodeURIComponent(indices.join(",")),
  ));
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
      // The delivery becomes playable from the console itself.
      const deliveries = Array.isArray(payload.deliveries) ? payload.deliveries : [];
      if (deliveries.length > 0) {
        lastDelivery = deliveries[deliveries.length - 1];
        renderDelivery();
        showStageTab("delivery");
      }
      // An automatically suggested path belongs to the render that just
      // finished. Reusing it for the next clip would silently overwrite the
      // previous delivery and can leave duplicate AE output modules.
      void refreshAutoSuggestedOutputs();
    } else {
      panel.appendChild(el("b", null, "Render failed."));
      panel.appendChild(document.createTextNode(" " + (payload.error || "")));
      if (payload.tail) {
        panel.appendChild(el("pre", "render-log", payload.tail));
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

/**
 * Hands the parameters over, then streams against the ticket that comes back.
 *
 * EventSource cannot POST, and a real motion path is far too large to put in a
 * URL: a minute-long clip encodes to about 29 KB, and Node refuses a request
 * line over 16 KB. The browser reports that to an EventSource as a bare
 * connection drop, so the failure would arrive with no explanation at all.
 */
async function runStreamUrl(params) {
  const ticket = await api("/api/run-params", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipeId: selected.id, params }),
  });
  return apiUrl("/api/run?token=" + encodeURIComponent(TOKEN)
    + "&run=" + encodeURIComponent(ticket.id));
}

async function runRecipeOnce(params, onStep) {
  const streamUrl = await runStreamUrl(params);
  return await new Promise((resolve, reject) => {
    const source = new EventSource(streamUrl);
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

function setPreviewProgress(message, strong) {
  const progress = $("previewProgress");
  if (!progress) return;
  progress.innerHTML = "";
  if (strong) progress.appendChild(el("strong", null, strong));
  if (message) progress.appendChild(document.createTextNode((strong ? " " : "") + message));
}

/**
 * Builds one sample: a single frame, written straight out of the open session.
 *
 * A moving sample meant the render queue, aerender, an HEVC encode and a
 * tone-mapped proxy — a minute of waiting to answer "is this the right look?".
 * One frame answers the same question in a few seconds, and it is still the
 * real effect chain rendered by After Effects rather than a filter faked here.
 *
 * Branding is deliberately excluded: the logo and watermark are drawn live on
 * the stage, so baking them in would both cost a render per nudge and draw
 * them twice.
 */
async function buildLookStill(look, prefix) {
  generatingLook = look;
  renderLookCards();
  setPreviewProgress("Building " + look + "…", prefix);
  const output = await api(
    "/api/cinematic/preview-output?kind=still&look=" + encodeURIComponent(look),
  );
  const params = Object.assign(collectParams("Still"), {
    look,
    renderMode: "Still",
    logoEnabled: false,
    watermarkEnabled: false,
    outputPath: output.path,
  });
  let latestStep = "";
  await runRecipeOnce(params, (step) => {
    if (step.status === "running" || step.status === "succeeded") latestStep = step.id;
    setPreviewProgress("Building " + look + (latestStep ? " · " + latestStep : "") + "…", prefix);
  });
  setPreviewProgress("Converting " + look + " for display…", prefix);
  const registered = await api("/api/cinematic/register-still", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ look, path: output.path, clip: params.clip }),
  });
  cinematicPreviews[look] = registered;
  generatingLook = null;
  renderLookCards();
  renderStage();
}

/** Generates a sample only when it is missing and nothing else is running. */
async function autoGenerateStill(look) {
  if (running || cinematicPreviews[look]) return;
  const clip = $("p_clip");
  if (!clip || clip.value.trim() === "") return;
  await generateOneLook(look, { quiet: true });
}

async function generateOneLook(look, options) {
  const settings = options || {};
  if (running) return;
  running = true;
  updateReadiness();
  renderLookCards();
  if (!settings.quiet) {
    $("outTitle").textContent = "Look sample";
    $("out").innerHTML =
      '<div class="banner warn"><b>Building one After Effects frame.</b> '
      + "Only " + escapeHtml(look) + " is rendered; every other card is left alone.</div>";
  }
  try {
    await ensureClipInfo();
    await buildLookStill(look, "");
    setPreviewProgress("It is on the stage. Click View to inspect it larger.", look + " is ready.");
    if (!settings.quiet) {
      $("out").innerHTML =
        '<div class="banner ok"><b>' + escapeHtml(look) + ' sample ready.</b> '
        + "Compare it, then use <b>Render " + escapeHtml(look) + "</b> for the full clip.</div>";
    }
  } catch (error) {
    setPreviewProgress("Everything already generated is untouched.", look + " could not be built.");
    $("out").innerHTML =
      '<div class="banner bad"><b>Could not build ' + escapeHtml(look) + '.</b> '
      + escapeHtml(error.message) + "</div>";
  } finally {
    finishInteraction();
  }
}

async function generateAllLooks() {
  if (running) return;
  running = true;
  updateReadiness();
  renderLookCards();
  $("outTitle").textContent = "Look comparison";
  $("out").innerHTML =
    '<div class="banner warn"><b>Building ' + CINEMATIC_LOOKS.length + " After Effects frames.</b> "
    + "Each one is the real effect chain on the same moment of the clip.</div>";
  const chosen = selectedLook;
  try {
    await ensureClipInfo();
    for (let index = 0; index < CINEMATIC_LOOKS.length; index += 1) {
      const look = CINEMATIC_LOOKS[index][0];
      await buildLookStill(look, "Look " + (index + 1) + " of " + CINEMATIC_LOOKS.length + ".");
    }
    selectLook(chosen);
    setPreviewProgress(
      "Click any card to put it on the stage; click it again to clear the look.",
      "All " + CINEMATIC_LOOKS.length + " samples are ready.",
    );
    $("out").innerHTML =
      '<div class="banner ok"><b>Comparison complete.</b> '
      + "Select a look, judge it on the stage, then render the winner from the full clip.</div>";
  } catch (error) {
    selectLook(chosen);
    setPreviewProgress("The samples that finished remain available.", "Generation stopped.");
    $("out").innerHTML =
      '<div class="banner bad"><b>Could not finish every sample.</b> '
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
  $("viewerTitle").textContent = look + " — " + lookDescription(look);
  $("viewerCount").textContent = (viewerIndex + 1) + " / " + CINEMATIC_LOOKS.length + " · selected";
  const video = $("viewerVideo");
  const image = $("viewerImage");
  // A sample is a frame now, but a moving sample from the recipe's Preview
  // mode is still a valid thing to be handed, so the viewer takes either.
  if (preview.imageUrl) {
    video.pause();
    video.removeAttribute("src");
    video.hidden = true;
    image.hidden = false;
    image.crossOrigin = "anonymous";
    image.src = apiUrl(preview.imageUrl);
  } else {
    image.hidden = true;
    image.removeAttribute("src");
    video.hidden = false;
    if (video.src !== apiUrl(preview.videoUrl)) {
      video.src = apiUrl(preview.videoUrl);
      video.load();
    }
    void video.play().catch(() => undefined);
  }
  selectLook(look);
}

function openLookViewer(index) {
  if (!cinematicPreviews[CINEMATIC_LOOKS[index][0]]) return;
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
  const image = $("viewerImage");
  image.hidden = true;
  image.removeAttribute("src");
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

$("tabPreview").onclick = () => showStageTab("preview");
$("tabDelivery").onclick = () => showStageTab("delivery");
$("btnDoctor").onclick = checkDoctor;
$("btnPrivacyClean").onclick = () => { void startPrivacyClean(); };

$("btnDry").onclick = async () => {
  $("outTitle").textContent = "Planned steps — nothing was touched";
  $("out").innerHTML = '<div class="empty">Resolving…</div>';
  try {
    const plan = await api("/api/dry-run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: selected.id, params: collectParams("Full") }),
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

$("btnRun").onclick = async () => {
  running = true;
  updateReadiness();
  renderLookCards();
  $("outTitle").textContent = "Running in After Effects";
  $("out").innerHTML = '<div class="empty">Starting…</div>';
  if (selected.id === LAB) await ensureClipInfo();
  const steps = [];
  let settled = false;

  // EventSource cannot send headers, so the token travels as a query parameter.
  // It is not a secret from you — only from other origins, which cannot read it.
  let streamUrl;
  try {
    streamUrl = await runStreamUrl(collectParams("Full"));
  } catch (error) {
    finishInteraction();
    $("out").innerHTML =
      '<div class="banner bad"><b>Could not start the run.</b> '
      + escapeHtml(error.message) + "</div>";
    return;
  }
  const source = new EventSource(streamUrl);

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
        const list = el("ul", "field-errors");
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

let starting = false;

async function start(userInitiated) {
  if (starting) return;
  if (HOSTED_CONSOLE && !userInitiated && !TOKEN) {
    showConnectionState("not-started");
    return;
  }
  starting = true;
  if (!(await connectToLocalConductor())) {
    starting = false;
    return;
  }
  $("connectionGate").hidden = true;
  $("console").hidden = false;
  loadMotionState();
  try {
    recipes = (await api("/api/recipes")).recipes;
    const shown = visibleRecipes();
    const lab = shown.find((recipe) => recipe.id === LAB);
    selected = lab || shown[0] || null;
    renderRecipes();
    if (selected) renderParams();
  } catch (error) {
    $("recipes").innerHTML = '<div class="empty">' + escapeHtml(error.message) + "</div>";
  } finally {
    starting = false;
  }
  await checkDoctor();
}

$("retryConnection").onclick = () => { void start(true); };
if (HOSTED_CONSOLE) showConnectionState("not-started");
else void start(false);
</script>
</body>
</html>
`;

export function renderConsoleHtml(options: {
  sessionToken: string;
  apiBase: string;
}): string {
  return CONSOLE_HTML
    .replace("__CONDUCTOR_SESSION_TOKEN__", options.sessionToken)
    .replace("__CONDUCTOR_API_BASE__", options.apiBase);
}
