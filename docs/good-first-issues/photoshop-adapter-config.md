# Add a documented Photoshop adapter configuration

Suggested labels: `good first issue`, `adapter`, `photoshop`

## Why

Conductor's adapter model is application-agnostic, but the alpha ships only a
complete generic After Effects mapping. A Photoshop example will exercise the
contract boundary without importing an upstream server.

## Scope

Choose one actively maintained open-source Photoshop MCP server, link its
repository, and record the inspected release or commit. Add a declarative
adapter configuration for the subset of existing ToolContract operations that
has an honest Photoshop equivalent.

Do not copy its server, plugin, scripts, schemas, or implementation. The
contribution should contain only independently written mapping data and tests.

## Acceptance criteria

- The adapter has a clear ID and upstream compatibility note.
- Every mapped operation has an exact tool-name and argument-shape unit test.
- Unsupported operations remain absent rather than receiving misleading maps.
- A documentation example shows how to select the adapter in local config.
- No network, Photoshop, or upstream checkout is needed by the test suite.
- The upstream project's license and attribution are linked in documentation.
- `pnpm verify` and gitleaks pass.

## Starting points

- `src/adapters/configs/genericAe.ts`
- `src/adapters/configs/fakeServer.ts`
- `test/adapter.test.ts`
- `docs/ADAPTERS.md`
