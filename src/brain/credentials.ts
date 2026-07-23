import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { z } from "zod";

import { apiProviderSchema } from "./types.js";
import { BrainError } from "./errors.js";

const providerCredentialSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    endpoint: z.url().optional(),
  })
  .strict();

const localCredentialSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    baseUrl: z.url().optional(),
  })
  .strict();

const credentialDocumentSchema = z
  .object({
    defaultProvider: apiProviderSchema.optional(),
    providers: z
      .partialRecord(apiProviderSchema, providerCredentialSchema)
      .default({}),
    local: localCredentialSchema.optional(),
  })
  .strict();

export type CredentialDocument = z.infer<typeof credentialDocumentSchema>;

export function defaultCredentialsPath(): string {
  return resolve(homedir(), ".conductor", "credentials.json");
}

export async function loadCredentialDocument(
  path = defaultCredentialsPath(),
): Promise<CredentialDocument> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return credentialDocumentSchema.parse({});
    }
    throw new BrainError(
      "CREDENTIALS_INVALID",
      `Could not inspect brain credentials at ${path}`,
      { cause: error },
    );
  }

  if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600) {
    throw new BrainError(
      "CREDENTIALS_PERMISSIONS",
      `Brain credentials at ${path} must have mode 600`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new BrainError(
      "CREDENTIALS_INVALID",
      `Brain credentials at ${path} are not valid JSON`,
      { cause: error },
    );
  }

  const parsed = credentialDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new BrainError(
      "CREDENTIALS_INVALID",
      `Brain credentials at ${path} failed validation`,
      {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  return parsed.data;
}
