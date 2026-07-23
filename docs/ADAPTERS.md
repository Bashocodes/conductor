# ToolContract adapter guide

Conductor recipes name stable logical operations. An adapter translates each
operation into the concrete MCP tool name and request shape exposed by one
server. This keeps craft recipes portable across the currently fragmented
Adobe MCP ecosystem.

Adapters are declarative data. They cannot run JavaScript or shell commands.

## Start by inspecting the server

Configure the MCP transport:

```json
{
  "servers": {
    "aftereffects": {
      "transport": "stdio",
      "command": "your-ae-mcp-command",
      "args": []
    }
  }
}
```

HTTP is also supported:

```json
{
  "servers": {
    "aftereffects": {
      "transport": "http",
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

In a human-supervised session, run `conductor doctor`. It connects, lists the
server's real tool names, and prints them. Do not guess tool names before this
inspection.

## The shipped generic AE adapter

`src/adapters/configs/genericAe.ts` ships a complete reference mapping. It is
used automatically for a server named `aftereffects` when no inline adapter is
provided.

| ToolContract operation | Generic MCP tool |
| --- | --- |
| `createComp` | `ae_create_composition` |
| `addTextLayer` | `ae_add_text_layer` |
| `setKeyframes` | `ae_set_keyframes` |
| `applyEffect` | `ae_apply_effect` |
| `precompose` | `ae_precompose` |
| `queueRender` | `ae_queue_render` |
| `projectInfo` | `ae_project_info` |

These names are examples, not a claim that every AE MCP server uses them.
Adjust tool names and templates to the output of your server's tool listing.

## Inline adapter configuration

Each server can carry its own adapter configuration:

```json
{
  "servers": {
    "aftereffects": {
      "transport": "stdio",
      "command": "your-ae-mcp-command",
      "args": [],
      "adapter": {
        "id": "my-ae-server",
        "label": "My AE MCP mapping",
        "operations": {
          "createComp": {
            "tool": "composition_create",
            "argsTemplate": {
              "comp_name": "${args.name}",
              "width_px": "${args.width}",
              "height_px": "${args.height}",
              "fps": "${args.frameRate}",
              "seconds": "${args.durationSeconds}",
              "pixel_aspect": "${args.pixelAspect}",
              "background": "${args.backgroundColor}"
            }
          },
          "queueRender": {
            "tool": "render_queue_add",
            "argsTemplate": {
              "composition": "${args.compId}",
              "destination": "${args.outputPath}",
              "module": {
                "format": "${args.format}",
                "codec": "${args.codec}",
                "bits": "${args.bitDepth}",
                "space": "${args.colorSpace}"
              },
              "settings": "${args.renderSettings}"
            }
          }
        }
      }
    }
  }
}
```

Adapter operation maps may be partial, but execution fails with a structured
`OPERATION_NOT_MAPPED` error if a recipe requests a missing operation. Provide
every operation used by the recipes you intend to run.

## Argument templates

An exact reference preserves the original JSON type:

```json
{
  "keyframes": "${args.keyframes}",
  "motion_blur": "${args.motionBlur}"
}
```

The first value remains an array and the second remains a boolean. A reference
embedded inside a larger string must be a primitive:

```json
{
  "label": "Render ${args.compId}"
}
```

Optional missing fields are omitted from the mapped request. Templates can
rename keys and nest values, but they cannot calculate, branch, or execute
code. Put deterministic timing and craft decisions in the recipe.

Before mapping a real call, Conductor validates the resolved logical arguments
against `src/adapters/toolContract.ts`. That validation is what makes missing
easing on a keyframe call fail before an MCP request is sent.

## Result contract

Reference recipes use the normal MCP result envelope and expect identifiers in
`structuredContent`:

| Operation | Required fields used by references |
| --- | --- |
| `createComp` | `structuredContent.compId` |
| `addTextLayer` | `structuredContent.layerId` |
| `precompose` | `structuredContent.layerId` and optionally `precompId` |
| `applyEffect` | `structuredContent.effectId` when later animated |
| `setKeyframes` | `structuredContent` |
| `queueRender` | `structuredContent.queued`, `structuredContent.outputPath` |
| `projectInfo` | operation-specific project or media metadata |

If a server returns different field names, place a thin MCP wrapper in front of
it that normalizes results to this envelope, or extend the adapter layer with a
declarative result template before registering that server. Never patch a
reference recipe with server-specific result paths.

## Photoshop and other Adobe servers

The adapter mechanism is server-name agnostic. A Photoshop server can define
the subset of ToolContract operations it supports—for example, map
`projectInfo` to document inspection and `applyEffect` to a technical
adjustment tool:

```json
{
  "servers": {
    "photoshop": {
      "transport": "http",
      "url": "http://127.0.0.1:3002/mcp",
      "adapter": {
        "id": "my-photoshop-server",
        "label": "My Photoshop MCP mapping",
        "operations": {
          "projectInfo": {
            "tool": "document_info",
            "argsTemplate": "${args}"
          },
          "applyEffect": {
            "tool": "apply_adjustment",
            "argsTemplate": {
              "document_or_layer_id": "${args.targetId}",
              "adjustment": "${args.effect}",
              "settings": "${args.settings}"
            }
          }
        }
      }
    }
  }
}
```

The three v0.1 reference recipes intentionally target `aftereffects`; do not
point them at Photoshop merely because an adapter exists.

## Testing an adapter

1. Unit-test every operation mapping with representative contract arguments.
2. Assert exact concrete tool names and mapped request shapes.
3. Run recipes through the in-process fake server first.
4. Use `--dry-run` to inspect the entire mapped plan without connecting.
5. Only then schedule a human-supervised Adobe session.

The shipped fake adapter maps all operations to `fake_*` tools and passes
contract arguments through unchanged. It is for tests only.
