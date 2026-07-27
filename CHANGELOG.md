# Changelog

All notable changes to Conductor are documented here. The project follows
[Semantic Versioning](https://semver.org/); alpha releases may still change
configuration and recipe contracts before `1.0.0`.

## [Unreleased]

### Changed

- **Look samples are single frames, not clips.** A sample used to mean the
  render queue, `aerender`, an HEVC encode and a tone-mapped proxy — about a
  minute to answer "is this the right look?". `CompItem.saveFrameToPng` renders
  the same effect chain in milliseconds, so a sample now takes about ten
  seconds and all eight about eighty. The composition and its precomposition
  are removed once the frame is written, rather than left in the project.
- The console is laid out around a **live 9:16 stage**: the graded frame with
  the logo and watermark drawn over it at their real size, position and
  visibility. Branding answers instantly because it is drawn in the browser —
  the After Effects sample deliberately carries the look only.
- Selecting the look that is already selected **clears it**, back to
  Technical HDR. "No look" is a real answer and needed a way back to it.
- Choosing a clip now pulls a frame straight out of the file for the stage, and
  builds the selected look's sample without being asked.

### Changed (earlier in this release)

- The console generates look samples **one at a time**. Every card in the
  gallery has its own generate control, so comparing two treatments no longer
  costs eight After Effects renders. Generating one look leaves every other
  sample exactly as it was.
- `cinematic-look-lab` is now **HDR Cinema Studio** and gained a
  `Technical HDR` look, which applies no look at all. With the logo and
  watermark switched off it is the `hdr-safe-grade` chain, so the console
  presents one page instead of asking which of two to use. `hdr-safe-grade`
  remains available from the CLI and the library.
- Replaced the watermark's four-corner keyframe rhythm — and its three speed
  buttons — with a `watermarkPath` parameter: normalized keyframes sampled from
  a continuous curve, written with almost no ease so the mark travels evenly
  instead of stopping at every key. The console generates it from shape, speed
  (seconds per loop), travel and centre controls, and scales it to the clip's
  real duration so a sample moves at the rate the master will.
- Rebuilt the console around sliders with live readouts, segmented controls,
  switchable sections that visibly dim when off, and a live drawing of the
  watermark's path at its actual size.

### Added

- A build-time static console for the Director/Conductor shell. The hosted
  document points at the visitor's `127.0.0.1:4173` engine, shows an exact
  `CONDUCTOR_PUBLIC_ORIGIN=… conductor serve --no-open` command when it is not
  running, and keeps local-only `conductor serve` use unchanged.
- Exact-origin CORS, Private/Local Network Access preflight support, and the
  existing per-process session token on the loopback console server. Public
  origins are refused unless explicitly configured; a wildcard is never used.
- Separate `console.css` and `console.js` assets for the hosted console, so its
  Worker CSP can use `script-src 'self'` and `style-src 'self'` with no inline
  exception. The local server retains its self-contained offline document.
- `saveFrame`, a ToolContract operation that writes one frame of a composition
  straight out of the open session, optionally disposing the scaffolding.
- `renderMode: "Still"` on `cinematic-look-lab`, which takes a frame instead of
  queueing a render.
- A **Rendered** tab that plays the delivery in QuickTime. It is not played in
  the page because Chrome cannot decode HEVC Main 10 HLG — a `<video>` pointed
  at a delivery never reports its duration — and the only in-page alternative
  would be an SDR proxy, which is the one thing this pipeline must not do.
- `addTextLayer` accepts `sizePercent`, an exact type size as a percentage of
  the composition height, which survives a change of frame where pixels do not.
- `POST /api/inspect-clip`, so the console can report a clip's size, rate and
  duration and keep speed controls honest.
- Conductor removes a look's previous sample files when that look is
  regenerated, when the clip changes, and — at startup — any sample older than
  a day left behind by a session that was closed or killed. The 16-bit frame
  After Effects writes is deleted once its displayable copy is verified.

## [0.1.0-alpha.0] - 2026-07-23

### Phase 1 — deterministic foundation

- Added the strict TypeScript, ESM, Node 22, pnpm, Vitest, and CLI foundation.
- Added validated recipe data, parameter interpolation, safe preconditions,
  sequential execution, expected-shape verification, and JSON run journals.
- Added stdio and HTTP MCP client transports using the Model Context Protocol
  SDK.
- Added `recipes`, `run`, `run --dry-run`, and `doctor` CLI workflows.

### Phase 2 — craft recipes and adapters

- Added the portable ToolContract and declarative per-server adapter mapping.
- Added the generic After Effects and in-process fake-server adapters.
- Added `title-card`, `motivated-transition`, and `hdr-safe-grade` reference
  recipes.
- Encoded eased motion, motion blur, motivated transition timing, conservative
  technical grading, and verified render queue handoffs.

### Phase 3 — optional proposal brains

- Added permanent `none`, cloud `api`, and OpenAI-compatible `local` brain
  modes.
- Added OpenAI, Anthropic, Gemini, Ollama, LM Studio, vLLM, and similar endpoint
  request shaping.
- Added bounded recipe catalogs, schema-validated proposals, one corrective
  retry, confirmation gating, and non-secret journal provenance.
- Restricted credentials to environment variables or a mode-600 file outside
  the repository.

### Phase 4 — private OSS alpha readiness

- Added project governance, contribution, security, issue, and pull request
  documentation.
- Added Node 22 verification and gitleaks CI jobs.
- Added four scoped good-first-issue briefs.
- Documented ecosystem attribution, independence, safety, architecture, and
  the live-Adobe verification roadmap.

[Unreleased]: https://github.com/Bashocodes/conductor/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha.0]: https://github.com/Bashocodes/conductor/releases/tag/v0.1.0-alpha
