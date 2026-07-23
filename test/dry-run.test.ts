import { describe, expect, it } from "vitest";

import { createDryRunPlan } from "../src/engine/dry-run.js";
import { demoTitleCardRecipe } from "../src/recipes/demo-title-card.js";

describe("dry run", () => {
  it("snapshots a fully parameter-resolved plan without an MCP client", () => {
    expect(
      createDryRunPlan(demoTitleCardRecipe, {
        text: "Kinetic Type",
        durationFrames: 96,
      }),
    ).toMatchInlineSnapshot(`
      {
        "params": {
          "accentColor": "#F6C453",
          "durationFrames": 96,
          "text": "Kinetic Type",
        },
        "recipeId": "demo-title-card",
        "steps": [
          {
            "args": {
              "easing": {
                "influence": [
                  66,
                  66,
                ],
                "type": "cubic-bezier",
              },
              "fill": "#F6C453",
              "inFrame": 0,
              "outFrame": 96,
              "position": [
                960,
                540,
              ],
              "text": "Kinetic Type",
            },
            "id": "create-title",
            "server": "aftereffects",
            "timeoutMs": 30000,
            "tool": "create_title_card",
            "verify": {
              "properties": {
                "content": {
                  "type": "array",
                },
              },
              "required": [
                "content",
              ],
              "type": "object",
            },
          },
        ],
        "title": "Demo Title Card",
      }
    `);
  });
});
