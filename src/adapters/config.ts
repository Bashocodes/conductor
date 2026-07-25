import { z } from "zod";

import { jsonValueSchema } from "../schema/json.js";
import { toolOperationSchema } from "./toolContract.js";

export const operationMappingSchema = z
  .object({
    tool: z.string().min(1),
    argsTemplate: jsonValueSchema,
  })
  .strict();

export const declarativeAdapterConfigSchema = z
  .object({
    /** Optional so configs written before script adapters existed keep working. */
    kind: z.literal("declarative").default("declarative"),
    id: z.string().min(1),
    label: z.string().min(1),
    operations: z.partialRecord(toolOperationSchema, operationMappingSchema),
  })
  .strict();

/**
 * For servers whose entire surface is one "run this script" tool. The operation
 * is expressed as a generated program rather than as an argument mapping, so
 * there is nothing per-operation to configure.
 */
export const scriptAdapterConfigSchema = z
  .object({
    kind: z.literal("script"),
    id: z.string().min(1),
    label: z.string().min(1),
    /** The script dialect to generate. Only After Effects is supported today. */
    dialect: z.literal("extendscript-ae"),
    tool: z.string().min(1),
    scriptArgument: z.string().min(1).default("script_string"),
  })
  .strict();

export const adapterConfigSchema = z.union([
  scriptAdapterConfigSchema,
  declarativeAdapterConfigSchema,
]);

export type DeclarativeAdapterConfig = z.infer<typeof declarativeAdapterConfigSchema>;
export type ScriptAdapterConfig = z.infer<typeof scriptAdapterConfigSchema>;
export type AdapterConfig = z.infer<typeof adapterConfigSchema>;
