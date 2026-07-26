import { recipeSchema } from "../schema/recipe.js";

export const motivatedTransitionRecipe = recipeSchema.parse({
  id: "motivated-transition",
  title: "Motivated Transition",
  description:
    "Builds a light-motivated dip, directional luma wipe, or motion-matched whip transition—never a bare crossfade.",
  targetServers: ["aftereffects"],
  params: {
    clipA: {
      type: "string",
      description: "The outgoing clip.",
      minLength: 1,
      path: "open-file",
    },
    clipB: {
      type: "string",
      description: "The incoming clip.",
      minLength: 1,
      path: "open-file",
    },
    style: {
      type: "enum",
      description: "Motivated transition construction.",
      values: ["dip-to-light", "luma-wipe", "whip"],
      default: "dip-to-light",
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
      id: "inspect-edit-project",
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
      id: "build-transition-composition",
      server: "aftereffects",
      operation: "createComp",
      args: {
        name: "Conductor Motivated Transition",
        width: 1920,
        height: 1080,
        pixelAspect: 1,
        frameRate: 24,
        durationSeconds: 6,
        backgroundColor: "#000000",
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
      id: "prepare-outgoing-clip",
      server: "aftereffects",
      operation: "precompose",
      args: {
        compId:
          "${steps.build-transition-composition.result.structuredContent.compId}",
        name: "Outgoing Clip",
        sources: [
          {
            path: "${params.clipA}",
            role: "outgoing",
            startTimeSeconds: 0,
          },
        ],
        layerIds: [],
        collapseTransformations: false,
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
      id: "prepare-incoming-clip",
      server: "aftereffects",
      operation: "precompose",
      args: {
        compId:
          "${steps.build-transition-composition.result.structuredContent.compId}",
        name: "Incoming Clip",
        sources: [
          {
            path: "${params.clipB}",
            role: "incoming",
            startTimeSeconds: 2.5,
          },
        ],
        layerIds: [],
        collapseTransformations: false,
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
      id: "light-burst-motivation",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId:
          "${steps.build-transition-composition.result.structuredContent.compId}",
        effect: "Radial Light Burst",
        settings: {
          blendMode: "add",
          color: "#FFFFFF",
          radius: 0.72,
          peakFrame: 72,
        },
        atTimeSeconds: 2.5,
        durationSeconds: 1,
      },
      precondition: '${params.style} == "dip-to-light"',
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["effectId"],
          },
        },
      },
    },
    {
      id: "burst-peak-frame",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.light-burst-motivation.result.structuredContent.effectId}",
        property: "intensity",
        timeMode: "seconds",
        keyframes: [
          { time: 2.55, value: 0 },
          { time: 3, value: 1 },
          { time: 3.45, value: 0 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.33, 0, 0.67, 1],
        },
        motionBlur: false,
      },
      precondition: '${params.style} == "dip-to-light"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "outgoing-dip-under-burst",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.prepare-outgoing-clip.result.structuredContent.layerId}",
        property: "opacity",
        timeMode: "seconds",
        keyframes: [
          { time: 2.7, value: 100 },
          { time: 3.05, value: 0 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: false,
      },
      precondition: '${params.style} == "dip-to-light"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "incoming-reveal-under-burst",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.prepare-incoming-clip.result.structuredContent.layerId}",
        property: "opacity",
        timeMode: "seconds",
        keyframes: [
          { time: 2.95, value: 0 },
          { time: 3.3, value: 100 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.1, 0.3, 1],
        },
        motionBlur: false,
      },
      precondition: '${params.style} == "dip-to-light"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "directional-luma-matte",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId:
          "${steps.prepare-incoming-clip.result.structuredContent.layerId}",
        effect: "Directional Luma Matte",
        settings: {
          directionDegrees: 0,
          featherPixels: 140,
          source: "procedural-ramp",
          travelDirection: "left-to-right",
        },
        atTimeSeconds: 2.5,
        durationSeconds: 1,
      },
      precondition: '${params.style} == "luma-wipe"',
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["effectId"],
          },
        },
      },
    },
    {
      id: "luma-wipe-directional-progress",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.directional-luma-matte.result.structuredContent.effectId}",
        property: "progress",
        timeMode: "seconds",
        keyframes: [
          { time: 2.55, value: 0 },
          { time: 3.45, value: 100 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "directional-wipe",
          controlPoints: [0.25, 0.1, 0.25, 1],
        },
        motionBlur: false,
      },
      precondition: '${params.style} == "luma-wipe"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "whip-directional-blur",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId:
          "${steps.build-transition-composition.result.structuredContent.compId}",
        effect: "Directional Blur",
        settings: {
          directionDegrees: 0,
          maximumBlurPixels: 90,
          travelDirection: "right-to-left",
        },
        atTimeSeconds: 2.55,
        durationSeconds: 0.9,
      },
      precondition: '${params.style} == "whip"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "outgoing-whip-position-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.prepare-outgoing-clip.result.structuredContent.layerId}",
        property: "positionX",
        timeMode: "seconds",
        keyframes: [
          { time: 2.55, value: 960 },
          { time: 3.1, value: -1100 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "whip-acceleration",
          controlPoints: [0.55, 0, 0.85, 0.35],
        },
        motionBlur: true,
      },
      precondition: '${params.style} == "whip"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "incoming-whip-position-keyframes",
      server: "aftereffects",
      operation: "setKeyframes",
      args: {
        layerId:
          "${steps.prepare-incoming-clip.result.structuredContent.layerId}",
        property: "positionX",
        timeMode: "seconds",
        keyframes: [
          { time: 2.85, value: 3020 },
          { time: 3.4, value: 960 },
        ],
        easing: {
          type: "cubic-bezier",
          profile: "whip-deceleration",
          controlPoints: [0.15, 0.65, 0.45, 1],
        },
        motionBlur: true,
      },
      precondition: '${params.style} == "whip"',
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "queue-verified-transition-render",
      server: "aftereffects",
      operation: "queueRender",
      args: {
        compId:
          "${steps.build-transition-composition.result.structuredContent.compId}",
        outputPath: "${params.outputPath}",
        format: "QuickTime",
        codec: "ProRes 422",
        bitDepth: 10,
        colorSpace: "Rec.709 Gamma 2.4",
        renderSettings: {
          quality: "best",
          motionBlur: true,
          frameBlending: true,
        },
      },
      verify: {
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
      },
      note:
        "Transition is motivated by light, luminance direction, or matched movement; no unmotivated crossfade is present.",
    },
  ],
});
