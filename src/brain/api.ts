import {
  HttpProposalBrain,
  type FetchLike,
} from "./http.js";
import type { ApiProvider } from "./types.js";

export interface ApiBrainOptions {
  provider: ApiProvider;
  model: string;
  endpoint: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class ApiBrain extends HttpProposalBrain {
  public constructor(options: ApiBrainOptions) {
    super({
      kind: "api",
      provider: options.provider,
      model: options.model,
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
  }
}
