import { z } from "zod";

import { jsonValueSchema } from "../schema/json.js";

export const toolOperationSchema = z.enum([
  "createComp",
  "addMarkers",
  "addTextLayer",
  "addMediaLayer",
  "setKeyframes",
  "applyEffect",
  "precompose",
  "queueRender",
  "saveFrame",
  "projectInfo",
]);

export type ToolOperation = z.infer<typeof toolOperationSchema>;

export const easingSchema = z
  .object({
    type: z.literal("cubic-bezier"),
    profile: z.enum([
      "overshoot-settle",
      "gentle-exit",
      "controlled-peak",
      "directional-wipe",
      "whip-acceleration",
      "whip-deceleration",
    ]),
    controlPoints: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  })
  .strict();

export type Easing = z.infer<typeof easingSchema>;

const createCompArgsSchema = z
  .object({
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    pixelAspect: z.number().positive(),
    frameRate: z.number().positive(),
    durationSeconds: z.number().positive(),
    backgroundColor: z.string().min(1),
  })
  .strict();

const addMarkersArgsSchema = z
  .object({
    targetId: z.string().min(1),
    markers: z
      .array(
        z
          .object({
            timeSeconds: z.number().finite().nonnegative(),
            comment: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const addTextLayerArgsSchema = z
  .object({
    compId: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    font: z.string().min(1),
    sizePreset: z.enum(["watermark", "small", "medium", "large"]),
    /**
     * An exact size, as a percentage of the composition's height, which wins
     * over the preset when present. A preset cannot answer "a little smaller
     * than that", and type sized in pixels does not survive a change of frame.
     */
    sizePercent: z.number().positive().max(50).optional(),
    alignment: z.enum(["left", "center", "right"]),
    position: z.tuple([z.number().finite(), z.number().finite()]),
    color: z.string().min(1),
    opacity: z.number().min(0).max(100).default(100),
    motionBlur: z.boolean(),
  })
  .strict();

const mediaPositionSchema = {
  widthPercent: z.number().positive().max(100),
  positionPreset: z.enum([
    "Top Right",
    "Top Left",
    "Bottom Right",
    "Bottom Left",
    "Custom",
  ]),
  customXPercent: z.number().min(0).max(100),
  customYPercent: z.number().min(0).max(100),
  opacity: z.number().min(0).max(100),
  motionBlur: z.boolean(),
} as const;

const singleMediaLayerArgsSchema = z
  .object({
    compId: z.string().min(1),
    path: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["visual", "audio"]).default("visual"),
    timelineInSeconds: z.number().nonnegative().default(0),
    timelineOutSeconds: z.number().positive().optional(),
    sourceInSeconds: z.number().nonnegative().default(0),
    ...mediaPositionSchema,
  })
  .strict();

const mediaSegmentSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    timelineInSeconds: z.number().nonnegative(),
    timelineOutSeconds: z.number().positive(),
    sourceInSeconds: z.number().nonnegative().default(0),
    cutFrame: z.number().int().nonnegative().optional(),
    intendedOnsetSeconds: z.number().nonnegative().optional(),
  })
  .strict()
  .refine(
    (segment) => segment.timelineOutSeconds > segment.timelineInSeconds,
    { message: "timelineOutSeconds must be after timelineInSeconds" },
  );

const batchMediaLayerArgsSchema = z
  .object({
    compId: z.string().min(1),
    name: z.string().min(1),
    segments: z.array(mediaSegmentSchema).min(1),
    ...mediaPositionSchema,
  })
  .strict();

const addMediaLayerArgsSchema = z.union([
  singleMediaLayerArgsSchema,
  batchMediaLayerArgsSchema,
]);

const setKeyframesArgsSchema = z
  .object({
    layerId: z.string().min(1),
    property: z.string().min(1),
    timeMode: z.enum(["seconds", "normalized"]),
    coordinateSpace: z.enum(["pixels", "normalized-comp"]).optional(),
    keyframes: z
      .array(
        z
          .object({
            time: z.number().finite(),
            value: jsonValueSchema,
          })
          .strict(),
      )
      .min(2),
    easing: easingSchema,
    motionBlur: z.boolean(),
  })
  .strict();

const applyEffectArgsSchema = z
  .object({
    targetId: z.string().min(1),
    effect: z.string().min(1),
    settings: z.record(z.string(), jsonValueSchema),
    atTimeSeconds: z.number().nonnegative(),
    durationSeconds: z.number().positive(),
  })
  .strict();

const sourceSchema = z
  .object({
    path: z.string().min(1),
    role: z.string().min(1),
    startTimeSeconds: z.number().nonnegative(),
    sourceTimeSeconds: z.number().nonnegative().default(0),
  })
  .strict();

const precomposeArgsSchema = z
  .object({
    compId: z.string().min(1),
    name: z.string().min(1),
    sources: z.array(sourceSchema),
    layerIds: z.array(z.string()),
    collapseTransformations: z.boolean(),
    motionBlur: z.boolean(),
  })
  .strict();

const queueRenderArgsSchema = z
  .object({
    compId: z.string().min(1),
    outputPath: z.string().min(1),
    format: z.string().min(1),
    codec: z.string().min(1),
    bitDepth: z.number().int().positive(),
    colorSpace: z.string().min(1),
    outputModuleTemplate: z.string().min(1).optional(),
    postProcess: z.enum(["hevc-hlg"]).optional(),
    renderSettings: z.record(z.string(), jsonValueSchema),
  })
  .strict();

/**
 * A single frame, written straight from the open session.
 *
 * `CompItem.saveFrameToPng` renders one frame in milliseconds without the
 * render queue and without launching `aerender`, which is the whole cost of a
 * moving sample. That makes a look comparison something you watch appear
 * rather than something you wait out.
 */
const saveFrameArgsSchema = z
  .object({
    compId: z.string().min(1),
    timeSeconds: z.number().nonnegative(),
    outputPath: z.string().min(1),
    /**
     * Removes the composition — and any precompositions it alone used — once
     * the frame is written. A sample is scaffolding; leaving eight of them in
     * someone's project every time they compare looks is not acceptable.
     */
    disposeComp: z.boolean().default(false),
  })
  .strict();

const projectInfoArgsSchema = z
  .object({
    action: z.enum(["inspect", "configure"]),
    mediaPath: z.string().min(1).optional(),
    settings: z.record(z.string(), jsonValueSchema).default({}),
  })
  .strict();

export const toolArgsSchemas = {
  createComp: createCompArgsSchema,
  addMarkers: addMarkersArgsSchema,
  addTextLayer: addTextLayerArgsSchema,
  addMediaLayer: addMediaLayerArgsSchema,
  setKeyframes: setKeyframesArgsSchema,
  applyEffect: applyEffectArgsSchema,
  precompose: precomposeArgsSchema,
  queueRender: queueRenderArgsSchema,
  saveFrame: saveFrameArgsSchema,
  projectInfo: projectInfoArgsSchema,
} as const satisfies Record<ToolOperation, z.ZodTypeAny>;

export interface ToolContract {
  createComp: {
    args: z.infer<typeof createCompArgsSchema>;
    result: { compId: string };
  };
  addMarkers: {
    args: z.infer<typeof addMarkersArgsSchema>;
    result: {
      applied: boolean;
      targetId: string;
      markerCount: number;
      markers: Array<{ timeSeconds: number; comment: string }>;
    };
  };
  addTextLayer: {
    args: z.infer<typeof addTextLayerArgsSchema>;
    result: { layerId: string };
  };
  addMediaLayer: {
    args: z.infer<typeof addMediaLayerArgsSchema>;
    result: {
      layerId: string;
      placements?: Array<{
        layerId: string;
        path: string;
        actualTimeSeconds: number;
        actualFrame: number;
        cutFrame?: number;
        intendedOnsetSeconds?: number;
      }>;
    };
  };
  setKeyframes: {
    args: z.infer<typeof setKeyframesArgsSchema>;
    result: { applied: boolean };
  };
  applyEffect: {
    args: z.infer<typeof applyEffectArgsSchema>;
    result: { effectId: string };
  };
  precompose: {
    args: z.infer<typeof precomposeArgsSchema>;
    result: { layerId: string; precompId: string };
  };
  queueRender: {
    args: z.infer<typeof queueRenderArgsSchema>;
    result: {
      queued: boolean;
      outputPath: string;
      renderPath?: string;
      renderQueueIndex?: number;
      postProcess?: "hevc-hlg";
    };
  };
  saveFrame: {
    args: z.infer<typeof saveFrameArgsSchema>;
    result: { saved: boolean; outputPath: string };
  };
  projectInfo: {
    args: z.infer<typeof projectInfoArgsSchema>;
    result: Record<string, unknown>;
  };
}

export type ToolArgs<Operation extends ToolOperation> =
  ToolContract[Operation]["args"];

export function parseToolArgs<Operation extends ToolOperation>(
  operation: Operation,
  args: unknown,
): ToolArgs<Operation> {
  return toolArgsSchemas[operation].parse(args) as ToolArgs<Operation>;
}
