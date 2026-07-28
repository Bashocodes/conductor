# Conductor

**The craft layer for Adobe MCP servers.**

MCP servers give agents hands; Conductor gives them technique: deterministic,
replayable motion-design recipes with proper easing, motivated transitions,
and verified renders. No AI required; bring one if you want.

Conductor is an MCP client and recipe engine. It does not replace an Adobe MCP
server, bundle Adobe automation code, or require a model to execute a recipe.
The current release is `0.1.0-alpha.0`. All four reference recipes have been
run against a live **After Effects 26.3** over an `execute_extend_script` MCP
server. The title and transition motion was read back from the host; the HDR
recipe was rendered through a 10-bit ProRes HLG intermediate and validated as
HEVC Main 10 BT.2020/HLG; and the cinematic laboratory produced all seven
two-second comparisons through the same verified pipeline.

Only After Effects has been exercised against a real host. The Photoshop,
Premiere and Illustrator paths remain unproven.

## The gap

The Adobe MCP ecosystem already has several capable server projects:

- [mikechambers/adb-mcp](https://github.com/mikechambers/adb-mcp) is an early,
  broad proof of concept spanning Photoshop, Premiere Pro, After Effects,
  Illustrator, and InDesign.
- [Dakkshin/after-effects-mcp](https://github.com/Dakkshin/after-effects-mcp)
  exposes compositions, text, shapes, solids, and properties in After Effects.
- [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp)
  exposes a large Photoshop automation surface.
- [leancoderkavy/premiere-pro-mcp](https://github.com/leancoderkavy/premiere-pro-mcp)
  exposes Premiere Pro editing operations through MCP.

Those projects solve the host bridge and tool-access problem. The missing layer
is reusable technique: which ordered calls produce a title that settles
properly, a transition whose direction is motivated by the shot, or a grade
that ends in a verified 10-bit render. Conductor keeps that knowledge in
portable, reviewable recipe data.

Conductor is independent, is not endorsed by Adobe or the projects above, and
does not vendor their code. It depends on the standard
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
and connects to separately installed servers through adapters.

## Quickstart

Requirements:

- Node.js 22 or newer
- pnpm
- An installed Adobe MCP server for `doctor` and real runs
- No Adobe application for dry runs or tests

Install and prepare a machine-local config:

```sh
pnpm install
cp conductor.config.example.json conductor.config.json
```

Edit `conductor.config.json` so the transport launches or reaches your MCP
server. The example starts in the safest brain mode:

```json
{
  "brain": {
    "type": "none"
  },
  "servers": {
    "aftereffects": {
      "transport": "stdio",
      "command": "YOUR_AE_MCP_COMMAND",
      "args": []
    }
  }
}
```

Map your server's real tool names using
[`docs/ADAPTERS.md`](docs/ADAPTERS.md), then build and inspect the connection:

```sh
pnpm build
node dist/cli.js doctor
```

Dry-run a recipe before connecting to anything:

```sh
node dist/cli.js run title-card --dry-run \
  --param text="A clear opening title" \
  --param outputPath=/renders/title-card.mov
```

When the plan and adapter are approved, run the same validated recipe through
the configured server:

```sh
node dist/cli.js run title-card \
  --param text="A clear opening title" \
  --param outputPath=/renders/title-card.mov
```

Every real run writes a structured JSON journal under `runs/`, including mapped
calls, bounded result summaries, durations, skips, verification failures, and
the final render handoff.

## Local console and hosted shell

Start the standalone local console from this checkout with:

```sh
pnpm serve
```

That builds if needed and is the form that works on a fresh clone. Conductor is
not published to npm, so `npx conductor` will not resolve; to get the bare
`conductor` command on your `PATH`, link the checkout once:

```sh
pnpm link --global
conductor serve --no-open
```

It binds only to `127.0.0.1`. Loopback browser origins work without further
configuration. If the static console is hosted on HTTPS, allow exactly that one
origin when starting the local engine:

```sh
CONDUCTOR_PUBLIC_ORIGIN=https://director.aikizi.com pnpm serve
```

The hosted console displays this command with its own origin filled in, with a
copy button. The server never uses a wildcard CORS origin; all operational
routes still require the per-process session token.

The hosted console cannot start this process — no web page can launch a local
binary. What it does instead is watch for it: after a failed connection the card
polls loopback and connects by itself the moment the engine answers, so the
usual "open the tab, then start the engine" order needs no second click. That
watcher deliberately pauses while Chrome's Local Network Access permission is
still `prompt`, because a probe fired underneath an open prompt aborts on its
own timeout and reports a false "unreachable".

## Reference recipes

All four alpha recipes target the logical `aftereffects` server and end with
an explicit, verified render queue operation. The excerpts below are abridged
from their deterministic dry-run plans.

### `title-card`

Builds centered generic typography with `rise`, `fade`, or `track-in`
entrances. Entrance motion overshoots and settles; exits are gentler; moving
layers always enable motion blur.

```text
inspect-project-state                projectInfo
build-title-composition              createComp
place-centered-title-layer           addTextLayer   motion_blur: true
entrance-overshoot-keyframes         setKeyframes   overshoot-settle
rise-gentle-exit-keyframes           setKeyframes   gentle-exit
queue-verified-title-render          queueRender    /renders/title-card.mov
```

### `motivated-transition`

Builds a `dip-to-light`, directional `luma-wipe`, or `whip`. The effect that
motivates the edit peaks or moves with the outgoing and incoming layers; there
is no bare crossfade.

```text
inspect-edit-project                 projectInfo
build-transition-composition         createComp
prepare-outgoing-clip                precompose
prepare-incoming-clip                precompose
light-burst-motivation               applyEffect
burst-peak-frame                     setKeyframes   controlled-peak
outgoing-dip-under-burst             setKeyframes   gentle-exit
incoming-reveal-under-burst          setKeyframes   overshoot-settle
queue-verified-transition-render     queueRender    /renders/transition.mov
```

### `hdr-safe-grade`

Applies the established technical HLG chain at one of three strengths. The
console no longer offers it as a separate page — `cinematic-look-lab`'s
Technical HDR look is the same chain — but it remains available from the CLI
and the library as the smallest reference grade.
`Natural HDR` is preselected and preserves the current approved look;
`Vivid HDR` adds a controlled lift and richer color; `Impact HDR` is the
noticeable “wow, this is HDR” option while retaining over-range highlights.
Every choice uses an explicitly verified 32-bit HLG working space, a required
10-bit ProRes HLG intermediate, and a validated HEVC Main 10 BT.2020/HLG
delivery.

```text
inspect-source-metadata              projectInfo
configure-hlg-working-project        projectInfo
build-source-matched-composition     createComp
prepare-source-for-technical-grade   precompose
bounded-exposure-normalization       applyEffect
broadcast-safe-levels-clamp          applyEffect
controlled-color-separation          applyEffect    Vivid/Impact only
queue-verified-10bit-hlg-render      queueRender    /renders/hlg.mov
                                      handoff: encode and validate HEVC HLG
```

See [`docs/RECIPES.md`](docs/RECIPES.md) for the complete plans and recipe
authoring tutorial.

The deterministic frame-quantization and event-assignment foundation for the
next Beat Sync Studio is documented in
[`docs/BEAT_SYNC.md`](docs/BEAT_SYNC.md). It deliberately separates music
analysis from AE execution and does not claim beat sync until the Adobe marker
pass has been reconciled and saved.

### `cinematic-look-lab` — HDR Cinema Studio

Creates a controlled comparison from one representative two-second source
window, then renders the chosen treatment across the complete clip. The eight
AE-native choices are Technical HDR, Clean Cinema, Golden Hour, Teal & Amber,
Dream Bloom, Film Noir, Neon Night, and Bleach Bypass. **Technical HDR applies
no look at all**, so this one recipe covers both the plain colour-managed HLG
delivery and every graded one; with the logo and watermark switched off it is
exactly the `hdr-safe-grade` chain. Samples and finals share the same 32-bpc
HLG composition and effect chain; only duration and source offset differ.

The console presents real samples in a card gallery. A sample is **one frame**,
written straight out of the open After Effects session with
`CompItem.saveFrameToPng` — the same effect chain as the master, without the
render queue, `aerender`, or an encode. That is about ten seconds per look
rather than a minute, and the scaffolding composition is removed once the frame
is written. Each card generates on its own, so comparing two looks does not mean
building eight; selecting a look that is already selected clears it back to
Technical HDR.

A frame written in a `Rec.2100 HLG Scene W100` project is not something a
browser can show — it holds the HLG signal divided by ten, and renders almost
black. Conductor converts it: undo the scaling, invert the HLG transfer to scene
light, move BT.2020 primaries to BT.709, encode sRGB. The scale was measured
against frames taken straight from the source clip rather than assumed.

Alongside the controls is a **live stage** at the clip's aspect ratio: the
graded frame with the logo and the moving watermark drawn over it at their real
size, placement and visibility. The brand layers are drawn in the browser, so
changing a logo's opacity or a watermark's size answers immediately; the After
Effects sample deliberately carries the look alone.

A finished delivery is offered in a **Rendered** tab, which opens it in
QuickTime. It is not played in the page: Chrome cannot decode HEVC Main 10 HLG,
and showing it inline would mean converting it to SDR first.

Branding is built as editable After Effects layers above the grade:

- a local multi-logo library with position, custom coordinates, relative size,
  and visibility controls;
- a bundled placeholder logo at the established top-right safe position; and
- an editable `yourbrand_` watermark with font, type size as a percentage of the
  frame, visibility, and a motion path. Its default 10% visibility means 90%
  transparency.

The watermark's motion is a `watermarkPath` parameter: normalized keyframes
sampled from a continuous curve, so the mark travels evenly instead of stopping
at every key. The console generates it from shape, speed, travel and centre
controls, and scales the loop count to the clip's real duration — so a
two-second sample moves at the rate the master will.

```text
inspect-cinematic-source             projectInfo
configure-cinematic-hlg-project      projectInfo
build-cinematic-composition          createComp     Preview / Full
prepare-cinematic-source             precompose     representative offset
cinematic-hdr-*                      applyEffect    Natural / Vivid / Impact
<selected-look-effects>              applyEffect    none for Technical HDR
place-project-logo                   addMediaLayer  optional
add-moving-watermark                 addTextLayer   optional
animate-moving-watermark             setKeyframes   sampled continuous path
queue-cinematic-hlg-render           queueRender    validated HEVC HLG
```

### Privacy Clean Copy

The console also includes a local utility for images and videos. Choose one
file and Conductor writes `name-clean.ext` beside it, automatically advancing
to `name-clean-2.ext` when necessary. It removes embedded EXIF, GPS, XMP, IPTC,
camera, author, date, comment, and container-description fields, verifies the
copy, and never modifies or recompresses the original media. Orientation and
ICC color-profile instructions are retained so cleaning does not rotate or
recolor an image.

## Optional brain modes

Brains produce proposals only: a registered recipe ID, schema-valid
parameters, and a rationale. They never receive MCP clients and cannot invent
or execute tool calls.

| Mode | Use |
| --- | --- |
| `none` | Default. No model, no suggestion, no behavior change to `run`. |
| `api` | OpenAI, Anthropic, or Gemini-compatible cloud endpoint. |
| `local` | OpenAI-compatible Ollama, LM Studio, vLLM, Qwen, or similar endpoint. |

```sh
node dist/cli.js ask \
  "Create a restrained title that rises into frame" \
  --brain api
```

`ask` prints the proposal and requires human confirmation before it constructs
an MCP client. A local model is not automatically safer operationally: a
30 GB-class Qwen runtime can starve After Effects of memory. Cloud API mode is
an equal-class option, while `none` remains a permanent first-class mode.

Keys come only from environment variables or owner-only
`~/.conductor/credentials.json`; they are never accepted in repository config,
logged, or journaled. See [`docs/BRAINS.md`](docs/BRAINS.md).

## Architecture

```text
                      optional, proposal only
  plain-language goal ───────> [ none | api | local brain ]
                                         |
                                         v
                               recipe ID + validated params
                                         |
                                  human confirmation
                                         |
                                         v
  recipe data ──> schema ──> deterministic engine ──> run journal
                                      |
                                      v
                              ToolContract operations
                                      |
                                      v
                           per-server declarative adapter
                                      |
                                      v
                   separately installed Adobe MCP server
                                      |
                                      v
                         After Effects / Photoshop / Premiere
```

- **Engine:** resolves parameters, interpolation, preconditions, ordered calls,
  timeouts, verification, and journals.
- **Adapters:** map stable ToolContract operations to a server's concrete MCP
  tool names and argument shapes.
- **Brains:** optional proposal providers with no execution capability.
- **Recipes:** serializable craft decisions, never arbitrary code.

## Safety model

- `--dry-run` resolves the complete plan without loading config or connecting.
- `ask` has a human confirmation gate; declining constructs no MCP client.
- `run` is always brain-free and follows only the selected recipe.
- Recipes are validated data: no callbacks, `eval`, scripts, or shell steps.
- A trusted machine config may name a stdio server command, but recipe data
  cannot alter or invoke shell commands.
- Every call has a timeout and structured error.
- Preconditions use a deliberately small expression language.
- Every reference recipe ends in a verified render/export operation.
- Credentials stay outside the repository and never enter journals.
- CI uses an in-process fake server. Adobe is never launched in CI.

## Roadmap

- Human-supervised compatibility reports and verified runs against real Adobe
  MCP servers
- Photoshop and Premiere Pro ToolContract coverage and reference recipes
- More motion-design recipes, easing presets, and technical delivery checks
- A recipe marketplace distributed through plugins, with recipes remaining
  inspectable data
- Journal visualization and comparison tooling

## Contributing and security

Recipe contributions are the primary path into the project. Start with
[`CONTRIBUTING.md`](CONTRIBUTING.md) and the seeded
[`good-first-issue briefs`](docs/good-first-issues/).

Please follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Report
vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 KALAI LABS
