# Extract a reusable easing-preset library

Suggested labels: `good first issue`, `recipe`, `craft`

## Why

Reference recipes currently repeat explicit cubic-bezier profiles. A small
data-only preset catalog would make motion relationships easier to review
without weakening the no-linear-motion invariant.

## Scope

Add named, immutable data presets for a minimal set such as:

- `overshoot-settle`;
- `gentle-exit`;
- `controlled-peak`;
- `matched-whip-out`;
- `matched-whip-in`.

Presets should remain JSON-serializable values accepted by the ToolContract.
Recipes may import data constants, but not functions that compute motion at
runtime.

## Acceptance criteria

- Every preset has a craft description and four finite control-point values.
- Tests prove presets satisfy the existing easing schema.
- No preset represents linear easing.
- Matched pairs document how their timing relationship should be used.
- Existing reference dry-run snapshots remain deterministic.
- At least two references reuse the catalog without changing planned values.
- `docs/RECIPES.md` explains when each profile is appropriate.
- `pnpm verify` and gitleaks pass.

## Starting points

- `src/adapters/toolContract.ts`
- `src/recipes/title-card.ts`
- `src/recipes/motivated-transition.ts`
- `test/engine.integration.test.ts`
