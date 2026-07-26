import { fileURLToPath } from "node:url";

import { recipeSchema } from "../schema/recipe.js";

export const CINEMATIC_LOOKS = [
  "Clean Cinema",
  "Golden Hour",
  "Teal & Amber",
  "Dream Bloom",
  "Film Noir",
  "Neon Night",
  "Bleach Bypass",
] as const;

export const DEFAULT_SAMPLE_LOGO = fileURLToPath(
  new URL("../../assets/sample-logo-transparent.png", import.meta.url),
);

const duration =
  "${steps.build-cinematic-composition.result.structuredContent.durationSeconds}";
const sourceLayer =
  "${steps.prepare-cinematic-source.result.structuredContent.layerId}";

function effectStep(
  id: string,
  look: (typeof CINEMATIC_LOOKS)[number],
  effect: string,
  settings: Record<string, unknown>,
  appliedParameterCount: number,
) {
  return {
    id,
    server: "aftereffects",
    operation: "applyEffect",
    precondition: `\${params.look} == '${look}'`,
    args: {
      targetId: sourceLayer,
      effect,
      settings,
      atTimeSeconds: 0,
      durationSeconds: duration,
    },
    verify: {
      type: "object",
      required: ["structuredContent"],
      properties: {
        structuredContent: {
          type: "object",
          required: ["appliedParameterCount", "refusedParameters"],
          properties: {
            appliedParameterCount: {
              type: "number",
              equals: appliedParameterCount,
            },
            refusedParameters: { type: "array", equals: [] },
          },
        },
      },
    },
  };
}

const lookSteps = [
  effectStep(
    "clean-cinema-contrast",
    "Clean Cinema",
    "Brightness & Contrast",
    {
      Brightness: 0,
      Contrast: 10,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),
  effectStep(
    "clean-cinema-color",
    "Clean Cinema",
    "Vibrance",
    { Vibrance: 8, Saturation: -1 },
    2,
  ),
  effectStep(
    "clean-cinema-texture",
    "Clean Cinema",
    "Noise",
    {
      "Amount of Noise": 0.8,
      "Noise Type": 0,
      Clipping: 1,
    },
    3,
  ),

  effectStep(
    "golden-hour-warmth",
    "Golden Hour",
    "Photo Filter",
    {
      Filter: 1,
      Color: [1, 0.47, 0.16, 1],
      Density: 18,
      "Preserve Luminosity": 1,
    },
    4,
  ),
  effectStep(
    "golden-hour-color",
    "Golden Hour",
    "Vibrance",
    { Vibrance: 10, Saturation: 2 },
    2,
  ),
  effectStep(
    "golden-hour-contrast",
    "Golden Hour",
    "Brightness & Contrast",
    {
      Brightness: 2,
      Contrast: 7,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),

  effectStep(
    "teal-amber-separation",
    "Teal & Amber",
    "Tritone",
    {
      Highlights: [1, 0.8, 0.55, 1],
      Midtones: [0.52, 0.46, 0.38, 1],
      Shadows: [0.03, 0.18, 0.22, 1],
      "Blend With Original": 72,
    },
    4,
  ),
  effectStep(
    "teal-amber-color",
    "Teal & Amber",
    "Vibrance",
    { Vibrance: 8, Saturation: -1 },
    2,
  ),
  effectStep(
    "teal-amber-contrast",
    "Teal & Amber",
    "Brightness & Contrast",
    {
      Brightness: 0,
      Contrast: 9,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),

  effectStep(
    "dream-bloom-rose",
    "Dream Bloom",
    "Photo Filter",
    {
      Filter: 1,
      Color: [0.95, 0.68, 0.82, 1],
      Density: 9,
      "Preserve Luminosity": 1,
    },
    4,
  ),
  effectStep(
    "dream-bloom-glow",
    "Dream Bloom",
    "Glow",
    {
      "Glow Based On": 1,
      "Glow Threshold": 165,
      "Glow Radius": 35,
      "Glow Intensity": 0.35,
    },
    4,
  ),
  effectStep(
    "dream-bloom-tone",
    "Dream Bloom",
    "Brightness & Contrast",
    {
      Brightness: 3,
      Contrast: -3,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),

  effectStep(
    "film-noir-monochrome",
    "Film Noir",
    "Black & White",
    {
      Reds: 52,
      Yellows: 68,
      Greens: 42,
      Cyans: 55,
      Blues: 36,
      Magentas: 48,
      "Tint:": 1,
      "Tint Color": [0.86, 0.9, 1, 1],
    },
    8,
  ),
  effectStep(
    "film-noir-contrast",
    "Film Noir",
    "Brightness & Contrast",
    {
      Brightness: -2,
      Contrast: 18,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),
  effectStep(
    "film-noir-texture",
    "Film Noir",
    "Noise",
    {
      "Amount of Noise": 1.4,
      "Noise Type": 0,
      Clipping: 1,
    },
    3,
  ),

  effectStep(
    "neon-night-separation",
    "Neon Night",
    "Tritone",
    {
      Highlights: [0.2, 0.95, 1, 1],
      Midtones: [0.52, 0.2, 0.72, 1],
      Shadows: [0.015, 0.035, 0.13, 1],
      "Blend With Original": 65,
    },
    4,
  ),
  effectStep(
    "neon-night-glow",
    "Neon Night",
    "Glow",
    {
      "Glow Based On": 1,
      "Glow Threshold": 120,
      "Glow Radius": 20,
      "Glow Intensity": 0.55,
    },
    4,
  ),
  effectStep(
    "neon-night-color",
    "Neon Night",
    "Vibrance",
    { Vibrance: 22, Saturation: 4 },
    2,
  ),
  effectStep(
    "neon-night-contrast",
    "Neon Night",
    "Brightness & Contrast",
    {
      Brightness: -2,
      Contrast: 14,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),

  effectStep(
    "bleach-bypass-desaturate",
    "Bleach Bypass",
    "Hue/Saturation",
    {
      "Master Hue": 0,
      "Master Saturation": -38,
      "Master Lightness": 0,
    },
    3,
  ),
  effectStep(
    "bleach-bypass-contrast",
    "Bleach Bypass",
    "Brightness & Contrast",
    {
      Brightness: 2,
      Contrast: 20,
      "Use Legacy (supports HDR)": 1,
    },
    3,
  ),
  effectStep(
    "bleach-bypass-texture",
    "Bleach Bypass",
    "Noise",
    {
      "Amount of Noise": 1.2,
      "Noise Type": 0,
      Clipping: 1,
    },
    3,
  ),
];

const gentleMotion = {
  Slow: [
    { time: 0, value: [0.18, 0.18] },
    { time: 0.25, value: [0.78, 0.28] },
    { time: 0.5, value: [0.68, 0.72] },
    { time: 0.75, value: [0.24, 0.78] },
    { time: 1, value: [0.18, 0.18] },
  ],
  Medium: [
    { time: 0, value: [0.18, 0.18] },
    { time: 0.125, value: [0.78, 0.28] },
    { time: 0.25, value: [0.68, 0.72] },
    { time: 0.375, value: [0.24, 0.78] },
    { time: 0.5, value: [0.18, 0.18] },
    { time: 0.625, value: [0.78, 0.28] },
    { time: 0.75, value: [0.68, 0.72] },
    { time: 0.875, value: [0.24, 0.78] },
    { time: 1, value: [0.18, 0.18] },
  ],
  Fast: [
    { time: 0, value: [0.18, 0.18] },
    { time: 0.0833, value: [0.78, 0.28] },
    { time: 0.1667, value: [0.68, 0.72] },
    { time: 0.25, value: [0.24, 0.78] },
    { time: 0.3333, value: [0.18, 0.18] },
    { time: 0.4167, value: [0.78, 0.28] },
    { time: 0.5, value: [0.68, 0.72] },
    { time: 0.5833, value: [0.24, 0.78] },
    { time: 0.6667, value: [0.18, 0.18] },
    { time: 0.75, value: [0.78, 0.28] },
    { time: 0.8333, value: [0.68, 0.72] },
    { time: 0.9167, value: [0.24, 0.78] },
    { time: 1, value: [0.18, 0.18] },
  ],
};

const verticalMotion = {
  Slow: [
    { time: 0, value: [0.82, 0.22] },
    { time: 0.5, value: [0.82, 0.76] },
    { time: 1, value: [0.82, 0.22] },
  ],
  Medium: [
    { time: 0, value: [0.82, 0.22] },
    { time: 0.25, value: [0.82, 0.76] },
    { time: 0.5, value: [0.82, 0.22] },
    { time: 0.75, value: [0.82, 0.76] },
    { time: 1, value: [0.82, 0.22] },
  ],
  Fast: [
    { time: 0, value: [0.82, 0.22] },
    { time: 0.1667, value: [0.82, 0.76] },
    { time: 0.3333, value: [0.82, 0.22] },
    { time: 0.5, value: [0.82, 0.76] },
    { time: 0.6667, value: [0.82, 0.22] },
    { time: 0.8333, value: [0.82, 0.76] },
    { time: 1, value: [0.82, 0.22] },
  ],
};

const cornerMotion = {
  Slow: [
    { time: 0, value: [0.18, 0.18] },
    { time: 0.25, value: [0.82, 0.18] },
    { time: 0.5, value: [0.82, 0.78] },
    { time: 0.75, value: [0.18, 0.78] },
    { time: 1, value: [0.18, 0.18] },
  ],
  Medium: [
    { time: 0, value: [0.18, 0.18] },
    { time: 0.125, value: [0.82, 0.18] },
    { time: 0.25, value: [0.82, 0.78] },
    { time: 0.375, value: [0.18, 0.78] },
    { time: 0.5, value: [0.18, 0.18] },
    { time: 0.625, value: [0.82, 0.18] },
    { time: 0.75, value: [0.82, 0.78] },
    { time: 0.875, value: [0.18, 0.78] },
    { time: 1, value: [0.18, 0.18] },
  ],
  Fast: [
    { time: 0, value: [0.18, 0.18] },
    { time: 0.0833, value: [0.82, 0.18] },
    { time: 0.1667, value: [0.82, 0.78] },
    { time: 0.25, value: [0.18, 0.78] },
    { time: 0.3333, value: [0.18, 0.18] },
    { time: 0.4167, value: [0.82, 0.18] },
    { time: 0.5, value: [0.82, 0.78] },
    { time: 0.5833, value: [0.18, 0.78] },
    { time: 0.6667, value: [0.18, 0.18] },
    { time: 0.75, value: [0.82, 0.18] },
    { time: 0.8333, value: [0.82, 0.78] },
    { time: 0.9167, value: [0.18, 0.78] },
    { time: 1, value: [0.18, 0.18] },
  ],
};

const staticMotion = {
  Slow: [
    { time: 0, value: [0.82, 0.76] },
    { time: 1, value: [0.82, 0.76] },
  ],
  Medium: [
    { time: 0, value: [0.82, 0.76] },
    { time: 1, value: [0.82, 0.76] },
  ],
  Fast: [
    { time: 0, value: [0.82, 0.76] },
    { time: 1, value: [0.82, 0.76] },
  ],
};

export const cinematicLookLabRecipe = recipeSchema.parse({
  id: "cinematic-look-lab",
  title: "Cinematic Look Lab",
  description:
    "Builds seven real After Effects look previews, then renders the chosen HDR cinema treatment with optional logo and moving username protection.",
  targetServers: ["aftereffects"],
  params: {
    clip: {
      type: "string",
      description: "The source clip to grade.",
      minLength: 1,
      path: "open-file",
    },
    strength: {
      type: "enum",
      description: "HDR intensity beneath the cinematic treatment.",
      values: ["Natural HDR", "Vivid HDR", "Impact HDR"],
      default: "Natural HDR",
    },
    look: {
      type: "enum",
      description: "The selected cinematic treatment.",
      values: [...CINEMATIC_LOOKS],
      default: "Clean Cinema",
    },
    renderMode: {
      type: "enum",
      description: "A two-second comparison sample or the complete source.",
      values: ["Preview", "Full"],
      default: "Full",
    },
    logoEnabled: {
      type: "boolean",
      description: "Place the selected brand logo above the grade.",
      default: true,
    },
    logoPath: {
      type: "string",
      description: "The selected transparent logo.",
      minLength: 1,
      path: "open-file",
      default: DEFAULT_SAMPLE_LOGO,
    },
    logoPosition: {
      type: "enum",
      description: "Logo placement in the safe area.",
      values: [
        "Top Right",
        "Top Left",
        "Bottom Right",
        "Bottom Left",
        "Custom",
      ],
      default: "Top Right",
    },
    logoXPercent: {
      type: "number",
      description: "Custom logo horizontal centre as a percentage.",
      min: 0,
      max: 100,
      default: 92.22,
    },
    logoYPercent: {
      type: "number",
      description: "Custom logo vertical centre as a percentage.",
      min: 0,
      max: 100,
      default: 6.56,
    },
    logoWidthPercent: {
      type: "number",
      description: "Logo width as a percentage of the frame.",
      min: 1,
      max: 30,
      default: 5.93,
    },
    logoVisibility: {
      type: "number",
      description: "Logo visibility: 50 means 50% visible.",
      min: 0,
      max: 100,
      default: 50,
    },
    watermarkEnabled: {
      type: "boolean",
      description: "Add a gently moving text watermark.",
      default: true,
    },
    watermarkText: {
      type: "string",
      description: "Exact moving watermark text.",
      minLength: 1,
      maxLength: 80,
      default: "sample_",
    },
    watermarkFont: {
      type: "string",
      description: "After Effects font or PostScript font name.",
      minLength: 1,
      default: "Helvetica",
    },
    watermarkVisibility: {
      type: "number",
      description: "Watermark visibility: 10 means 90% transparent.",
      min: 0,
      max: 100,
      default: 10,
    },
    watermarkMotion: {
      type: "enum",
      description: "The closed motion rhythm used across the frame.",
      values: ["Gentle Drift", "Vertical Rhythm", "Corner Orbit", "Static"],
      default: "Gentle Drift",
    },
    watermarkSpeed: {
      type: "enum",
      description: "How often the watermark completes its motion rhythm.",
      values: ["Slow", "Medium", "Fast"],
      default: "Slow",
    },
    outputPath: {
      type: "string",
      description: "Where to write the selected 10-bit HDR master.",
      minLength: 1,
      path: "save-file",
      suggestedExtension: "mp4",
    },
  },
  steps: [
    {
      id: "inspect-cinematic-source",
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
            required: [
              "width",
              "height",
              "frameRate",
              "durationSeconds",
              "previewDurationSeconds",
              "representativeTimeSeconds",
            ],
          },
        },
      },
    },
    {
      id: "configure-cinematic-hlg-project",
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
          intent: "cinematic-hlg-master",
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
      id: "build-cinematic-composition",
      server: "aftereffects",
      operation: "createComp",
      args: {
        name: "Conductor ${params.look} ${params.renderMode}",
        width:
          "${steps.inspect-cinematic-source.result.structuredContent.width}",
        height:
          "${steps.inspect-cinematic-source.result.structuredContent.height}",
        pixelAspect:
          "${steps.inspect-cinematic-source.result.structuredContent.pixelAspect}",
        frameRate:
          "${steps.inspect-cinematic-source.result.structuredContent.frameRate}",
        durationSeconds: {
          $select: "${params.renderMode}",
          cases: {
            Preview:
              "${steps.inspect-cinematic-source.result.structuredContent.previewDurationSeconds}",
            Full: "${steps.inspect-cinematic-source.result.structuredContent.durationSeconds}",
          },
        },
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
      id: "prepare-cinematic-source",
      server: "aftereffects",
      operation: "precompose",
      args: {
        compId:
          "${steps.build-cinematic-composition.result.structuredContent.compId}",
        name: "Cinematic Source — ${params.look}",
        sources: [
          {
            path: "${params.clip}",
            role: "source",
            startTimeSeconds: 0,
            sourceTimeSeconds: {
              $select: "${params.renderMode}",
              cases: {
                Preview:
                  "${steps.inspect-cinematic-source.result.structuredContent.representativeTimeSeconds}",
                Full: 0,
              },
            },
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
      id: "cinematic-hdr-exposure",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId: sourceLayer,
        effect: "Exposure",
        settings: {
          Exposure: {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 0,
              "Vivid HDR": 0.12,
              "Impact HDR": 0.3,
            },
          },
          Offset: 0,
          "Gamma Correction": {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 1,
              "Vivid HDR": 0.97,
              "Impact HDR": 0.9,
            },
          },
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
      id: "cinematic-hdr-levels",
      server: "aftereffects",
      operation: "applyEffect",
      args: {
        targetId: sourceLayer,
        effect: "Levels",
        settings: {
          "Input Black": {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 0,
              "Vivid HDR": 0.003,
              "Impact HDR": 0.008,
            },
          },
          "Input White": 1,
          Gamma: 1,
          "Output Black": 0,
          "Output White": 1,
          "Clip To Output Black": 1,
          "Clip To Output White": {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 1,
              "Vivid HDR": 2,
              "Impact HDR": 2,
            },
          },
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
      id: "cinematic-hdr-color",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: '${params.strength} != "Natural HDR"',
      args: {
        targetId: sourceLayer,
        effect: "Vibrance",
        settings: {
          Vibrance: {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 0,
              "Vivid HDR": 18,
              "Impact HDR": 32,
            },
          },
          Saturation: {
            $select: "${params.strength}",
            cases: {
              "Natural HDR": 0,
              "Vivid HDR": 3,
              "Impact HDR": 6,
            },
          },
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
            required: ["appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 2 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
    },
    ...lookSteps,
    {
      id: "place-project-logo",
      server: "aftereffects",
      operation: "addMediaLayer",
      precondition: "${params.logoEnabled}",
      args: {
        compId:
          "${steps.build-cinematic-composition.result.structuredContent.compId}",
        path: "${params.logoPath}",
        name: "Brand Logo",
        widthPercent: "${params.logoWidthPercent}",
        positionPreset: "${params.logoPosition}",
        customXPercent: "${params.logoXPercent}",
        customYPercent: "${params.logoYPercent}",
        opacity: "${params.logoVisibility}",
        motionBlur: false,
      },
      verify: {
        type: "object",
        required: ["structuredContent"],
        properties: {
          structuredContent: {
            type: "object",
            required: ["layerId", "widthPixels", "position", "opacity"],
          },
        },
      },
    },
    {
      id: "add-moving-watermark",
      server: "aftereffects",
      operation: "addTextLayer",
      precondition: "${params.watermarkEnabled}",
      args: {
        compId:
          "${steps.build-cinematic-composition.result.structuredContent.compId}",
        name: "Moving Username Protection",
        text: "${params.watermarkText}",
        font: "${params.watermarkFont}",
        sizePreset: "watermark",
        alignment: "center",
        position: [0, 0],
        color: "#ffffff",
        opacity: "${params.watermarkVisibility}",
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
      id: "animate-moving-watermark",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.watermarkEnabled}",
      args: {
        layerId:
          "${steps.add-moving-watermark.result.structuredContent.layerId}",
        property: "position",
        timeMode: "normalized",
        coordinateSpace: "normalized-comp",
        keyframes: {
          $select: "${params.watermarkMotion}",
          cases: {
            "Gentle Drift": {
              $select: "${params.watermarkSpeed}",
              cases: gentleMotion,
            },
            "Vertical Rhythm": {
              $select: "${params.watermarkSpeed}",
              cases: verticalMotion,
            },
            "Corner Orbit": {
              $select: "${params.watermarkSpeed}",
              cases: cornerMotion,
            },
            Static: {
              $select: "${params.watermarkSpeed}",
              cases: staticMotion,
            },
          },
        },
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.33, 0, 0.67, 1],
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
            properties: {
              applied: { type: "boolean", equals: true },
            },
          },
        },
      },
    },
    {
      id: "queue-cinematic-hlg-render",
      server: "aftereffects",
      operation: "queueRender",
      args: {
        compId:
          "${steps.build-cinematic-composition.result.structuredContent.compId}",
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
          look: "${params.look}",
          renderMode: "${params.renderMode}",
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
        "The comparison and final master share the same AE-native grade and 32-bpc HLG pipeline; Preview only changes duration and source offset.",
    },
  ],
});
