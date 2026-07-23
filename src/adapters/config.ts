import { z } from "zod";

import { jsonValueSchema } from "../schema/json.js";
import { toolOperationSchema } from "./toolContract.js";

export const operationMappingSchema = z
  .object({
    tool: z.string().min(1),
    argsTemplate: jsonValueSchema,
  })
  .strict();

export const adapterConfigSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    operations: z.partialRecord(toolOperationSchema, operationMappingSchema),
  })
  .strict();

export type AdapterConfig = z.infer<typeof adapterConfigSchema>;
