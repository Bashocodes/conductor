import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

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

/** Reads the session token out of the served page, the way the console does. */
async function tokenFor(url: string): Promise<string> {
  const html = await (await fetch(url)).text();
  const match = /const TOKEN = "([^"]+)"/.exec(html);
  if (match === null) throw new Error("No session token in the served page");
  return match[1] as string;
}

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
    const token = await tokenFor(url);
    const body = (await (await fetch(`${url}api/recipes`, {
      headers: { "x-conductor-token": token },
    })).json()) as {
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
      headers: { "content-type": "application/json", "x-conductor-token": await tokenFor(url) },
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
      headers: { "content-type": "application/json", "x-conductor-token": await tokenFor(url) },
      body: JSON.stringify({ recipeId: "nope", params: {} }),
    });
    expect(response.status).toBe(400);
  });

  it("reports an unreachable host instead of throwing", async () => {
    const url = await serve();
    const report = (await (await fetch(`${url}api/doctor`, {
      headers: { "x-conductor-token": await tokenFor(url) },
    })).json()) as {
      ok: boolean;
      detail?: string;
    };
    expect(report.ok).toBe(false);
    expect(typeof report.detail).toBe("string");
  });

  it("suggests a real, unique output path so no required field starts blank", async () => {
    const url = await serve();
    const body = (await (await fetch(`${url}api/suggest-output?recipe=title-card&ext=mov`, {
      headers: { "x-conductor-token": await tokenFor(url) },
    })).json()) as { path: string };
    expect(body.path).toMatch(/\/Movies\/Conductor\/title-card-[\d-]+\.mov$/);
  });

  it("sanitises the recipe and extension used to build a suggestion", async () => {
    const url = await serve();
    const body = (await (await fetch(
      `${url}api/suggest-output?recipe=${encodeURIComponent("../../etc/pw")}&ext=${encodeURIComponent("m/o v")}`,
      { headers: { "x-conductor-token": await tokenFor(url) } },
    )).json()) as { path: string };
    // Neither value may introduce a path separator.
    expect(body.path).not.toContain("..");
    expect(body.path.split("/Movies/Conductor/")[1]).not.toContain("/");
  });

  it("exposes which parameters are file paths, so a picker can be offered", async () => {
    const url = await serve();
    const body = (await (await fetch(`${url}api/recipes`, {
      headers: { "x-conductor-token": await tokenFor(url) },
    })).json()) as {
      recipes: Array<{ id: string; params: Record<string, { path?: string }> }>;
    };
    const grade = body.recipes.find((recipe) => recipe.id === "hdr-safe-grade");
    expect(grade?.params.clip?.path).toBe("open-file");
    expect(grade?.params.outputPath?.path).toBe("save-file");
    const transition = body.recipes.find((recipe) => recipe.id === "motivated-transition");
    expect(transition?.params.clipA?.path).toBe("open-file");
    expect(transition?.params.clipB?.path).toBe("open-file");
  });

  it("404s an unknown path", async () => {
    const url = await serve();
    expect((await fetch(`${url}api/nothing`, {
      headers: { "x-conductor-token": await tokenFor(url) },
    })).status).toBe(404);
  });
});

/**
 * This server drives After Effects and accepts file paths. Loopback binding
 * keeps other machines out but not other *websites*, because a page you visit
 * can make your own browser issue the request. Each test below reproduces one
 * attack that worked before these guards existed.
 */
describe("the console cannot be driven by another site", () => {
  it("refuses a request whose Host is not loopback (DNS rebinding)", async () => {
    const url = await serve();
    const token = await tokenFor(url);
    // `fetch` refuses to set Host — it is a forbidden header — so this goes out
    // over a raw socket, which is also how a real rebinding request arrives.
    const port = Number(new URL(url).port);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/api/recipes",
          method: "GET",
          headers: { host: "evil.example.com", "x-conductor-token": token },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(403);
  });

  it("refuses a request carrying a foreign Origin (CSRF)", async () => {
    const url = await serve();
    const token = await tokenFor(url);
    const response = await fetch(`${url}api/recipes`, {
      headers: { origin: "https://evil.example.com", "x-conductor-token": token },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a request carrying a foreign Referer", async () => {
    const url = await serve();
    const token = await tokenFor(url);
    const response = await fetch(`${url}api/recipes`, {
      headers: { referer: "https://evil.example.com/page", "x-conductor-token": token },
    });
    expect(response.status).toBe(403);
  });

  it("refuses an API call with no session token", async () => {
    const url = await serve();
    expect((await fetch(`${url}api/recipes`)).status).toBe(403);
  });

  it("refuses a run started without the token, even as a plain GET", async () => {
    /*
     * /api/run is a GET so EventSource can consume it, which means an
     * <img src> or EventSource on any page would otherwise fire it — and a run
     * imports files and queues renders. The token is what stops that.
     */
    const url = await serve();
    const response = await fetch(
      `${url}api/run?recipe=title-card&params=${encodeURIComponent('{"outputPath":"/tmp/a.mov"}')}`,
    );
    expect(response.status).toBe(403);
  });

  it("mints a different token per server start", async () => {
    const first = await tokenFor(await serve());
    await stop?.();
    const second = await tokenFor(await serve());
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(20);
  });

  it("refuses a file-dialog request from another site", async () => {
    // This endpoint opens a native dialog on the user's screen; a page they
    // visit must not be able to summon one.
    const url = await serve();
    const response = await fetch(`${url}api/choose`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ mode: "open-file" }),
    });
    expect(response.status).toBe(403);
  });

  it("declares a content security policy with no external origins", async () => {
    const url = await serve();
    const csp = (await fetch(url)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
  });
});
