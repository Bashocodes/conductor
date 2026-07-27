import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

import {
  aerenderArgs,
  automaticProjectPath,
  cinematicPreviewOutputPath,
  cinematicPreviewProxyArgs,
  cinematicStillDisplayArgs,
  HLG_SCENE_SIGNAL_SCALE,
  sourceFrameArgs,
  finderRevealArgs,
  hevcHlgArgs,
  startConductorServer,
  sweepStalePreviews,
} from "../src/server/serve.js";
import {
  exiftoolPrivacyCleanArgs,
  privacyCleanOutputCandidate,
} from "../src/server/privacy.js";
import { watermarkPathKeyframes } from "../src/recipes/watermarkMotion.js";
import { renderConsoleHtml } from "../src/server/page.js";
import { readFileSync } from "node:fs";

const CONSOLE_HTML_SOURCE = readFileSync(
  new URL("../src/server/page.ts", import.meta.url),
  "utf8",
);

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
  const match = /let TOKEN = "([^"]+)"/.exec(html);
  if (match === null) throw new Error("No session token in the served page");
  return match[1] as string;
}

async function serve(publicOrigin?: string): Promise<string> {
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
  const server = await startConductorServer({ configPath, port: 0, publicOrigin });
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
    expect(html).toContain("Build &amp; render");
    expect(html).toContain("/api/render?token=");
    expect(html).toContain("Privacy Clean Copy");
    expect(html).toContain("/api/privacy-clean");
    expect(html).toContain("refreshAutoSuggestedOutputs");
    expect(html).toContain('control.dataset.autoSuggested = "true"');
    // No CDN fonts, scripts, or styles: the page must work with no network.
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\//);
  });

  it("serves a console whose script actually parses", async () => {
    // The console is hand-written into one string with no build step, so
    // nothing else would catch a stray bracket until the page silently
    // rendered nothing. Compiling proves it parses; it is never called.
    const html = await (await fetch(await serve())).text();
    const script = html.slice(
      html.lastIndexOf("<script>") + "<script>".length,
      html.lastIndexOf("</script>"),
    );
    expect(script.length).toBeGreaterThan(1000);
    expect(() => new Function(script)).not.toThrow();
  });

  it("emits a hosted copy that points only at the visitor's loopback server", () => {
    const html = renderConsoleHtml({
      sessionToken: "",
      apiBase: "http://127.0.0.1:4173/",
    });
    expect(html).toContain('href="/director/"');
    expect(html).toContain('aria-current="page">Conductor</a>');
    expect(html).toContain('const API_BASE = "http://127.0.0.1:4173/"');
    expect(html).toContain('let TOKEN = ""');
    expect(html).toContain("conductor serve --no-open");
    expect(html).toContain("CONDUCTOR_PUBLIC_ORIGIN=");
    expect(html).toContain('"CONDUCTOR_PUBLIC_ORIGIN=" + window.location.origin');
    expect(html).toContain('data-connection-state="not-started"');
    expect(html).toContain("Connect to local Conductor");
    expect(html).toContain('showConnectionState("awaiting-permission")');
    expect(html).toContain('showConnectionState("refused-unreachable")');
    expect(html).toContain('["loopback-network", "local-network-access"]');
    expect(html).toContain('permission.addEventListener("change", permissionChanged)');
    expect(html).toContain("else void start(false)");
    expect(html).not.toContain("CONNECT_TIMEOUT_MS");
    expect(html).not.toContain("__CONDUCTOR_API_BASE__");
  });

  it("keeps local same-origin use automatic while hosted use waits for a click", () => {
    const local = renderConsoleHtml({ sessionToken: "local-token", apiBase: "" });
    const hosted = renderConsoleHtml({
      sessionToken: "",
      apiBase: "http://127.0.0.1:4173/",
    });

    expect(local).toContain('const HOSTED_CONSOLE = TOKEN === ""');
    expect(local).toContain('else void start(false)');
    expect(hosted).toContain('$("retryConnection").onclick = () => { void start(true); }');
    expect(hosted).toContain('if (HOSTED_CONSOLE) showConnectionState("not-started")');
  });

  it("keeps the console template free of characters that TypeScript would eat", () => {
    // The page is one String.raw template, so a backtick or a dollar-brace in
    // the page's own JavaScript is read by TypeScript instead of the browser.
    // That has broken this file twice; a comment is not a guard, this is.
    const marker = "String.raw" + "`";
    const start = CONSOLE_HTML_SOURCE.indexOf(marker) + marker.length;
    const body = CONSOLE_HTML_SOURCE.slice(start, CONSOLE_HTML_SOURCE.lastIndexOf("`;"));
    expect(body).not.toContain("`");
    expect(body).not.toContain("${");
  });

  it("refuses to be framed and disables MIME sniffing", async () => {
    const url = await serve();
    const response = await fetch(url);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers the configured public-to-loopback preflight without a wildcard", async () => {
    const url = await serve("https://director.aikizi.com");
    const response = await fetch(`${url}api/session`, {
      method: "OPTIONS",
      headers: {
        origin: "https://director.aikizi.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-conductor-token",
        "access-control-request-private-network": "true",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://director.aikizi.com");
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-private-network")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toContain("X-Conductor-Token");
  });

  it("bootstraps a session only for the configured public and loopback development origins", async () => {
    const url = await serve("https://director.aikizi.com");
    const hosted = await fetch(`${url}api/session`, {
      headers: { origin: "https://director.aikizi.com" },
    });
    expect(hosted.status).toBe(200);
    expect(hosted.headers.get("access-control-allow-origin")).toBe("https://director.aikizi.com");
    expect(typeof ((await hosted.json()) as { token?: unknown }).token).toBe("string");

    const localDev = await fetch(`${url}api/session`, {
      headers: { origin: "http://localhost:5190" },
    });
    expect(localDev.status).toBe(200);
    expect(localDev.headers.get("access-control-allow-origin")).toBe("http://localhost:5190");

    const www = await fetch(`${url}api/session`, {
      headers: { origin: "https://www.director.aikizi.com" },
    });
    expect(www.status).toBe(403);
    expect(www.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses private-network preflights from every other public origin", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/recipes`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "GET",
        "access-control-request-private-network": "true",
      },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-private-network")).toBeNull();
  });

  it("refuses every public origin until one exact HTTPS origin is configured", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/session`, {
      headers: { origin: "https://director.aikizi.com" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses an unsafe or path-scoped public origin configuration", async () => {
    await expect(serve("http://director.aikizi.com")).rejects.toThrow(
      "CONDUCTOR_PUBLIC_ORIGIN must be one exact HTTPS origin",
    );
    await expect(serve("https://director.aikizi.com/conductor/")).rejects.toThrow(
      "CONDUCTOR_PUBLIC_ORIGIN must be one exact HTTPS origin",
    );
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
    expect(ids).toContain("cinematic-look-lab");
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

  it("takes run parameters by POST, because a motion path does not fit in a URL", async () => {
    const url = await serve();
    const token = await tokenFor(url);
    // A minute of watermark motion encodes to roughly 29 KB. Node refuses a
    // request line past 16 KB, and a browser reports that to an EventSource as
    // a bare disconnect — so this path must never be a query string again.
    const params = {
      clip: "/media/source.mov",
      outputPath: "/renders/out.mp4",
      watermarkPath: watermarkPathKeyframes({
        motion: "Drift",
        cycles: 6,
        travel: 55,
        centerXPercent: 50,
        centerYPercent: 50,
      }),
    };
    expect(encodeURIComponent(JSON.stringify(params)).length).toBeGreaterThan(16_384);

    const response = await fetch(`${url}api/run-params`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-conductor-token": token },
      body: JSON.stringify({ recipeId: "cinematic-look-lab", params }),
    });
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(typeof id).toBe("string");

    // A ticket that was never issued — or one already consumed by its run —
    // is refused rather than silently running something else.
    const unknown = await fetch(`${url}api/run?token=${token}&run=${id}-nope`);
    expect(unknown.status).toBe(400);
  });

  it("refuses to stash parameters for a recipe that does not exist", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/run-params`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-conductor-token": await tokenFor(url),
      },
      body: JSON.stringify({ recipeId: "nope", params: {} }),
    });
    expect(response.status).toBe(400);
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
      recipes: Array<{
        id: string;
        params: Record<
          string,
          { path?: string; default?: unknown; values?: unknown[] }
        >;
      }>;
    };
    const grade = body.recipes.find((recipe) => recipe.id === "hdr-safe-grade");
    expect(grade?.params.clip?.path).toBe("open-file");
    expect(grade?.params.outputPath?.path).toBe("save-file");
    expect(grade?.params.strength).toMatchObject({
      default: "Natural HDR",
      values: ["Natural HDR", "Vivid HDR", "Impact HDR"],
    });
    const transition = body.recipes.find((recipe) => recipe.id === "motivated-transition");
    expect(transition?.params.clipA?.path).toBe("open-file");
    expect(transition?.params.clipB?.path).toBe("open-file");
    const cinematic = body.recipes.find((recipe) => recipe.id === "cinematic-look-lab");
    expect(cinematic?.params.look).toMatchObject({
      default: "Clean Cinema",
      values: [
        // The technical grade is a look you can choose, which is what lets one
        // recipe cover both the plain HDR delivery and the graded ones.
        "Technical HDR",
        "Clean Cinema",
        "Golden Hour",
        "Teal & Amber",
        "Dream Bloom",
        "Film Noir",
        "Neon Night",
        "Bleach Bypass",
      ],
    });
    expect(cinematic?.params.watermarkText?.default).toBe("sample_");
    expect(cinematic?.params.watermarkVisibility?.default).toBe(10);
  });

  it("converts an After Effects HLG still into something a browser shows honestly", () => {
    const args = cinematicStillDisplayArgs("/tmp/look.png", "/tmp/look.display.jpg");
    expect(args).toContain("/tmp/look.png");
    expect(args.at(-1)).toBe("/tmp/look.display.jpg");
    const filter = args[args.indexOf("-vf") + 1] as string;

    // 16-bit throughout: the transfer is expanded, and doing that in 8 bits
    // would band every gradient in the frame.
    expect(filter).toContain("format=gbrp16le");
    // The measured scale between an AE value and an HLG signal.
    expect(HLG_SCENE_SIGNAL_SCALE).toBe(10);
    expect(filter).toContain("val/maxval*10");
    // The HLG OETF's own constants, inverted.
    expect(filter).toContain("0.55991073");
    expect(filter).toContain("0.17883277");
    expect(filter).toContain("0.28466892");
    // Order matters: scene light, then primaries, then the display encode.
    // Converting primaries after the sRGB encode would be wrong.
    const toLight = filter.indexOf("0.55991073");
    const primaries = filter.indexOf("colorchannelmixer");
    const display = filter.indexOf("1.055*pow");
    expect(toLight).toBeLessThan(primaries);
    expect(primaries).toBeLessThan(display);
    expect(filter).toContain("rr=1.6605");
  });

  it("asks ffmpeg for one frame at the moment a sample is taken from", () => {
    expect(sourceFrameArgs("/media/clip.mov", 4.25, "/tmp/frame.jpg")).toEqual([
      "-y", "-ss", "4.25", "-i", "/media/clip.mov",
      "-frames:v", "1", "-q:v", "3", "/tmp/frame.jpg",
    ]);
    // A negative seek is not a seek.
    expect(sourceFrameArgs("/media/clip.mov", -3, "/tmp/frame.jpg")[2]).toBe("0");
  });

  it("names a still a png and a moving sample an mp4", () => {
    expect(
      cinematicPreviewOutputPath("/tmp/previews", "Teal & Amber", "unit", "png"),
    ).toBe("/tmp/previews/teal-amber-unit.png");
    expect(
      cinematicPreviewOutputPath("/tmp/previews", "Teal & Amber", "unit"),
    ).toBe("/tmp/previews/teal-amber-unit.mp4");
  });

  it("clears preview files nothing points at any more", async () => {
    const directory = await mkdtemp(join(tmpdir(), "conductor-sweep-"));
    const old = join(directory, "old-sample.jpg");
    const fresh = join(directory, "fresh-sample.jpg");
    await writeFile(old, "x");
    await writeFile(fresh, "x");
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(old, twoDaysAgo, twoDaysAgo);

    // A console that was closed or killed leaves its samples behind, and
    // nothing in the next session points at them. Anything recent belongs to a
    // console that may still be running, so it stays.
    expect(await sweepStalePreviews(directory, 24 * 60 * 60 * 1000)).toBe(1);
    expect(await stat(fresh).then(() => true)).toBe(true);
    expect(await stat(old).then(() => true).catch(() => false)).toBe(false);
  });

  it("refuses to display a local file nobody chose", async () => {
    const url = await serve();
    const response = await fetch(
      `${url}api/local-image?path=${encodeURIComponent("/etc/passwd")}`,
      { headers: { "x-conductor-token": await tokenFor(url) } },
    );
    expect(response.status).toBe(403);
  });

  it("refuses to open a delivery it did not produce", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/delivery/open`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-conductor-token": await tokenFor(url),
      },
      body: JSON.stringify({ id: "made-up" }),
    });
    expect(response.status).toBe(404);
  });

  it("refuses to reveal anything that is not an absolute path", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-conductor-token": await tokenFor(url) },
      body: JSON.stringify({ path: "relative/thing" }),
    });
    expect(response.status).toBe(400);
  });

  it("always asks Finder to reveal a target rather than opening an application", () => {
    expect(finderRevealArgs("/Applications/Calculator.app/unfinished.mov", false)).toEqual([
      "-R",
      "/Applications/Calculator.app",
    ]);
    expect(finderRevealArgs("/tmp/finished.mov", true)).toEqual([
      "-R",
      "/tmp/finished.mov",
    ]);
  });

  it("creates a non-destructive sibling name for every privacy-clean copy", () => {
    expect(privacyCleanOutputCandidate("/Downloads/photo.jpg")).toBe(
      "/Downloads/photo-clean.jpg",
    );
    expect(privacyCleanOutputCandidate("/Downloads/photo.jpg", 3)).toBe(
      "/Downloads/photo-clean-3.jpg",
    );
    expect(privacyCleanOutputCandidate("/Downloads/clip")).toBe(
      "/Downloads/clip-clean",
    );
  });

  it("removes metadata without recompressing image or video media", () => {
    const imageArgs = exiftoolPrivacyCleanArgs(
      "/Downloads/photo.jpg",
      "/Downloads/photo-clean.jpg",
      "image",
    );
    expect(imageArgs).toContain("-all=");
    expect(imageArgs).toContain("-Orientation");
    expect(imageArgs).toContain("-ICC_Profile");
    expect(imageArgs).not.toContain("-overwrite_original");

    const videoArgs = exiftoolPrivacyCleanArgs(
      "/Downloads/clip.mp4",
      "/Downloads/clip-clean.mp4",
      "video",
    );
    expect(videoArgs).toEqual([
      "-all=",
      "-o",
      "/Downloads/clip-clean.mp4",
      "/Downloads/clip.mp4",
    ]);
  });

  it("refuses a privacy-clean request without an absolute source path", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/privacy-clean`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-conductor-token": await tokenFor(url),
      },
      body: JSON.stringify({ path: "relative/photo.jpg" }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("absolute path");
  });

  it("scopes aerender to the queue item the recipe just created", () => {
    expect(aerenderArgs("/tmp/project.aep", 7)).toEqual([
      "-project",
      "/tmp/project.aep",
      "-rqindex",
      "7",
    ]);
  });

  it("saves an untitled project automatically beside the delivery", () => {
    expect(automaticProjectPath("/renders/coastal-skate-hlg.mp4")).toBe(
      "/renders/.conductor-projects/coastal-skate-hlg.aep",
    );
  });

  it("encodes a genuine 10-bit BT.2020 HLG delivery", () => {
    const args = hevcHlgArgs("/tmp/intermediate.mov", "/tmp/delivery.mp4");
    expect(args).toContain("hevc_videotoolbox");
    expect(args).toContain("main10");
    expect(args).toContain("p010le");
    expect(args).toContain("bt2020");
    expect(args).toContain("bt2020nc");
    expect(args).toContain("arib-std-b67");
    expect(args).toContain(
      "setparams=range=limited:color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc",
    );
    expect(args).toContain(
      "hevc_metadata=video_full_range_flag=0:colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9",
    );
    expect(args.at(-1)).toBe("/tmp/delivery.mp4");
  });

  it("uses macOS ColorSync to make the HLG sample browser-safe", () => {
    const args = cinematicPreviewProxyArgs("/tmp/look.mp4", "/tmp/look.browser.m4v");
    expect(args).toEqual([
      "--source",
      "/tmp/look.mp4",
      "--preset",
      "Preset1280x720",
      "--output",
      "/tmp/look.browser.m4v",
      "--replace",
    ]);
  });

  it("keeps generated look samples in the private preview directory", () => {
    expect(
      cinematicPreviewOutputPath(
        "/tmp/.cinematic-previews",
        "Teal & Amber",
        "unit",
      ),
    ).toBe("/tmp/.cinematic-previews/teal-amber-unit.mp4");
  });

  it("refuses to register arbitrary local files as cinematic previews", async () => {
    const url = await serve();
    const response = await fetch(`${url}api/cinematic/register-preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-conductor-token": await tokenFor(url),
      },
      body: JSON.stringify({
        look: "Clean Cinema",
        path: "/tmp/not-a-conductor-preview.mp4",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("private preview folder");
  });

  it("rejects a render request without exact queue item indices", async () => {
    const url = await serve();
    const token = await tokenFor(url);
    const response = await fetch(`${url}api/render?token=${encodeURIComponent(token)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("No valid render queue items were selected.");
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

  it("refuses a render started without the token", async () => {
    const url = await serve();
    expect((await fetch(`${url}api/render?indices=1`)).status).toBe(403);
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
