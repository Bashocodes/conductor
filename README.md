# Conductor

**The craft layer for Adobe MCP servers.**

MCP servers give agents hands; Conductor gives them technique: deterministic,
replayable motion-design recipes with proper easing, motivated transitions,
and verified renders. No AI required; bring one if you want.

Conductor is an MCP client and recipe engine. It does not replace an Adobe MCP
server, bundle Adobe automation code, or require a model to execute a recipe.
The current release is `0.1.0-alpha.0`. Two of the three reference recipes —
`title-card` and `motivated-transition` — have been run end to end against a
live **After Effects 26.3** over an `execute_extend_script` MCP server, and the
easing, motion blur and overshoot they produce were read back out of the
application and checked. `hdr-safe-grade` reaches its colour-configuration step;
that step deliberately refuses to change a project's working space without an
explicit opt-in, because doing so reinterprets every composition already in the
project.

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

## Reference recipes

All three alpha recipes target the logical `aftereffects` server and end with
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

Applies the established technical HLG chain at one of three strengths.
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
