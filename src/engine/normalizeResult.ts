/**
 * Gives every MCP server the same result shape, and refuses to let a failure
 * masquerade as a success.
 *
 * MCP lets a server answer in two ways. Well-behaved ones populate
 * `structuredContent` with a real object. Many — including every After Effects
 * server we have met — return only a `content` array holding a text block whose
 * text happens to be JSON.
 *
 * Worse, script-execution servers usually sit behind a transport of their own,
 * so the payload arrives wrapped more than once. A live After Effects server
 * observed on 2026-07-25 returned:
 *
 *   { content: [ { type: "text", text: JSON.stringify({
 *       senderId, status: "SUCCESS",
 *       response: { content: [ { type: "text", text: JSON.stringify(payload) } ] }
 *     }) } ] }
 *
 * Recipes address results as `${steps.x.result.structuredContent.compId}`. For
 * that to be portable, the envelopes have to be peeled until the payload the
 * script actually returned is reached.
 *
 * Nothing is invented: anything that is not unambiguously an envelope is passed
 * through untouched, and the recipe's own `verify` block reports the mismatch.
 */

/** Envelopes are shallow in practice; the bound stops a malformed cycle. */
const MAX_ENVELOPE_DEPTH = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first text block in an MCP content array, if there is one. */
function firstTextBlock(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  // Cheap guard so ordinary prose never reaches the parser.
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Descends through nested `{ response: { content: [text] } }` envelopes until
 * the innermost JSON payload is reached.
 */
function unwrapEnvelopes(value: Record<string, unknown>): Record<string, unknown> {
  let current = value;
  for (let depth = 0; depth < MAX_ENVELOPE_DEPTH; depth += 1) {
    const inner = isRecord(current.response) ? current.response : undefined;
    if (inner === undefined) return current;
    const text = firstTextBlock(inner.content);
    if (text === undefined) return current;
    const parsed = parseJsonObject(text);
    if (parsed === undefined) return current;
    current = parsed;
  }
  return current;
}

export function normalizeToolResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (isRecord(result.structuredContent)) return result;

  const text = firstTextBlock(result.content);
  if (text === undefined) return result;

  const parsed = parseJsonObject(text);
  if (parsed === undefined) return result;

  return { ...result, structuredContent: unwrapEnvelopes(parsed) };
}

/**
 * Finds a host-reported script failure hiding inside a successful response.
 *
 * After Effects servers execute a script and report transport success even when
 * the script threw: `status` stays "SUCCESS", MCP's `isError` stays false, and
 * the failure appears only as `{ error, line }` in the innermost payload.
 * Without this check a recipe step would be recorded as succeeded while nothing
 * happened in the application — the worst failure mode an automation tool has,
 * because the journal would lie about it.
 */
export function findHostError(
  normalized: unknown,
): { message: string; line?: number } | undefined {
  if (!isRecord(normalized)) return undefined;
  const payload = isRecord(normalized.structuredContent)
    ? normalized.structuredContent
    : normalized;
  if (typeof payload.error !== "string" || payload.error.length === 0) {
    return undefined;
  }
  return {
    message: payload.error,
    ...(typeof payload.line === "number" ? { line: payload.line } : {}),
  };
}
