import { recipeSchema } from "../schema/recipe.js";

export const demoTitleCardRecipe = recipeSchema.parse({
  id: "demo-title-card",
  title: "Demo Title Card",
  description:
    "Creates one centered title card with an explicit duration, color, and easing profile.",
  targetServers: ["aftereffects"],
  params: {
    text: {
      type: "string",
      description: "The title shown on screen.",
      default: "Hello, Conductor",
      minLength: 1,
    },
    durationFrames: {
      type: "number",
      description: "How long the title remains on screen, in frames.",
      default: 72,
      integer: true,
      min: 1,
    },
    accentColor: {
      type: "string",
      description: "Title fill color as a CSS-style hex value.",
      default: "#F6C453",
      pattern: "^#[0-9A-Fa-f]{6}$",
    },
  },
  steps: [
    {
      id: "create-title",
      server: "aftereffects",
      tool: "create_title_card",
      args: {
        text: "${params.text}",
        inFrame: 0,
        outFrame: "${params.durationFrames}",
        position: [960, 540],
        fill: "${params.accentColor}",
        easing: {
          type: "cubic-bezier",
          influence: [66, 66],
        },
      },
      timeoutMs: 30_000,
      verify: {
        type: "object",
        required: ["content"],
        properties: {
          content: {
            type: "array",
          },
        },
      },
    },
  ],
});
