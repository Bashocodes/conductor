import { z } from "zod";

import { BrainError } from "./errors.js";
import {
  parseAndValidateProposal,
  validationFeedback,
} from "./catalog.js";
import {
  buildReviewPrompt,
  buildSuggestionPrompt,
  PROPOSAL_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
} from "./prompt.js";
import {
  brainReviewSchema,
  type ApiProvider,
  type Brain,
  type BrainHealth,
  type BrainProposal,
  type BrainSuggestRequest,
  type JournalSummary,
} from "./types.js";

export type FetchLike = typeof fetch;
type HttpProvider = ApiProvider | "openai-compatible";

export interface HttpBrainSettings {
  kind: "api" | "local";
  provider: HttpProvider;
  model: string;
  endpoint: string;
  apiKey?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

interface ShapedRequest {
  url: string;
  init: RequestInit;
}

function providerHeaders(
  provider: HttpProvider,
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (provider === "openai") {
    if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`;
  } else if (provider === "anthropic") {
    if (apiKey !== undefined) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider === "gemini") {
    if (apiKey !== undefined) headers["x-goog-api-key"] = apiKey;
  } else if (apiKey !== undefined) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export function shapeProviderRequest(
  settings: Pick<
    HttpBrainSettings,
    "provider" | "model" | "endpoint" | "apiKey"
  >,
  systemPrompt: string,
  userPrompt: string,
): ShapedRequest {
  const headers = providerHeaders(settings.provider, settings.apiKey);
  let body: unknown;

  if (
    settings.provider === "openai" ||
    settings.provider === "openai-compatible"
  ) {
    body = {
      model: settings.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...(settings.provider === "openai"
        ? { max_completion_tokens: 800 }
        : { max_tokens: 800 }),
    };
  } else if (settings.provider === "anthropic") {
    body = {
      model: settings.model,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };
  } else {
    body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 800,
      },
    };
  }

  return {
    url: settings.endpoint,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  };
}

function extractProviderText(provider: HttpProvider, input: unknown): string {
  if (input === null || typeof input !== "object") {
    throw new BrainError(
      "INVALID_RESPONSE",
      "Brain endpoint returned an invalid response envelope",
    );
  }
  const response = input as Record<string, unknown>;

  if (provider === "openai" || provider === "openai-compatible") {
    const choices = response.choices;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      first !== null && typeof first === "object"
        ? (first as Record<string, unknown>).message
        : undefined;
    const content =
      message !== null && typeof message === "object"
        ? (message as Record<string, unknown>).content
        : undefined;
    if (typeof content === "string") return content;
  } else if (provider === "anthropic") {
    const content = response.content;
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (block): block is Record<string, unknown> =>
            block !== null &&
            typeof block === "object" &&
            (block as Record<string, unknown>).type === "text",
        )
        .map((block) => block.text)
        .filter((value): value is string => typeof value === "string")
        .join("");
      if (text !== "") return text;
    }
  } else {
    const candidates = response.candidates;
    const candidate = Array.isArray(candidates) ? candidates[0] : undefined;
    const content =
      candidate !== null && typeof candidate === "object"
        ? (candidate as Record<string, unknown>).content
        : undefined;
    const parts =
      content !== null && typeof content === "object"
        ? (content as Record<string, unknown>).parts
        : undefined;
    if (Array.isArray(parts)) {
      const text = parts
        .map((part) =>
          part !== null && typeof part === "object"
            ? (part as Record<string, unknown>).text
            : undefined,
        )
        .filter((value): value is string => typeof value === "string")
        .join("");
      if (text !== "") return text;
    }
  }

  throw new BrainError(
    "INVALID_RESPONSE",
    "Brain endpoint response did not contain assistant text",
  );
}

function healthEndpoint(provider: HttpProvider, endpoint: string): string {
  const url = new URL(endpoint);
  if (provider === "gemini") {
    url.pathname = "/v1beta/models";
    url.search = "";
    return url.toString();
  }

  const versionIndex = url.pathname.indexOf("/v1/");
  url.pathname =
    versionIndex === -1
      ? `${url.pathname.replace(/\/$/, "")}/models`
      : `${url.pathname.slice(0, versionIndex)}/v1/models`;
  url.search = "";
  return url.toString();
}

export class HttpProposalBrain implements Brain {
  public readonly kind: "api" | "local";
  public readonly capabilities = {
    suggest: true,
    review: true,
  } as const;
  public readonly provenance;

  readonly #settings: Required<
    Pick<HttpBrainSettings, "provider" | "model" | "endpoint" | "timeoutMs">
  > & { apiKey?: string };
  readonly #fetch: FetchLike;

  public constructor(settings: HttpBrainSettings) {
    this.kind = settings.kind;
    this.provenance = {
      brainType: settings.kind,
      model: settings.model,
      provider: settings.provider,
    } as const;
    this.#settings = {
      provider: settings.provider,
      model: settings.model,
      endpoint: settings.endpoint,
      timeoutMs: settings.timeoutMs ?? 30_000,
      ...(settings.apiKey === undefined ? {} : { apiKey: settings.apiKey }),
    };
    this.#fetch = settings.fetch ?? fetch;
  }

  async #complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const request = shapeProviderRequest(
      this.#settings,
      systemPrompt,
      userPrompt,
    );

    let response: Response;
    try {
      response = await this.#fetch(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(this.#settings.timeoutMs),
      });
    } catch (error) {
      throw new BrainError(
        "HTTP_REQUEST_FAILED",
        `Brain endpoint request failed for provider '${this.#settings.provider}'`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new BrainError(
        "HTTP_REQUEST_FAILED",
        `Brain endpoint returned HTTP ${response.status} for provider '${this.#settings.provider}'`,
        { details: { status: response.status } },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new BrainError(
        "INVALID_RESPONSE",
        "Brain endpoint returned non-JSON HTTP data",
        { cause: error },
      );
    }

    return extractProviderText(this.#settings.provider, body);
  }

  public async suggest(
    request: BrainSuggestRequest,
  ): Promise<BrainProposal> {
    const basePrompt = buildSuggestionPrompt(request);
    let prompt = basePrompt;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.#complete(PROPOSAL_SYSTEM_PROMPT, prompt);
        return parseAndValidateProposal(raw, request.recipes);
      } catch (error) {
        if (
          error instanceof BrainError &&
          error.code !== "INVALID_RESPONSE" &&
          error.code !== "RECIPE_NOT_FOUND" &&
          error.code !== "PROPOSAL_PARAMS_INVALID"
        ) {
          throw error;
        }
        lastError = error;
        if (attempt === 0) {
          prompt = [
            basePrompt,
            `Previous response validation error: ${validationFeedback(error)}`,
            "Return one corrected JSON object.",
          ].join("\n\n");
        }
      }
    }

    throw new BrainError(
      "INVALID_RESPONSE",
      "Brain returned an invalid proposal after one retry",
      { cause: lastError },
    );
  }

  public async review(journal: JournalSummary): Promise<string> {
    const basePrompt = buildReviewPrompt(journal);
    let prompt = basePrompt;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.#complete(REVIEW_SYSTEM_PROMPT, prompt);
        const parsedJson: unknown = JSON.parse(raw);
        return brainReviewSchema.parse(parsedJson).note;
      } catch (error) {
        if (
          error instanceof BrainError &&
          error.code !== "INVALID_RESPONSE"
        ) {
          throw error;
        }
        lastError = error;
        if (attempt === 0) {
          const message =
            error instanceof z.ZodError
              ? error.issues
                  .slice(0, 5)
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .join("; ")
              : "response was not valid JSON";
          prompt = `${basePrompt}\n\nPrevious response validation error: ${message}\n\nReturn one corrected JSON object.`;
        }
      }
    }

    throw new BrainError(
      "INVALID_RESPONSE",
      "Brain returned an invalid review after one retry",
      { cause: lastError },
    );
  }

  public async checkHealth(): Promise<BrainHealth> {
    const url = healthEndpoint(
      this.#settings.provider,
      this.#settings.endpoint,
    );

    try {
      const response = await this.#fetch(url, {
        method: "GET",
        headers: providerHeaders(
          this.#settings.provider,
          this.#settings.apiKey,
        ),
        signal: AbortSignal.timeout(this.#settings.timeoutMs),
      });

      return response.ok
        ? {
            ok: true,
            message: `${this.#settings.provider} endpoint reachable`,
          }
        : {
            ok: false,
            message: `${this.#settings.provider} endpoint returned HTTP ${response.status}`,
          };
    } catch {
      return {
        ok: false,
        message: `${this.#settings.provider} endpoint unreachable`,
      };
    }
  }
}
