# Recipe contributor guide

Conductor recipes are deterministic data. They contain no callbacks, `eval`,
shell commands, AI prompts, or server-specific MCP tool names. The engine
validates parameters, resolves references, applies preconditions, maps logical
operations through a server adapter, executes in order, verifies results, and
writes the run journal.

## Anatomy of a recipe

A recipe has five parts:

1. `id`, `title`, and `description` explain the result.
2. `targetServers` names the configured MCP servers it needs.
3. `params` declares serializable parameter definitions. A parameter without a
   default is required.
4. `steps` is the ordered checklist.
5. Each step names a ToolContract `operation`, never a concrete MCP tool.

The smallest useful step looks like this:

```ts
{
  id: "build-delivery-composition",
  server: "aftereffects",
  operation: "createComp",
  args: {
    name: "Delivery Composition",
    width: 1920,
    height: 1080,
    pixelAspect: 1,
    frameRate: 24,
    durationSeconds: "${params.duration}",
    backgroundColor: "#000000"
  },
  verify: {
    type: "object",
    required: ["structuredContent"],
    properties: {
      structuredContent: {
        type: "object",
        required: ["compId"]
      }
    }
  }
}
```

Exact `${...}` references preserve their JSON type. A number parameter remains
a number, and a prior `layerId` remains a string. References inside a larger
string must resolve to primitives.

```text
${params.outputPath}
${steps.build-delivery-composition.result.structuredContent.compId}
```

Preconditions use Conductor's small expression language:

```text
${params.style} == "whip"
steps.inspect.result.structuredContent.frameRate >= 24
exists(steps.prepare.result.structuredContent.layerId)
```

`verify` is a JSON-like expected-shape assertion evaluated after the mapped MCP
call. A shape may also declare `equals` for a required value—for example, the
terminal render checks that `queued` is exactly `true`, not merely a boolean.
`note` is non-executable runbook text copied into dry runs and journals. Use it
for supervised delivery or quality-control instructions.

## ToolContract operations

The reference recipes depend on eight logical operations:

| Operation | Responsibility |
| --- | --- |
| `projectInfo` | Inspect media/project metadata or configure project settings |
| `createComp` | Create a composition with explicit technical settings |
| `addTextLayer` | Add and style a text layer |
| `addMediaLayer` | Add a brand image at a comp-relative size and safe position |
| `setKeyframes` | Apply two or more keyframes with required cubic-bezier easing |
| `applyEffect` | Apply a named effect with explicit bounded settings and timing |
| `precompose` | Import/organize sources or precompose existing layers |
| `queueRender` | Add an explicit output module and destination to the render queue |

The runtime schemas are in
[`src/adapters/toolContract.ts`](../src/adapters/toolContract.ts). In
particular, `setKeyframes` has no linear easing variant: it requires a
`cubic-bezier` profile and control points.

## Craft invariants

Reference recipes should be reviewable as a professional checklist:

- Name steps for intent, not implementation: `burst-peak-frame`, not
  `keyframes-4`.
- Every camera or position move uses eased keyframes. Never encode a linear
  move.
- Enable motion blur on every moving layer.
- Motivate transitions with light, luminance direction, or matched movement.
  A bare crossfade is not a reference transition.
- End with `queueRender`, an explicit output path, and a result verification.
- Use generic typography, colors, paths, and names. Reference recipes must not
  contain private brands, watermarks, or proprietary look presets.
- Keep technical grades neutral and bounded. Do not hide a creative look in a
  “safe” transform.

## Reference 1: `title-card`

The title card is a compact typography recipe:

1. `inspect-project-state` confirms that the server can report project state.
2. `build-title-composition` creates a 1920×1080 composition at 24 fps.
3. `place-centered-title-layer` adds generic centered typography and enables
   motion blur.
4. One entrance branch runs:
   - `entrance-overshoot-keyframes` rises past the resting position and settles;
   - `fade-overshoot-keyframes` couples opacity with a restrained scale settle;
   - `track-in-overshoot-keyframes` contracts wide tracking past zero and
     settles.
5. The matching exit branch applies a slower, gentler curve.
6. `queue-verified-title-render` queues a 10-bit mezzanine file at the
   user-supplied output path and verifies the queue response.

The entrance and exit use normalized time, so changing `duration` retains the
same motion relationships.

## Reference 2: `motivated-transition`

The transition recipe builds one six-second edit composition and prepares the
outgoing and incoming sources as separate precomps. Its three style branches
share the same cut center at three seconds:

- `dip-to-light` creates a radial additive burst. `burst-peak-frame` reaches
  peak intensity on the edit point, while outgoing and incoming opacity moves
  overlap beneath the light. The light explains the luminance discontinuity.
- `luma-wipe` creates a procedural matte traveling left-to-right and eases its
  progress in the same direction. It is a directional reveal, not a crossfade.
- `whip` applies directional blur and sends both clips right-to-left. The
  outgoing layer accelerates before the incoming layer decelerates to center;
  both moving layers have motion blur enabled.

`queue-verified-transition-render` is always the last step.

## Reference 3: `hdr-safe-grade`

This recipe keeps the approved HLG technical path and exposes three bounded
creative strengths:

- `Natural HDR` is the preselected choice and reproduces the established look.
- `Vivid HDR` adds a moderate exposure, contrast, and color lift.
- `Impact HDR` makes the HDR character clearly noticeable without using an
  unbounded or destructive grade.

1. `inspect-source-metadata` gets dimensions, frame rate, duration, and color
   metadata.
2. `configure-hlg-working-project` requires AE's exact
   `Rec.2100 HLG Scene W100` working space at 32 bits per channel; a refusal is
   a failed step, not a green check.
3. `build-source-matched-composition` preserves source geometry and timing.
4. `prepare-source-for-technical-grade` isolates the source.
5. `bounded-exposure-normalization` selects the strength's bounded exposure
   and gamma values. Natural remains exactly neutral.
6. `broadcast-safe-levels-clamp` protects black in every mode. Natural keeps
   the established white clamp; Vivid and Impact preserve 32-bpc over-range
   highlight values.
7. `controlled-color-separation` is skipped for Natural. Vivid and Impact use
   bounded Vibrance and Saturation controls to separate color without a broad
   hue shift.
8. `queue-verified-10bit-hlg-render` requires the installed
   `IG HDR HLG ProRes` output module instead of silently accepting AE's default
   H.264 module. Conductor renders that 10-bit intermediate, encodes HEVC Main
   10 with BT.2020/HLG tags, and probes the delivered file before reporting
   success.

## Adding a recipe

1. Create a data module in `src/recipes/` and pass its object through
   `recipeSchema.parse`.
2. Register it in `src/recipes/index.ts`.
3. Dry-run every parameter branch and read the plan as an editor or motion
   designer would.
4. Add a dry-run snapshot.
5. Execute it through the in-process fake adapter and assert mapped call order.
6. Assert every `setKeyframes` call has easing and every position move has
   motion blur.
7. Break the final fake render response and prove the final verification fails.
8. Run `pnpm verify`.
