export type EngineErrorCode =
  | "INVALID_RECIPE"
  | "INVALID_PARAMS"
  | "INTERPOLATION_FAILED"
  | "PRECONDITION_INVALID"
  | "VERIFY_FAILED"
  | "STEP_FAILED"
  | "JOURNAL_WRITE_FAILED";

export class ConductorEngineError extends Error {
  public readonly code: EngineErrorCode;
  public readonly details?: unknown;

  public constructor(
    code: EngineErrorCode,
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ConductorEngineError";
    this.code = code;
    this.details = options?.details;
  }
}
