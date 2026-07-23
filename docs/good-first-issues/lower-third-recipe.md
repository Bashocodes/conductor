# Add a professional lower-third recipe

Suggested labels: `good first issue`, `recipe`, `aftereffects`

## Why

Lower thirds are common, bounded motion-design components and a strong example
of reusable craft beyond the title-card reference.

## Scope

Add an After Effects recipe with parameters for primary text, optional
secondary text, duration, screen side, entrance style, and output path. Use
generic typography and neutral colors.

The checklist should:

1. create a delivery composition;
2. build a text-and-backing-plate precomp;
3. place it inside title-safe margins;
4. animate a short eased entrance with a small settle;
5. hold long enough for reading;
6. animate a gentler exit in the same directional language;
7. queue and verify the render.

## Craft constraints

- Direction must follow the selected screen side.
- Position keyframes must use cubic-bezier easing.
- Moving text and backing layers must enable motion blur.
- Text hierarchy and safe-area placement must be explicit.
- The animation must not depend on a brand font, logo, or palette.

## Acceptance criteria

- The recipe passes schema validation and is registered.
- Dry-run snapshots cover both screen sides and all entrance styles.
- Fake-server execution asserts exact call order.
- Every position keyframe call asserts easing and motion blur.
- A deliberately invalid fake render result proves final verification fires.
- `docs/RECIPES.md` explains the new checklist.
- `pnpm verify` and gitleaks pass.

## Starting points

- `src/recipes/title-card.ts`
- `test/dry-run.test.ts`
- `test/engine.integration.test.ts`
- `docs/RECIPES.md`
