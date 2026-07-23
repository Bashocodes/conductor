import { z } from "zod";

import { apiProviderSchema } from "./types.js";

const noneBrainConfigSchema = z
  .object({
    type: z.literal("none"),
  })
  .strict();

const apiBrainConfigSchema = z
  .object({
    type: z.literal("api"),
    provider: apiProviderSchema.optional(),
    model: z.string().min(1).optional(),
    endpoint: z.url().optional(),
  })
  .strict();

const localBrainConfigSchema = z
  .object({
    type: z.literal("local"),
    model: z.string().min(1).optional(),
    baseUrl: z.url().optional(),
  })
  .strict();

export const brainConfigSchema = z.discriminatedUnion("type", [
  noneBrainConfigSchema,
  apiBrainConfigSchema,
  localBrainConfigSchema,
]);

export type BrainConfig = z.infer<typeof brainConfigSchema>;
