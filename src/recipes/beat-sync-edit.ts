import { recipeSchema } from "../schema/recipe.js";

const compId =
  "${steps.build-beat-sync-composition.result.structuredContent.compId}";
const mediaLayer =
  "${steps.place-beat-sync-media.result.structuredContent.layerId}";
const duration = "${params.planDurationSeconds}";

const baselineValue = [
  { time: 0, value: 0 },
  { time: 0.1, value: 0 },
];
const baselineScale = [
  { time: 0, value: [100, 100] },
  { time: 0.1, value: [100, 100] },
];
const baselinePosition = [
  { time: 0, value: [0.5, 0.5] },
  { time: 0.1, value: [0.5, 0.5] },
];

export const beatSyncEditRecipe = recipeSchema.parse({
  id: "beat-sync-edit",
  title: "Beat Sync Studio",
  description:
    "Builds a measured edit with a continuous onset bed, adaptive grid accents, bar-scale structure, four selectable treatments, editable markers, and verified HLG delivery.",
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
    treatment: {
      type: "enum",
      description:
        "Classic preserves the approved vocabulary; Solar, Velocity, and Signal are opt-in creative comparison treatments.",
      values: ["classic", "solar", "velocity", "signal"],
      default: "classic",
    },
    density: {
      type: "enum",
      description:
        "Requested tier density. Short edits automatically promote participation so fewer than four bars still accent every beat.",
      values: ["restrained", "active", "impact"],
      default: "active",
    },
    tempoOctave: {
      type: "enum",
      description:
        "Manual tempo correction: half, detected, or double the measured BPM.",
      values: ["half", "detected", "double"],
      default: "detected",
    },
    phaseNudge: {
      type: "number",
      description:
        "Shift the complete grid by a fraction of one resulting beat.",
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    cuts: {
      type: "boolean",
      description: "Allow cuts on the selected primary/downbeat tier.",
      default: true,
    },
    light: {
      type: "boolean",
      description:
        "Bloom only bar downbeats with the approved three-frame Glow accent.",
      default: true,
    },
    camera: {
      type: "boolean",
      description:
        "Apply the approved two-frame Directional Blur only to ordinary beats in Impact.",
      default: true,
    },
    pixelSort: {
      type: "boolean",
      description:
        "In Classic, run a low onset-strength bed with Beat Amount 40 primary accents.",
      default: true,
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
      description: "Internal: frame-quantized edit duration.",
      internal: true,
      default: 0.1,
      min: 0.001,
    },
    planAudioDurationSeconds: {
      type: "number",
      description: "Internal: analyzed score duration before edit trimming.",
      internal: true,
      default: 0.1,
      min: 0.001,
    },
    planMediaDurationSeconds: {
      type: "number",
      description: "Internal: summed selected-media duration before frame quantization.",
      internal: true,
      default: 0.1,
      min: 0.001,
    },
    planDurationLimit: {
      type: "enum",
      description: "Internal: whether media or audio ends the edit.",
      values: ["media", "audio"],
      internal: true,
      default: "media",
    },
    planEstimatedBpm: {
      type: "number",
      description: "Internal: resulting detected or manually overridden tempo.",
      internal: true,
      default: 0,
      min: 0,
    },
    planFirstDownbeatSeconds: {
      type: "number",
      description: "Internal: first resulting downbeat shown before render.",
      internal: true,
      default: 0,
      min: 0,
    },
    planTempoConfidence: {
      type: "json",
      description:
        "Internal: autocorrelation ambiguity and onset coverage for the generated tempo grid.",
      internal: true,
      default: {
        level: "low",
        score: 0,
        autocorrelation: 0,
        ambiguity: 1,
        gridCoverage: 0,
        summary: "Tempo-grid confidence is unavailable.",
      },
    },
    planBarCount: {
      type: "number",
      description: "Internal: resulting musical bars inside the edit.",
      internal: true,
      default: 0,
      min: 0,
    },
    planEffectiveDensity: {
      type: "enum",
      description: "Internal: density after short-clip participation promotion.",
      values: ["restrained", "active", "impact"],
      internal: true,
      default: "impact",
    },
    planParticipatingBeatCount: {
      type: "number",
      description: "Internal: grid events carrying a visible treatment accent.",
      internal: true,
      default: 0,
      integer: true,
      min: 0,
    },
    planTreatmentKeyCount: {
      type: "number",
      description: "Internal: selected treatment's easing key count.",
      internal: true,
      default: 0,
      integer: true,
      min: 0,
    },
    planTreatmentEasingSeconds: {
      type: "number",
      description: "Internal: estimated selected-treatment easing time.",
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
    planUseClassicPixelSort: {
      type: "boolean",
      description: "Internal: Classic Pixel Sort step gate.",
      internal: true,
      default: false,
    },
    planUseClassicGlow: {
      type: "boolean",
      description: "Internal: Classic Glow step gate.",
      internal: true,
      default: false,
    },
    planUseClassicDirectionalBlur: {
      type: "boolean",
      description: "Internal: Classic Directional Blur step gate.",
      internal: true,
      default: false,
    },
    planUseSolar: {
      type: "boolean",
      description: "Internal: Solar treatment step gate.",
      internal: true,
      default: false,
    },
    planUseVelocity: {
      type: "boolean",
      description: "Internal: Velocity treatment step gate.",
      internal: true,
      default: false,
    },
    planUseSignal: {
      type: "boolean",
      description: "Internal: Signal treatment step gate.",
      internal: true,
      default: false,
    },
    planGlowKeyframes: {
      type: "json",
      description: "Internal: downbeat-only Glow Intensity accents.",
      internal: true,
      default: baselineValue,
    },
    planPixelSortKeyframes: {
      type: "json",
      description:
        "Internal: continuous onset bed plus primary Pixel Sort accents.",
      internal: true,
      default: baselineValue,
    },
    planDirectionalBlurKeyframes: {
      type: "json",
      description:
        "Internal: ordinary-beat Directional Blur Length accents.",
      internal: true,
      default: baselineValue,
    },
    planSolarExposureKeyframes: {
      type: "json",
      description: "Internal: Solar continuous exposure bed.",
      internal: true,
      default: baselineValue,
    },
    planSolarGlowKeyframes: {
      type: "json",
      description: "Internal: Solar all-tier glow accents.",
      internal: true,
      default: baselineValue,
    },
    planSolarBurstKeyframes: {
      type: "json",
      description: "Internal: Solar final-downbeat light burst.",
      internal: true,
      default: baselineValue,
    },
    planSolarScaleKeyframes: {
      type: "json",
      description: "Internal: Solar bar-scale push and arrival.",
      internal: true,
      default: baselineScale,
    },
    planVelocityRadialBlurKeyframes: {
      type: "json",
      description: "Internal: Velocity onset bed and radial accents.",
      internal: true,
      default: baselineValue,
    },
    planVelocityDirectionalBlurKeyframes: {
      type: "json",
      description: "Internal: Velocity directional speed accents.",
      internal: true,
      default: baselineValue,
    },
    planVelocityScaleKeyframes: {
      type: "json",
      description: "Internal: Velocity bar-scale push.",
      internal: true,
      default: baselineScale,
    },
    planVelocityPositionKeyframes: {
      type: "json",
      description: "Internal: Velocity bar-scale directional drift.",
      internal: true,
      default: baselinePosition,
    },
    planSignalPixelSortKeyframes: {
      type: "json",
      description: "Internal: Signal onset bed and fracture accents.",
      internal: true,
      default: baselineValue,
    },
    planSignalPhaseKeyframes: {
      type: "json",
      description: "Internal: Signal bar-scale Pixel Sort phase.",
      internal: true,
      default: baselineValue,
    },
    planSignalRedExposureKeyframes: {
      type: "json",
      description: "Internal: Signal red-channel exposure accents.",
      internal: true,
      default: baselineValue,
    },
    planSignalBlueExposureKeyframes: {
      type: "json",
      description: "Internal: Signal blue-channel exposure accents.",
      internal: true,
      default: baselineValue,
    },
    planSignalScaleKeyframes: {
      type: "json",
      description: "Internal: Signal protective scale structure.",
      internal: true,
      default: baselineScale,
    },
    planSignalRotationKeyframes: {
      type: "json",
      description: "Internal: Signal bar-scale tilt structure.",
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
      precondition: "${params.planUseClassicPixelSort}",
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
      precondition: "${params.planUseClassicPixelSort}",
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
        "A half-beat envelope reduced from every raw onset keeps Classic alive continuously; primary peaks retain sample timing and rise to Beat Amount 40.",
    },
    {
      id: "add-beat-sync-glow",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseClassicGlow}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Glo2",
        settings: {
          "Glow Threshold": 235,
          "Glow Radius": 30,
          "Glow Intensity": 0,
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
      id: "keyframe-beat-sync-glow",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseClassicGlow}",
      args: {
        layerId:
          "${steps.add-beat-sync-glow.result.structuredContent.effectId}",
        property: "Glow Intensity",
        timeMode: "seconds",
        keyframes: "${params.planGlowKeyframes}",
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
      note:
        "The atelier soft_glow vocabulary fires only on downbeats at intensity 0.25 and releases over three delivered frames.",
    },
    {
      id: "add-beat-sync-directional-blur",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseClassicDirectionalBlur}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Motion Blur",
        settings: {
          Direction: 90,
          "Blur Length": 0,
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
              appliedParameterCount: { type: "number", equals: 2 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
    },
    {
      id: "keyframe-beat-sync-directional-blur",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseClassicDirectionalBlur}",
      args: {
        layerId:
          "${steps.add-beat-sync-directional-blur.result.structuredContent.effectId}",
        property: "Blur Length",
        timeMode: "seconds",
        keyframes: "${params.planDirectionalBlurKeyframes}",
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
      note:
        "The atelier motion_blur_dir vocabulary fires only on ordinary Impact beats at 5 px, follows vertical travel at 90 degrees, and releases over two delivered frames.",
    },
    {
      id: "keyframe-beat-sync-solar-scale",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSolar}",
      args: {
        layerId: mediaLayer,
        property: "scale",
        timeMode: "seconds",
        keyframes: "${params.planSolarScaleKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.1, 0.3, 1],
        },
        motionBlur: true,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "Solar Ascension pushes from 104% through a bar-by-bar build and makes a visible 118% arrival on the final downbeat.",
    },
    {
      id: "add-beat-sync-solar-exposure",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseSolar}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Exposure2",
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
      id: "keyframe-beat-sync-solar-exposure",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSolar}",
      args: {
        layerId:
          "${steps.add-beat-sync-solar-exposure.result.structuredContent.effectId}",
        property: "Exposure",
        timeMode: "seconds",
        keyframes: "${params.planSolarExposureKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "Every raw onset contributes to a half-beat exposure bed, with a restrained bar-scale lift toward the arrival.",
    },
    {
      id: "add-beat-sync-solar-glow",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseSolar}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Glo2",
        settings: {
          "Glow Threshold": 230,
          "Glow Radius": 45,
          "Glow Intensity": 0,
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
      id: "keyframe-beat-sync-solar-glow",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSolar}",
      args: {
        layerId:
          "${steps.add-beat-sync-solar-glow.result.structuredContent.effectId}",
        property: "Glow Intensity",
        timeMode: "seconds",
        keyframes: "${params.planSolarGlowKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
    },
    {
      id: "add-beat-sync-solar-burst",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseSolar}",
      args: {
        targetId: mediaLayer,
        effect: "CC Light Burst 2.5",
        settings: {
          Intensity: 100,
          "Ray Length": 0,
          Burst: 2,
          "Halo Alpha": 0,
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
              appliedParameterCount: { type: "number", equals: 4 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
    },
    {
      id: "keyframe-beat-sync-solar-burst",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSolar}",
      args: {
        layerId:
          "${steps.add-beat-sync-solar-burst.result.structuredContent.effectId}",
        property: "Ray Length",
        timeMode: "seconds",
        keyframes: "${params.planSolarBurstKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.16, 1, 0.3, 1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "The final downbeat is an authored arrival, not another identical bar: Ray Length rises from a truly neutral zero to 110 over the push.",
    },
    {
      id: "keyframe-beat-sync-velocity-scale",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseVelocity}",
      args: {
        layerId: mediaLayer,
        property: "scale",
        timeMode: "seconds",
        keyframes: "${params.planVelocityScaleKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.1, 0.3, 1],
        },
        motionBlur: true,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "Velocity Arc builds through the bars and lands a bold 128% push on the final downbeat.",
    },
    {
      id: "keyframe-beat-sync-velocity-position",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseVelocity}",
      args: {
        layerId: mediaLayer,
        property: "position",
        timeMode: "seconds",
        coordinateSpace: "normalized-comp",
        keyframes: "${params.planVelocityPositionKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: true,
      },
      verify: { type: "object", required: ["structuredContent"] },
    },
    {
      id: "add-beat-sync-velocity-radial-blur",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseVelocity}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Radial Blur",
        settings: {
          Amount: 0,
          Type: 2,
          "Antialiasing (Best Quality)": 2,
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
      id: "keyframe-beat-sync-velocity-radial-blur",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseVelocity}",
      args: {
        layerId:
          "${steps.add-beat-sync-velocity-radial-blur.result.structuredContent.effectId}",
        property: "Amount",
        timeMode: "seconds",
        keyframes: "${params.planVelocityRadialBlurKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "The raw-onset half-beat bed keeps radial zoom energy between grid hits; all short-clip tiers receive stronger speed accents.",
    },
    {
      id: "add-beat-sync-velocity-directional-blur",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseVelocity}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Motion Blur",
        settings: {
          Direction: 90,
          "Blur Length": 0,
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
    {
      id: "keyframe-beat-sync-velocity-directional-blur",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseVelocity}",
      args: {
        layerId:
          "${steps.add-beat-sync-velocity-directional-blur.result.structuredContent.effectId}",
        property: "Blur Length",
        timeMode: "seconds",
        keyframes: "${params.planVelocityDirectionalBlurKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
    },
    {
      id: "keyframe-beat-sync-signal-scale",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSignal}",
      args: {
        layerId: mediaLayer,
        property: "scale",
        timeMode: "seconds",
        keyframes: "${params.planSignalScaleKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.1, 0.3, 1],
        },
        motionBlur: true,
      },
      verify: { type: "object", required: ["structuredContent"] },
    },
    {
      id: "keyframe-beat-sync-signal-rotation",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSignal}",
      args: {
        layerId: mediaLayer,
        property: "rotation",
        timeMode: "seconds",
        keyframes: "${params.planSignalRotationKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "overshoot-settle",
          controlPoints: [0.16, 1.1, 0.3, 1],
        },
        motionBlur: true,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "Signal Break changes tilt by bar and hits a conspicuous six-degree final fracture while protective scale prevents empty edges.",
    },
    {
      id: "add-beat-sync-signal-pixel-sort",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseSignal}",
      args: {
        targetId: mediaLayer,
        effect: "director-pixel-sort",
        settings: {
          Intensity: 75,
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
            required: ["appliedParameterCount", "refusedParameters"],
            properties: {
              appliedParameterCount: { type: "number", equals: 4 },
              refusedParameters: { type: "array", equals: [] },
            },
          },
        },
      },
    },
    {
      id: "keyframe-beat-sync-signal-pixel-sort",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSignal}",
      args: {
        layerId:
          "${steps.add-beat-sync-signal-pixel-sort.result.structuredContent.effectId}",
        property: "Beat Amount",
        timeMode: "seconds",
        keyframes: "${params.planSignalPixelSortKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "Signal Break restores Pixel Sort as a continuous full-onset bed and pushes every short-clip tier into a visible fracture.",
    },
    {
      id: "keyframe-beat-sync-signal-phase",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSignal}",
      args: {
        layerId:
          "${steps.add-beat-sync-signal-pixel-sort.result.structuredContent.effectId}",
        property: "Phase",
        timeMode: "seconds",
        keyframes: "${params.planSignalPhaseKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "gentle-exit",
          controlPoints: [0.4, 0, 0.7, 1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
    },
    {
      id: "add-beat-sync-signal-channel-split",
      server: "aftereffects",
      operation: "applyEffect",
      precondition: "${params.planUseSignal}",
      args: {
        targetId: mediaLayer,
        effect: "ADBE Exposure2",
        settings: {
          "Red Exposure": 0,
          "Blue Exposure": 0,
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
    {
      id: "keyframe-beat-sync-signal-red",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSignal}",
      args: {
        layerId:
          "${steps.add-beat-sync-signal-channel-split.result.structuredContent.effectId}",
        property: "Red Exposure",
        timeMode: "seconds",
        keyframes: "${params.planSignalRedExposureKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
    },
    {
      id: "keyframe-beat-sync-signal-blue",
      server: "aftereffects",
      operation: "setKeyframes",
      precondition: "${params.planUseSignal}",
      args: {
        layerId:
          "${steps.add-beat-sync-signal-channel-split.result.structuredContent.effectId}",
        property: "Blue Exposure",
        timeMode: "seconds",
        keyframes: "${params.planSignalBlueExposureKeyframes}",
        easing: {
          type: "cubic-bezier",
          profile: "controlled-peak",
          controlPoints: [0.2, 0.9, 0.8, 0.1],
        },
        motionBlur: false,
      },
      verify: { type: "object", required: ["structuredContent"] },
      note:
        "Opposed red/blue exposure pulses add chromatic fracture without geometry warping, overlays, or a checkered texture.",
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
          treatment: "${params.treatment}",
          barCount: "${params.planBarCount}",
          effectiveDensity: "${params.planEffectiveDensity}",
          participatingBeatCount: "${params.planParticipatingBeatCount}",
          treatmentKeyCount: "${params.planTreatmentKeyCount}",
          treatmentEasingSeconds: "${params.planTreatmentEasingSeconds}",
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
