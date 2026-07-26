import { recipeSchema } from "../schema/recipe.js";

export const hdrSafeGradeRecipe = recipeSchema.parse({
  id: "hdr-safe-grade",
  title: "HDR-Safe Technical Grade",
  description:
    "Color-manages SDR footage into HLG and delivers a verified 10-bit HEVC HDR file.",
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
      suggestedExtension: "mp4",
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
          workingSpace: "Rec.2100 HLG Scene W100",
          allowWorkingSpaceChange: true,
          displayColorManagement: true,
          linearizeWorkingSpace: false,
          compensateForSceneReferredProfiles: true,
          intent: "technical-normalization-only",
        },
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["workingSpace", "bitsPerChannel", "refused"],
            properties: {
              workingSpace: {
                type: "string",
                equals: "Rec.2100 HLG Scene W100",
              },
              bitsPerChannel: { type: "number", equals: 32 },
              refused: { type: "array", equals: [] },
            },
          },
        },
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
          Exposure: 0,
          Offset: 0,
          "Gamma Correction": 1,
        },
        atTimeSeconds: 0,
        durationSeconds:
          "${steps.inspect-source-metadata.result.structuredContent.durationSeconds}",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 3 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
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
          "Input Black": 0,
          "Input White": 1,
          Gamma: 1,
          "Output Black": 0,
          "Output White": 1,
          "Clip To Output Black": 1,
          "Clip To Output White": 1,
        },
        atTimeSeconds: 0,
        durationSeconds:
          "${steps.inspect-source-metadata.result.structuredContent.durationSeconds}",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 7 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
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
        outputModuleTemplate: "IG HDR HLG ProRes",
        postProcess: "hevc-hlg",
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
            required: [
              "queued",
              "outputPath",
              "renderPath",
              "templateApplied",
              "postProcess",
            ],
            properties: {
              queued: { type: "boolean", equals: true },
              outputPath: { type: "string" },
              renderPath: { type: "string" },
              templateApplied: {
                type: "string",
                equals: "IG HDR HLG ProRes",
              },
              postProcess: { type: "string", equals: "hevc-hlg" },
            },
          },
        },
      },
      note:
        "Conductor renders a 10-bit ProRes intermediate, encodes HEVC Main 10 with BT.2020/HLG tags, and validates the delivered file before reporting success.",
    },
  ],
});
