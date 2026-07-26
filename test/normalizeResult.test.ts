import { describe, expect, it } from "vitest";

import { findHostError, normalizeToolResult } from "../src/engine/normalizeResult.js";

/** The exact double envelope a live After Effects MCP server returned. */
function aeEnvelope(payload: unknown, status = "SUCCESS") {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          senderId: "abc123",
          response: { content: [{ type: "text", text: JSON.stringify(payload) }] },
          status,
          projectInfo: { numItems: 9, projectName: "Demo.aep" },
        }),
      },
    ],
    isError: false,
  };
}

describe("normalizeToolResult", () => {
  it("synthesizes structuredContent from a JSON text block", () => {
    /*
     * The exact shape a live After Effects MCP server returned on 2026-07-25.
     * Without this, every recipe reference to
     * ${steps.x.result.structuredContent.compId} would resolve to nothing and
     * the step's own verify block would fail.
     */
    const raw = {
      content: [{ type: "text", text: '{\n  "compId": "27",\n  "name": "Demo"\n}' }],
    };
    const normalized = normalizeToolResult(raw) as {
      structuredContent: { compId: string; name: string };
      content: unknown[];
    };
    expect(normalized.structuredContent).toEqual({ compId: "27", name: "Demo" });
    // The original content is never discarded.
    expect(normalized.content).toBe(raw.content);
  });

  it("leaves a server that already returns structuredContent alone", () => {
    const raw = {
      structuredContent: { compId: "9" },
      content: [{ type: "text", text: '{"compId":"ignored"}' }],
    };
    expect(normalizeToolResult(raw)).toBe(raw);
  });

  it("passes prose through untouched rather than guessing", () => {
    const raw = { content: [{ type: "text", text: "Rendered the composition." }] };
    expect(normalizeToolResult(raw)).toBe(raw);
  });

  it("passes malformed JSON through so verify reports it honestly", () => {
    const raw = { content: [{ type: "text", text: '{"compId": ' }] };
    expect(normalizeToolResult(raw)).toBe(raw);
  });

  it("ignores a JSON array, which cannot answer a property reference", () => {
    const raw = { content: [{ type: "text", text: "[1,2,3]" }] };
    expect(normalizeToolResult(raw)).toBe(raw);
  });

  it("skips non-text blocks to find the first text block", () => {
    const raw = {
      content: [
        { type: "image", data: "..." },
        { type: "text", text: '{"ok":true}' },
      ],
    };
    const normalized = normalizeToolResult(raw) as { structuredContent: { ok: boolean } };
    expect(normalized.structuredContent).toEqual({ ok: true });
  });

  it("handles results that are not objects at all", () => {
    expect(normalizeToolResult(null)).toBeNull();
    expect(normalizeToolResult("text")).toBe("text");
    expect(normalizeToolResult(42)).toBe(42);
  });

  it("leaves a result with no content array alone", () => {
    const raw = { isError: false };
    expect(normalizeToolResult(raw)).toBe(raw);
  });

  it("peels the double envelope a script-execution server wraps around its payload", () => {
    /*
     * Live-observed 2026-07-25: the payload the script returned sits two
     * envelopes deep. Unwrapping only the outer one produced a
     * structuredContent of { senderId, response, status, projectInfo } — no
     * compId — and every recipe reference resolved to nothing.
     */
    const normalized = normalizeToolResult(
      aeEnvelope({ compId: "40", name: "Conductor Title Card", width: 1920 }),
    ) as { structuredContent: Record<string, unknown> };
    expect(normalized.structuredContent).toEqual({
      compId: "40",
      name: "Conductor Title Card",
      width: 1920,
    });
  });

  it("stops at the outermost payload when there is no deeper envelope", () => {
    const normalized = normalizeToolResult({
      content: [{ type: "text", text: '{"compId":"7"}' }],
    }) as { structuredContent: Record<string, unknown> };
    expect(normalized.structuredContent).toEqual({ compId: "7" });
  });

  it("does not descend into a response that is not an envelope", () => {
    const normalized = normalizeToolResult({
      content: [{ type: "text", text: '{"response":"queued","ok":true}' }],
    }) as { structuredContent: Record<string, unknown> };
    expect(normalized.structuredContent).toEqual({ response: "queued", ok: true });
  });
});

describe("findHostError", () => {
  it("catches a script failure the transport reported as a success", () => {
    /*
     * The failure mode that matters most. After Effects answered
     * status "SUCCESS" and MCP isError false for a script that threw; only the
     * innermost payload said otherwise. Without this the journal would record
     * a step as succeeded while nothing happened in the application.
     */
    const normalized = normalizeToolResult(
      aeEnvelope({ error: "TypeError: null is not an object", line: 5 }),
    );
    expect(findHostError(normalized)).toEqual({
      message: "TypeError: null is not an object",
      line: 5,
    });
  });

  it("reports an error with no line number", () => {
    const normalized = normalizeToolResult(aeEnvelope({ error: "Something broke" }));
    expect(findHostError(normalized)).toEqual({ message: "Something broke" });
  });

  it("stays quiet for a healthy payload", () => {
    const normalized = normalizeToolResult(aeEnvelope({ compId: "40" }));
    expect(findHostError(normalized)).toBeUndefined();
  });

  it("ignores an empty or non-string error field", () => {
    expect(findHostError({ structuredContent: { error: "" } })).toBeUndefined();
    expect(findHostError({ structuredContent: { error: 500 } })).toBeUndefined();
  });

  it("handles values that are not results", () => {
    expect(findHostError(null)).toBeUndefined();
    expect(findHostError("text")).toBeUndefined();
  });
});
