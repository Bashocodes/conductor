# Build a static HTML run-journal viewer

Suggested labels: `good first issue`, `tooling`, `journal`

## Why

JSON journals are complete but not ideal for reviewing timing, skips, mapped
arguments, verification, and errors with a motion designer.

## Scope

Add a command that reads one local Conductor journal and writes a standalone
HTML file. The output should require no server and no client-side dependency
download.

Suggested sections:

- run status, recipe, timestamps, and duration;
- proposal provenance when present;
- ordered step timeline;
- operation, concrete tool, duration, and status;
- collapsible sanitized arguments and result summaries;
- verification or structured error details.

## Safety constraints

- The viewer must never fetch remote resources.
- Treat every journal string as untrusted and HTML-escape it.
- Do not render raw HTML from notes, errors, arguments, or results.
- Do not add media previews or infer local filesystem links.

## Acceptance criteria

- A fixture journal renders deterministically to an inline snapshot or checked
  structural assertions.
- Tests cover malicious HTML strings and confirm escaping.
- Completed, skipped, and failed steps are visually distinguishable without
  relying only on color.
- The command refuses invalid journal JSON with a structured error.
- Documentation includes a generic example.
- `pnpm verify` and gitleaks pass.

## Starting points

- `src/engine/journal.ts`
- `src/cli.ts`
- `test/engine.integration.test.ts`
