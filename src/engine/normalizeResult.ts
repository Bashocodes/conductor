/**
 * Gives every MCP server the same result shape.
 *
 * MCP lets a server answer in two ways. Well-behaved ones populate
 * `structuredContent` with a real object. Many — including every After Effects
 * server we have met — return only a `content` array holding a text block whose
 * text happens to be JSON.
 *
 * Recipes address results as `${steps.x.result.structuredContent.compId}`. If
 * that only worked against servers of the first kind, a recipe would not be
 * portable, which is the entire premise of keeping technique in recipe data.
 * So when a server omits `structuredContent`, synthesize it by parsing the text
 * block. The original `content` is always preserved.
 *
 * Nothing is invented: if there is no text block, or it is not JSON, or it does
 * not parse to an object, the result is passed through untouched and the
 * recipe's own `verify` block reports the mismatch.
 */

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
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeToolResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (isRecord(result.structuredContent)) return result;

  const text = firstTextBlock(result.content);
  if (text === undefined) return result;

  const parsed = parseJsonObject(text);
  if (parsed === undefined) return result;

  return { ...result, structuredContent: parsed };
}
