import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const stdioServerSchema = z
  .object({
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const httpServerSchema = z
  .object({
    transport: z.literal("http"),
    url: z.url(),
  })
  .strict();

export const serverConfigSchema = z.discriminatedUnion("transport", [
  stdioServerSchema,
  httpServerSchema,
]);

export const conductorConfigSchema = z
  .object({
    servers: z.record(z.string().min(1), serverConfigSchema),
  })
  .strict();

export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type ConductorConfig = z.infer<typeof conductorConfigSchema>;

export class ConductorConfigError extends Error {
  public readonly code:
    | "CONFIG_NOT_FOUND"
    | "CONFIG_INVALID_JSON"
    | "CONFIG_INVALID";

  public readonly path: string;
  public readonly details?: unknown;

  public constructor(
    code: ConductorConfigError["code"],
    path: string,
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ConductorConfigError";
    this.code = code;
    this.path = path;
    this.details = options?.details;
  }
}

export async function loadConductorConfig(
  configPath = resolve(process.cwd(), "conductor.config.json"),
): Promise<ConductorConfig> {
  const absolutePath = resolve(configPath);
  let source: string;

  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new ConductorConfigError(
      "CONFIG_NOT_FOUND",
      absolutePath,
      `Could not read Conductor config at ${absolutePath}`,
      { cause: error },
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new ConductorConfigError(
      "CONFIG_INVALID_JSON",
      absolutePath,
      `Conductor config at ${absolutePath} is not valid JSON`,
      { cause: error },
    );
  }

  const parsed = conductorConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConductorConfigError(
      "CONFIG_INVALID",
      absolutePath,
      `Conductor config at ${absolutePath} failed validation`,
      { details: parsed.error.issues },
    );
  }

  return parsed.data;
}
