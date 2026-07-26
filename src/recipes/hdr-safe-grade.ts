import { recipeSchema } from "../schema/recipe.js";

export const hdrSafeGradeRecipe = recipeSchema.parse({
  id: "hdr-safe-grade",
  title: "HDR-Safe Technical Grade",
  description:
    "Applies a conservative HLG technical normalization chain with bounded exposure and levels, then queues a verified 10-bit master.",
  targetServers: ["aftereffects"],
  params: {
    clip: {
      type: "string",
      description: "The source clip to grade.",
      minLength: 1,
      path: "open-file",
    },
    target: {
      type: "enum",
      description: "Target HDR transfer function.",
      values: ["hlg"],
      default: "hlg",
    },
    outputPath: {
      type: "string",
      description: "Where to write the 10-bit master.",
      minLength: 1,
      path: "save-file",
      suggestedExtension: "mov",
    },
  },
  steps: [
    {
      id: "inspect-source-metadata",
      server: "aftereffects",
      operation: "projectInfo",
      args: {
        action: "inspect",
        mediaPath: "${params.clip}",
        settings: {
          includeColorMetadata: true,
          includeFrameRateAndDuration: true,
        },
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["width", "height", "frameRate", "durationSeconds"],
          },
        },
      },
    },
    {
      id: "configure-hlg-working-project",
      server: "aftereffects",
      operation: "projectInfo",
      args: {
        action: "configure",
        settings: {
          bitDepth: 32,
          workingSpace: "Rec.2100 HLG",
          displayColorManagement: true,
          linearizeWorkingSpace: false,
          compensateForSceneReferredProfiles: true,
          intent: "technical-normalization-only",
        },
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "build-source-matched-composition",
      server: "aftereffects",
      operation: "createComp",
      args: {
        name: "Conductor HLG Technical Master",
        width:
          "${steps.inspect-source-metadata.result.structuredContent.width}",
        height:
          "${steps.inspect-source-metadata.result.structuredContent.height}",
        pixelAspect: 1,
        frameRate:
          "${steps.inspect-source-metadata.result.structuredContent.frameRate}",
        durationSeconds:
          "${steps.inspect-source-metadata.result.structuredContent.durationSeconds}",
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
      id: "prepare-source-for-technical-grade",
      server: "aftereffects",
      operation: "precompose",
      args: {
        compId:
          "${steps.build-source-matched-composition.result.structuredContent.compId}",
        name: "Source Technical Grade",
        sources: [
          {
            path: "${params.clip}",
            role: "source",
            startTimeSeconds: 0,
          },
        ],
        layerIds: [],
        collapseTransformations: false,
        motionBlur: false,
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
      id: "bounded-exposure-normalization",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId:
          "${steps.prepare-source-for-technical-grade.result.structuredContent.layerId}",
        effect: "Exposure",
        settings: {
          exposureStops: 0,
          allowedAdjustmentStops: [-1, 1],
          offset: 0,
          gammaCorrection: 1,
          creativeLook: false,
        },
        atTimeSeconds: 0,
        durationSeconds:
          "${steps.inspect-source-metadata.result.structuredContent.durationSeconds}",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "broadcast-safe-levels-clamp",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId:
          "${steps.prepare-source-for-technical-grade.result.structuredContent.layerId}",
        effect: "Levels",
        settings: {
          inputBlack: 0,
          inputWhite: 1,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 0.98,
          clampSuperBlack: true,
          clampSuperWhite: true,
          creativeLook: false,
        },
        atTimeSeconds: 0,
        durationSeconds:
          "${steps.inspect-source-metadata.result.structuredContent.durationSeconds}",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "configure-10bit-hlg-output",
      server: "aftereffects",
      operation: "projectInfo",
      args: {
        action: "configure",
        settings: {
          target: "${params.target}",
          outputColorSpace: "Rec.2100 HLG",
          outputBitDepth: 10,
          preserveSourceLuminance: true,
          renderAtMaximumDepth: true,
          creativeLook: false,
        },
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
      },
    },
    {
      id: "queue-verified-10bit-hlg-render",
      server: "aftereffects",
      operation: "queueRender",
      args: {
        compId:
          "${steps.build-source-matched-composition.result.structuredContent.compId}",
        outputPath: "${params.outputPath}",
        format: "QuickTime",
        codec: "ProRes 422 HQ",
        bitDepth: 10,
        colorSpace: "Rec.2100 HLG",
        renderSettings: {
          quality: "best",
          renderAtMaximumDepth: true,
          colorManagement: "preserve-hlg",
          alpha: false,
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
        "Technical handoff: finish and validate the rendered output with the external DV tool reel-hdr before delivery.",
    },
  ],
});
