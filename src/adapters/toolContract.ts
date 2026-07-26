import { z } from "zod";

import { jsonValueSchema } from "../schema/json.js";

export const toolOperationSchema = z.enum([
  "createComp",
  "addTextLayer",
  "addMediaLayer",
  "setKeyframes",
  "applyEffect",
  "precompose",
  "queueRender",
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

const addTextLayerArgsSchema = z
  .object({
    compId: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    font: z.string().min(1),
    sizePreset: z.enum(["watermark", "small", "medium", "large"]),
    alignment: z.enum(["left", "center", "right"]),
    position: z.tuple([z.number().finite(), z.number().finite()]),
    color: z.string().min(1),
    opacity: z.number().min(0).max(100).default(100),
    motionBlur: z.boolean(),
  })
  .strict();

const addMediaLayerArgsSchema = z
  .object({
    compId: z.string().min(1),
    path: z.string().min(1),
    name: z.string().min(1),
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
  })
  .strict();

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

const projectInfoArgsSchema = z
  .object({
    action: z.enum(["inspect", "configure"]),
    mediaPath: z.string().min(1).optional(),
    settings: z.record(z.string(), jsonValueSchema).default({}),
  })
  .strict();

export const toolArgsSchemas = {
  createComp: createCompArgsSchema,
  addTextLayer: addTextLayerArgsSchema,
  addMediaLayer: addMediaLayerArgsSchema,
  setKeyframes: setKeyframesArgsSchema,
  applyEffect: applyEffectArgsSchema,
  precompose: precomposeArgsSchema,
  queueRender: queueRenderArgsSchema,
  projectInfo: projectInfoArgsSchema,
} as const satisfies Record<ToolOperation, z.ZodTypeAny>;

export interface ToolContract {
  createComp: {
    args: z.infer<typeof createCompArgsSchema>;
    result: { compId: string };
  };
  addTextLayer: {
    args: z.infer<typeof addTextLayerArgsSchema>;
    result: { layerId: string };
  };
  addMediaLayer: {
    args: z.infer<typeof addMediaLayerArgsSchema>;
    result: { layerId: string };
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
