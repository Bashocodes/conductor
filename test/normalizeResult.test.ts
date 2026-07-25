import { describe, expect, it } from "vitest";

import { normalizeToolResult } from "../src/engine/normalizeResult.js";

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
});
