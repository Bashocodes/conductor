import {
  HttpProposalBrain,
  type FetchLike,
} from "./http.js";

export interface LocalBrainOptions {
  model: string;
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

export class LocalBrain extends HttpProposalBrain {
  public constructor(options: LocalBrainOptions) {
    super({
      kind: "local",
      provider: "openai-compatible",
      model: options.model,
      endpoint: chatCompletionsEndpoint(options.baseUrl),
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
  }
}
