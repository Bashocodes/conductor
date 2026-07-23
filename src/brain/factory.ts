import type { BrainConfig } from "./config.js";
import {
  defaultCredentialsPath,
  loadCredentialDocument,
} from "./credentials.js";
import { BrainError } from "./errors.js";
import { ApiBrain } from "./api.js";
import { LocalBrain } from "./local.js";
import { NoneBrain } from "./none.js";
import {
  apiProviderSchema,
  type ApiProvider,
  type Brain,
} from "./types.js";
import type { FetchLike } from "./http.js";

export interface CreateBrainOptions {
  config: BrainConfig;
  override?: "api" | "local";
  env?: NodeJS.ProcessEnv;
  credentialsPath?: string;
  fetch?: FetchLike;
}

const apiKeyEnvironment: Record<ApiProvider, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
};

function firstEnvironmentValue(
  env: NodeJS.ProcessEnv,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function defaultApiEndpoint(provider: ApiProvider, model: string): string {
  if (provider === "openai") {
    return "https://api.openai.com/v1/chat/completions";
  }
  if (provider === "anthropic") {
    return "https://api.anthropic.com/v1/messages";
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export async function createBrain(
  options: CreateBrainOptions,
): Promise<Brain> {
  const kind = options.override ?? options.config.type;
  if (kind === "none") return new NoneBrain();

  const env = options.env ?? process.env;
  const credentials = await loadCredentialDocument(
    options.credentialsPath ?? defaultCredentialsPath(),
  );

  if (kind === "api") {
    const configured =
      options.config.type === "api" ? options.config : undefined;
    const rawProvider =
      env.CONDUCTOR_BRAIN_PROVIDER ??
      configured?.provider ??
      credentials.defaultProvider;
    const providerResult = apiProviderSchema.safeParse(rawProvider);
    if (!providerResult.success) {
      throw new BrainError(
        "BRAIN_CONFIG_INVALID",
        "API brain requires provider openai, anthropic, or gemini",
      );
    }
    const provider = providerResult.data;
    const stored = credentials.providers[provider];
    const model =
      env.CONDUCTOR_BRAIN_MODEL ?? configured?.model ?? stored?.model;
    if (model === undefined || model === "") {
      throw new BrainError(
        "BRAIN_CONFIG_INVALID",
        `API brain provider '${provider}' requires a model`,
      );
    }

    const apiKey =
      firstEnvironmentValue(env, apiKeyEnvironment[provider]) ??
      stored?.apiKey;
    if (apiKey === undefined) {
      throw new BrainError(
        "BRAIN_KEY_MISSING",
        `API key for brain provider '${provider}' is not configured`,
      );
    }

    const endpoint =
      env.CONDUCTOR_BRAIN_ENDPOINT ??
      configured?.endpoint ??
      stored?.endpoint ??
      defaultApiEndpoint(provider, model);

    return new ApiBrain({
      provider,
      model,
      endpoint,
      apiKey,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  const configured =
    options.config.type === "local" ? options.config : undefined;
  const model =
    env.CONDUCTOR_LOCAL_MODEL ??
    env.CONDUCTOR_BRAIN_MODEL ??
    configured?.model ??
    credentials.local?.model;
  if (model === undefined || model === "") {
    throw new BrainError(
      "BRAIN_CONFIG_INVALID",
      "Local brain requires a model",
    );
  }

  const baseUrl =
    env.CONDUCTOR_LOCAL_BASE_URL ??
    configured?.baseUrl ??
    credentials.local?.baseUrl ??
    "http://127.0.0.1:11434/v1";
  const apiKey =
    env.CONDUCTOR_LOCAL_API_KEY ?? credentials.local?.apiKey;

  return new LocalBrain({
    model,
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
