import { recipeSchema } from "../schema/recipe.js";

const renderQueueVerify = {
  type: "object",
  required: ["structuredContent"],
  properties: {
    structuredContent: {
      type: "object",
      required: ["queued", "outputPath"],
      properties: {
        queued: { type: "boolean", equals: true },
        outputPath: { type: "string" },
      },
    },
  },
} as const;

export const titleCardRecipe = recipeSchema.parse({
  id: "title-card",
  title: "Professional Title Card",
  description:
    "Builds a centered title card with an overshoot-settle entrance, gentle exit, motion blur, and verified render queue handoff.",
  targetServers: ["aftereffects"],
  params: {
    text: {
      type: "string",
      description: "Title text.",
      default: "A Deterministic Title",
      minLength: 1,
      maxLength: 120,
    },
    font: {
      type: "string",
      description: "Installed font family used for the title.",
      default: "Sans Serif",
      minLength: 1,
    },
    duration: {
      type: "number",
      description: "Composition duration in seconds.",
      default: 4,
      min: 1,
      max: 30,
    },
    sizePreset: {
      type: "enum",
      description: "Generic title size preset.",
      values: ["small", "medium", "large"],
      default: "medium",
    },
    inOutStyle: {
      type: "enum",
      description: "Crafted entrance and exit movement family.",
      values: ["rise", "fade", "track-in"],
      default: "rise",
    },
    outputPath: {
      type: "string",
      description: "Where to write the render.",
      minLength: 1,
      path: "save-file",
      suggestedExtension: "mov",
    },
  },
  steps: [
    {
      id: "inspect-project-state",
      server: "aftereffects",
      operation: "projectInfo",
      args: {
        action: "inspect",
        settings: {},
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "build-title-composition",
      server: "aftereffects",
      operation: "createComp",
      args: {
        name: "Conductor Title Card",
        width: 1920,
        height: 1080,
        pixelAspect: 1,
        frameRate: 24,
        durationSeconds: "${params.duration}",
        backgroundColor: "#101010",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["compId"],
          },
        },
      },
    },
    {
      id: "place-centered-title-layer",
      server: "aftereffects",
      operation: "addTextLayer",
      args: {
        compId:
          "${steps.build-title-composition.result.structuredContent.compId}",
        name: "Primary Title",
        text: "${params.text}",
        font: "${params.font}",
        sizePreset: "${params.sizePreset}",
        alignment: "center",
        position: [960, 540],
        color: "#F2F2F2",
        motionBlur: true,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["layerId"],
          },
        },
      },
    },
    {
      id: "entrance-overshoot-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.place-centered-title-layer.result.structuredContent.layerId}",
        property: "positionY",
        timeMode: "normalized",
        keyframes: [
          { time: 0, value: 640 },
          { time: 0.14, value: 522 },
          { time: 0.22, value: 540 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.2, 0.3, 1],
        },
        motionBlur: true,
      },
      precondition: '${params.inOutStyle} == "rise"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "fade-overshoot-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.place-centered-title-layer.result.structuredContent.layerId}",
        property: "opacityScale",
        timeMode: "normalized",
        keyframes: [
          { time: 0, value: { opacity: 0, scale: 96 } },
          { time: 0.14, value: { opacity: 100, scale: 102 } },
          { time: 0.22, value: { opacity: 100, scale: 100 } },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.2, 0.3, 1],
        },
        motionBlur: true,
      },
      precondition: '${params.inOutStyle} == "fade"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "track-in-overshoot-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.place-centered-title-layer.result.structuredContent.layerId}",
        property: "tracking",
        timeMode: "normalized",
        keyframes: [
          { time: 0, value: 80 },
          { time: 0.14, value: -4 },
          { time: 0.22, value: 0 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.2, 0.3, 1],
        },
        motionBlur: true,
      },
      precondition: '${params.inOutStyle} == "track-in"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "rise-gentle-exit-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.place-centered-title-layer.result.structuredContent.layerId}",
        property: "positionYOpacity",
        timeMode: "normalized",
        keyframes: [
          { time: 0.82, value: { positionY: 540, opacity: 100 } },
          { time: 1, value: { positionY: 490, opacity: 0 } },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: true,
      },
      precondition: '${params.inOutStyle} == "rise"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "fade-gentle-exit-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.place-centered-title-layer.result.structuredContent.layerId}",
        property: "opacity",
        timeMode: "normalized",
        keyframes: [
          { time: 0.82, value: 100 },
          { time: 1, value: 0 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: false,
      },
      precondition: '${params.inOutStyle} == "fade"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "track-out-gentle-exit-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.place-centered-title-layer.result.structuredContent.layerId}",
        property: "trackingOpacity",
        timeMode: "normalized",
        keyframes: [
          { time: 0.82, value: { tracking: 0, opacity: 100 } },
          { time: 1, value: { tracking: 36, opacity: 0 } },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: true,
      },
      precondition: '${params.inOutStyle} == "track-in"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "queue-verified-title-render",
      server: "aftereffects",
      operation: "queueRender",
      args: {
        compId:
          "${steps.build-title-composition.result.structuredContent.compId}",
        outputPath: "${params.outputPath}",
        format: "QuickTime",
        codec: "ProRes 422",
        bitDepth: 10,
        colorSpace: "Rec.709 Gamma 2.4",
        renderSettings: {
          quality: "best",
          motionBlur: true,
          frameBlending: false,
        },
      },
      verify: renderQueueVerify,
      note:
        "Render queue handoff verified: confirm the reported output path before supervised rendering.",
    },
  ],
});
