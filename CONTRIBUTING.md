# Contributing to Conductor

Recipe contributions are the headline path into Conductor. A good recipe turns
real motion-design judgment into deterministic, inspectable data that works
through more than one MCP server adapter.

By participating, you agree to follow the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Do not include client footage,
private paths, credentials, licensed fonts, brand assets, watermarks, or code
copied from an upstream MCP server.

## Development setup

Requirements are Node.js 22 or newer and pnpm.

```sh
git clone https://github.com/Bashocodes/conductor.git
cd conductor
pnpm install
pnpm verify
```

Adobe is not required for development or CI. Tests use the in-process fake MCP
server. Never add a CI step that launches or depends on Adobe software.

## Author a recipe

### 1. Start with the result and craft invariants

Open a `new recipe` issue before writing a large recipe. Describe:

- the professional result and target application;
- the intended user-controlled parameters;
- the motivated visual logic;
- timing and easing relationships;
- the terminal export and its verification;
- the ToolContract operations required.

Reference recipes must use generic values. They may not encode a brand,
client-specific look, licensed typeface, private path, watermark, or arbitrary
shell/script action.

### 2. Define serializable parameters

Create `src/recipes/<recipe-id>.ts`. Parameters use Conductor definitions with
types, constraints, defaults where appropriate, and descriptions:

```ts
params: {
  text: {
    type: "string",
    minLength: 1,
    description: "Text displayed by the lower third."
  },
  duration: {
    type: "number",
    min: 1,
    max: 30,
    default: 6,
    description: "Composition duration in seconds."
  },
  outputPath: {
    type: "string",
    minLength: 1,
    description: "Render destination selected by the user."
  }
}
```

A parameter without a default is required. Do not read environment variables,
the filesystem, time, randomness, or network state from a recipe module.

### 3. Write the ordered checklist

Recipes name ToolContract operations, never a concrete MCP tool:

```ts
{
  id: "entrance-overshoot-keyframes",
  server: "aftereffects",
  operation: "setKeyframes",
  args: {
    layerId:
      "${steps.place-lower-third.result.structuredContent.layerId}",
    property: "positionY",
    keyframes: [
      { time: 0, value: 1120 },
      { time: 0.16, value: 930 },
      { time: 0.24, value: 960 }
    ],
    easing: {
      type: "cubic-bezier",
      profile: "overshoot-settle",
      controlPoints: [0.16, 1.2, 0.3, 1]
    },
    motionBlur: true
  },
  verify: {
    type: "object",
    required: ["structuredContent"]
  }
}
```

Step IDs should explain intent: `burst-peak-frame` is reviewable;
`animate-effect-3` is not.

### 4. Preserve the craft rules

- Every camera or position move must use explicit easing—never linear.
- Every moving layer must enable motion blur.
- A transition must be motivated by light, luminance, depth, matched motion,
  or another visible cause; do not contribute a bare crossfade.
- Technical recipes must state conservative bounds and avoid hidden creative
  looks.
- Every recipe must end with `queueRender`, a user-selected output path, and a
  verification that the result reports a queued render.
- `note` may contain human runbook guidance, but it is never executable.

### 5. Register and inspect every branch

Register the parsed recipe in `src/recipes/index.ts`, then build:

```sh
pnpm build
node dist/cli.js recipes
node dist/cli.js run <recipe-id> --dry-run --param key=value
```

Dry-run every enum/style branch. Read each plan like a motion designer's
checklist: timing, direction, easing, blur, effect relationships, technical
settings, and render destination should all be explicit.

### 6. Add fake-server tests

Add:

1. a dry-run snapshot for every meaningful branch;
2. a full execution case using `test/helpers/fakeAe.ts`;
3. an exact mapped call-order assertion;
4. easing and motion-blur assertions for keyframe calls;
5. a failing final-render result proving verification fires;
6. adapter tests for any new ToolContract mapping.

Tests must not connect to Adobe, a live MCP server, a brain endpoint, or the
internet.

### 7. Run the gate and safety checks

```sh
pnpm verify
gitleaks detect --source . --redact
```

Review the diff for generated media, personal paths, credentials, and vendored
server code before opening the pull request.

## Adapter contributions

An adapter is declarative mapping data, not copied server code. Link to the
upstream server, state the version or commit whose tool surface you inspected,
map only ToolContract operations, and test exact names and argument shapes.
See [`docs/ADAPTERS.md`](docs/ADAPTERS.md).

## Brain contributions

Brains may only propose recipe IDs and parameter values or review a minimal
journal summary. They must never receive an engine or MCP client. Never log a
key, response body containing secrets, full journal, or project data. Provider
tests must use mock fetch implementations.

## Pull request checklist

- Keep the change focused and explain the professional use case.
- Add or update documentation and tests.
- Preserve deterministic output for identical recipe parameters.
- Confirm `pnpm verify` and gitleaks pass.
- Confirm no Adobe dependency was added to CI.
- Confirm no upstream MCP server code was vendored.
- Add a changelog entry when the change is user-visible.

Maintainers may request motion-design, adapter portability, or live-Adobe
verification before merging. Alpha compatibility claims should distinguish
fake-server proof from human-supervised real-server evidence.
