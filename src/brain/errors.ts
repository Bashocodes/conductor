export type BrainErrorCode =
  | "BRAIN_DISABLED"
  | "BRAIN_CONFIG_INVALID"
  | "BRAIN_KEY_MISSING"
  | "CREDENTIALS_INVALID"
  | "CREDENTIALS_PERMISSIONS"
  | "CATALOG_TOO_LARGE"
  | "HTTP_REQUEST_FAILED"
  | "INVALID_RESPONSE"
  | "RECIPE_NOT_FOUND"
  | "PROPOSAL_PARAMS_INVALID";

export class BrainError extends Error {
  public readonly code: BrainErrorCode;
  public readonly details?: unknown;

  public constructor(
    code: BrainErrorCode,
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "BrainError";
    this.code = code;
    this.details = options?.details;
  }
}
