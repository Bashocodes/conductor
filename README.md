# Conductor

Conductor is an open-source recipe engine for professional motion-design
automation. It is an MCP client, not another Adobe bridge: existing MCP servers
provide access to After Effects, Photoshop, Premiere, and similar tools;
Conductor supplies the deterministic craft layer that decides which calls to
make, in what order, with which easing and verification.

Version 0.1 contains no AI. A recipe is validated data, runs sequentially, and
produces a replayable JSON journal.

## Requirements

- Node.js 22 or newer
- pnpm
- One or more MCP servers for non-dry runs

## Setup

```sh
pnpm install
pnpm verify
cp conductor.config.example.json conductor.config.json
```

The local `conductor.config.json` is ignored because stdio commands, arguments,
environment values, and private HTTP endpoints vary by machine.

## CLI

```sh
pnpm build
node dist/cli.js recipes
node dist/cli.js run demo-title-card --dry-run \
  --param text="Hello from Conductor"
node dist/cli.js doctor
```

When the package is installed, the same commands use the `conductor` binary
declared by the package, for example `conductor recipes`.

`--dry-run` validates the recipe and parameters, applies defaults, resolves all
parameter references in step arguments, and preserves prior-output references
symbolically. It never loads config or connects to a server.

Every real run writes `runs/<run-id>.json`, including resolved arguments,
bounded result summaries, duration, skipped steps, and structured failures.

## Recipes

Recipes contain:

- identity, documentation, and target MCP server names;
- serializable typed parameter definitions (string, number, boolean, enum, or
  JSON), including descriptions, constraints, and optional defaults;
- ordered MCP tool calls with a timeout;
- `${params.name}` and `${steps.step-id.result.path}` references;
- optional safe preconditions; and
- optional JSON-like expected-shape assertions.

A parameter without a default is required. Preconditions intentionally use a
small, non-executable language:

```text
${steps.inspect.result.ready} == true
steps.inspect.result.count >= 1
exists(steps.create.result.layerId)
!exists(steps.lookup.result.warning)
```

There is no `eval`, recipe callback, script step, or shell step. A stdio command
may appear only in the trusted, machine-owned Conductor config because it is
needed to launch an MCP server.

## Development gate

```sh
pnpm verify
```

This runs strict TypeScript checking, the Vitest suite, and the ESM build.
