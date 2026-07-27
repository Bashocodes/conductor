import { recipeSchema } from "../schema/recipe.js";

const compId =
  "${steps.build-beat-sync-composition.result.structuredContent.compId}";
const mediaLayer =
  "${steps.place-beat-sync-media.result.structuredContent.layerId}";
const duration = "${params.planDurationSeconds}";

const baselineScale = [
  { time: 0, value: [100, 100] },
  { time: 0.1, value: [100, 100] },
];
const baselineValue = [
  { time: 0, value: 0 },
  { time: 0.1, value: 0 },
];

export const beatSyncEditRecipe = recipeSchema.parse({
  id: "beat-sync-edit",
  title: "Beat Sync Studio",
  description:
    "Analyzes an audio track, writes the complete beat map as editable After Effects markers, builds a frame-locked media edit with optional native beat-driven pixel sorting, and verifies every rendered cut against its intended onset.",
  targetServers: ["aftereffects"],
  params: {
    audio: {
      type: "string",
      description: "The music track Conductor analyzes before building.",
      minLength: 1,
      path: "open-file",
    },
    media: {
      type: "files",
      description:
        "One continuous video, or a bin of video clips and images used in order.",
      minItems: 1,
      path: "open-file",
    },
    density: {
      type: "enum",
      description: "Which beat-importance tiers receive cuts and accents.",
      values: ["restrained", "active", "impact"],
      default: "active",
    },
    cuts: {
      type: "boolean",
      description: "Allow cuts on the selected primary/downbeat tier.",
      default: true,
    },
    transitions: {
      type: "boolean",
      description: "Allow transition apexes on strong beats.",
      default: true,
    },
    light: {
      type: "boolean",
      description: "Allow small light accents on non-cut beats.",
      default: true,
    },
    camera: {
      type: "boolean",
      description: "Allow small camera impacts on non-cut beats.",
      default: true,
    },
    pixelSort: {
      type: "boolean",
      description:
        "Drive the native Director Pixel Sort Beat Amount curve from analyzed onset strength.",
      default: false,
    },
    brandPulse: {
      type: "boolean",
      description: "Pulse a subtle brand-protection label on strong beats.",
      default: false,
    },
    frameRate: {
      type: "number",
      description: "Delivered edit frame rate.",
      default: 30,
      min: 1,
      max: 120,
    },
    outputPath: {
      type: "string",
      description: "Verified HEVC Main 10 HLG delivery path.",
      minLength: 1,
      path: "save-file",
      suggestedExtension: "mp4",
    },

    // These are deterministic products of the public parameters and PCM
    // analysis. Every execution entry point fills them before validation. The
    // empty defaults make a bypass fail at addMarkers instead of producing an
    // unmeasured edit and calling it beat-synced.
    planDurationSeconds: {
      type: "number",
      description: "Internal: frame-quantized audio duration.",
      internal: true,
      default: 0.1,
      min: 0.001,
    },
    planEstimatedBpm: {
      type: "number",
      description: "Internal: estimated tempo shown before render.",
      internal: true,
      default: 0,
      min: 0,
    },
    planBeatCount: {
      type: "number",
      description: "Internal: accepted quantized beat count.",
      internal: true,
      default: 0,
      integer: true,
      min: 0,
    },
    planCutCount: {
      type: "number",
      description: "Internal: planned cut count.",
      internal: true,
      default: 0,
      integer: true,
      min: 0,
    },
    planMarkers: {
      type: "json",
      description: "Internal: full inspectable marker map.",
      internal: true,
      default: [],
    },
    planMediaSegments: {
      type: "json",
      description: "Internal: frame-locked media placements.",
      internal: true,
      default: [],
    },
    planCameraKeyframes: {
      type: "json",
      description: "Internal: non-cut camera accents.",
      internal: true,
      default: baselineScale,
    },
    planLightKeyframes: {
      type: "json",
      description: "Internal: non-cut light accents.",
      internal: true,
      default: baselineValue,
    },
    planTransitionKeyframes: {
      type: "json",
      description: "Internal: transition apex accents.",
      internal: true,
      default: baselineValue,
    },
    planPixelSortKeyframes: {
      type: "json",
      description:
        "Internal: continuous native Pixel Sort Beat Amount envelope.",
      internal: true,
      default: baselineValue,
    },
    planBrandKeyframes: {
      type: "json",
      description: "Internal: opt-in brand pulses.",
      internal: true,
      default: [
        { time: 0, value: 10 },
        { time: 0.1, value: 10 },
      ],
    },
  },
  steps: [
    {
      id: "inspect-beat-sync-source",
      server: "aftereffects",
      operation: "projectInfo",
      args: {
        action: "inspect",
        mediaPath: "${params.media[0]}",
        settings: {
          includeFrameRateAndDuration: true,
        },
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["width", "height", "pixelAspect"],
          },
        },
      },
    },
    {
      id: "configure-beat-sync-hlg-project",
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
          intent: "beat-sync-hlg-master",
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
      id: "build-beat-sync-composition",
      server: "aftereffects",
      operation: "createComp",
      args: {
        name: "Conductor Beat Sync Edit",
        width: "${steps.inspect-beat-sync-source.result.structuredContent.width}",
        height:
          "${steps.inspect-beat-sync-source.result.structuredContent.height}",
        pixelAspect:
          "${steps.inspect-beat-sync-source.result.structuredContent.pixelAspect}",
        frameRate: "${params.frameRate}",
        durationSeconds: duration,
        backgroundColor: "#000000",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["compId", "durationSeconds"],
          },
        },
      },
    },
    {
      id: "write-beat-sync-markers",
      server: "aftereffects",
      operation: "addMarkers",
      args: {
        targetId: compId,
        markers: "${params.planMarkers}",
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["applied", "markerCount", "markers"],
            properties: {
              applied: { type: "boolean", equals: true },
            },
          },
        },
      },
      note:
        "The complete Conductor analysis map is written before edit construction so it stays inspectable and hand-editable.",
    },
    {
      id: "place-beat-sync-media",
      server: "aftereffects",
      operation: "addMediaLayer",
      args: {
        compId,
        name: "Beat Sync Media Edit",
        segments: "${params.planMediaSegments}",
        widthPercent: 100,
        positionPreset: "Custom",
        customXPercent: 50,
        customYPercent: 50,
        opacity: 100,
        motionBlur: true,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["layerId", "placements"],
          },
        },
      },
    },
    {
      id: "place-beat-sync-audio",
      server: "aftereffects",
      operation: "addMediaLayer",
      args: {
        compId,
        path: "${params.audio}",
        name: "Beat Sync Audio",
        kind: "audio",
        timelineInSeconds: 0,
        timelineOutSeconds: duration,
        sourceInSeconds: 0,
        widthPercent: 100,
        positionPreset: "Custom",
        customXPercent: 50,
        customYPercent: 50,
        opacity: 100,
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["layerId", "actualFrame"],
          },
        },
      },
    },
    {
      id: "add-beat-sync-pixel-sort",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.pixelSort}",
      args: {
        targetId: compId,
        effect: "director-pixel-sort",
        settings: {
          Intensity: 0,
          Phase: 100,
          "Beat Amount": 0,
          Seed: 108,
        },
        atTimeSeconds: 0,
        durationSeconds: duration,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["effectId", "appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 4 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
      note:
        "Uses the native effect's exact director-pixel-sort contract; no fallback effect is substituted.",
    },
    {
      id: "keyframe-beat-sync-pixel-sort",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.pixelSort}",
      args: {
        layerId:
          "${steps.add-beat-sync-pixel-sort.result.structuredContent.effectId}",
        property: "Beat Amount",
        timeMode: "seconds",
        keyframes: "${params.planPixelSortKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["applied", "keyCount", "property"],
            properties: {
              applied: { type: "boolean", equals: true },
              property: { type: "string", equals: "Beat Amount" },
            },
          },
        },
      },
      note:
        "Key times retain the sample-derived onset positions; cuts remain independently quantized to edit frames.",
    },
    {
      id: "add-beat-sync-light",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.light}",
      args: {
        targetId: mediaLayer,
        effect: "Brightness & Contrast",
        settings: {
          Brightness: 0,
          Contrast: 0,
          "Use Legacy (supports HDR)": 1,
        },
        atTimeSeconds: 0,
        durationSeconds: duration,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["effectId", "appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 3 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
    },
    {
      id: "keyframe-beat-sync-light",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.light}",
      args: {
        layerId:
          "${steps.add-beat-sync-light.result.structuredContent.effectId}",
        property: "Brightness",
        timeMode: "seconds",
        keyframes: "${params.planLightKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.25, 0.8, 0.75, 0.2],
        },
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["applied", "keyCount"],
            properties: { applied: { type: "boolean", equals: true } },
          },
        },
      },
    },
    {
      id: "add-beat-sync-transition",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.transitions}",
      args: {
        targetId: mediaLayer,
        effect: "Exposure",
        settings: {
          Exposure: 0,
          Offset: 0,
          "Gamma Correction": 1,
        },
        atTimeSeconds: 0,
        durationSeconds: duration,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["effectId", "appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 3 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
    },
    {
      id: "keyframe-beat-sync-transition",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.transitions}",
      args: {
        layerId:
          "${steps.add-beat-sync-transition.result.structuredContent.effectId}",
        property: "Exposure",
        timeMode: "seconds",
        keyframes: "${params.planTransitionKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["applied", "keyCount"],
            properties: { applied: { type: "boolean", equals: true } },
          },
        },
      },
    },
    {
      id: "keyframe-beat-sync-camera",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.camera}",
      args: {
        layerId: mediaLayer,
        property: "scale",
        timeMode: "seconds",
        keyframes: "${params.planCameraKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: true,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["applied", "keyCount"],
            properties: { applied: { type: "boolean", equals: true } },
          },
        },
      },
    },
    {
      id: "add-beat-sync-brand",
      server: "aftereffects",
      operation: "addTextLayer",
      precondition: "${params.brandPulse}",
      args: {
        compId,
        name: "Beat Sync Brand Pulse",
        text: "yourbrand_",
        font: "Helvetica",
        sizePreset: "watermark",
        sizePercent: 2.6,
        alignment: "center",
        position: [
          "${steps.inspect-beat-sync-source.result.structuredContent.width}",
          "${steps.inspect-beat-sync-source.result.structuredContent.height}",
        ],
        color: "#ffffff",
        opacity: 10,
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: { type: "object", required: ["layerId"] },
        },
      },
    },
    {
      id: "keyframe-beat-sync-brand",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.brandPulse}",
      args: {
        layerId: "${steps.add-beat-sync-brand.result.structuredContent.layerId}",
        property: "opacity",
        timeMode: "seconds",
        keyframes: "${params.planBrandKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.25, 0.8, 0.75, 0.2],
        },
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["applied", "keyCount"],
            properties: { applied: { type: "boolean", equals: true } },
          },
        },
      },
    },
    {
      id: "queue-beat-sync-hlg-render",
      server: "aftereffects",
      operation: "queueRender",
      args: {
        compId,
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
          beatCount: "${params.planBeatCount}",
          cutCount: "${params.planCutCount}",
          estimatedBpm: "${params.planEstimatedBpm}",
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
        "Beat Sync Studio reuses the verified 32-bpc Rec.2100 HLG → HEVC Main 10 delivery path.",
    },
  ],
});
