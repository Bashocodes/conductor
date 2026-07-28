/**
 * The Conductor console document.
 *
 * Styles and behavior are served as same-origin assets so the local and hosted
 * consoles can share the strict CSP: no inline script and no inline style.
 */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en" data-session-token="__CONDUCTOR_SESSION_TOKEN__" data-api-base="__CONDUCTOR_API_BASE__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conductor</title>
<link rel="stylesheet" href="__CONDUCTOR_ASSET_BASE__console.css">
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
    <div class="connection-command-row">
      <code class="connection-command" id="startCommand">conductor serve --no-open</code>
      <button type="button" class="connection-copy" id="copyCommand" aria-label="Copy the start command">Copy</button>
    </div>
    <p class="connection-hint" id="connectionHint" hidden></p>
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

<script src="__CONDUCTOR_ASSET_BASE__console.js" defer></script>
</body>
</html>
`;

export function renderConsoleHtml(options: {
  sessionToken: string;
  apiBase: string;
  assetBase?: string;
}): string {
  return CONSOLE_HTML
    .replace("__CONDUCTOR_SESSION_TOKEN__", options.sessionToken)
    .replace("__CONDUCTOR_API_BASE__", options.apiBase)
    .replaceAll("__CONDUCTOR_ASSET_BASE__", options.assetBase ?? "/");
}
