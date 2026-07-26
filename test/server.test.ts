import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startConductorServer } from "../src/server/serve.js";

/**
 * Exercises the local control panel over real HTTP. Endpoints that would reach
 * After Effects are not covered here — those are verified against a live host.
 */

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function serve(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "conductor-serve-"));
  const configPath = join(directory, "conductor.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      brain: { type: "none" },
      servers: {
        aftereffects: { transport: "stdio", command: "/usr/bin/false", args: [] },
      },
    }),
  );
  // Port 0 asks the OS for a free port so tests never collide.
  const server = await startConductorServer({ configPath, port: 0 });
  stop = server.close;
  return server.url;
}

describe("conductor ui server", () => {
  it("binds to loopback only", async () => {
    const url = await serve();
    // This process starts local programs and drives creative applications, so
    // it must never be reachable from another machine.
    expect(url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("serves a self-contained console with no external references", async () => {
    const url = await serve();
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("<title>Conductor</title>");
    // No CDN fonts, scripts, or styles: the page must work with no network.
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\//);
  });

  it("refuses to be framed and disables MIME sniffing", async () => {
    const url = await serve();
    const response = await fetch(url);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lists every recipe with its parameters so the form can build itself", async () => {
    const url = await serve();
    const body = (await (await fetch(`${url}api/recipes`)).json()) as {
      recipes: Array<{ id: string; title: string; params: Record<string, unknown> }>;
    };
    const ids = body.recipes.map((recipe) => recipe.id);
    expect(ids).toContain("title-card");
    expect(ids).toContain("motivated-transition");
    expect(ids).toContain("hdr-safe-grade");
    const titleCard = body.recipes.find((recipe) => recipe.id === "title-card");
    expect(Object.keys(titleCard?.params ?? {})).toContain("outputPath");
  });

  it("plans a dry run without connecting to anything", async () => {
    const url = await serve();
    // The configured server command is /usr/bin/false; if a dry run connected,
    // this would fail rather than return a plan.
    const response = await fetch(`${url}api/dry-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: "title-card", params: { outputPath: "/tmp/a.mov" } }),
    });
    expect(response.status).toBe(200);
    const plan = (await response.json()) as { steps: Array<{ contractArgs: unknown }> };
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.contractArgs).toBeDefined();
  });

  it("rejects an unknown recipe rather than guessing", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/dry-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: "nope", params: {} }),
    });
    expect(response.status).toBe(400);
  });

  it("reports an unreachable host instead of throwing", async () => {
    const url = await serve();
    const report = (await (await fetch(`${url}api/doctor`)).json()) as {
      ok: boolean;
      detail?: string;
    };
    expect(report.ok).toBe(false);
    expect(typeof report.detail).toBe("string");
  });

  it("404s an unknown path", async () => {
    const url = await serve();
    expect((await fetch(`${url}api/nothing`)).status).toBe(404);
  });
});
