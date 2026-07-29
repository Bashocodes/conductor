import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";

import { createAdapterRegistryFromConfig } from "../adapters/registry.js";
import { RecipeEngine } from "../engine/engine.js";
import { createDryRunPlan } from "../engine/dry-run.js";
import type { JournalStep } from "../engine/journal.js";
import { normalizeToolResult } from "../engine/normalizeResult.js";
import { loadConductorConfig } from "../mcp/config.js";
import { McpClientManager } from "../mcp/client.js";
import {
  FFMPEG_CANDIDATES,
  FFPROBE_CANDIDATES,
  findExecutable,
} from "../media.js";
import {
  CINEMATIC_LOOKS,
  DEFAULT_SAMPLE_LOGO,
} from "../recipes/cinematic-look-lab.js";
import {
  getRecipe,
  listRecipes,
  prepareRecipeRun,
} from "../recipes/index.js";
import { renderConsoleHtml } from "./page.js";
import { createPrivacyCleanCopy } from "./privacy.js";
import {
  analyzeAudioFile,
  type BeatAnalysis,
} from "../beat/analyze.js";
import {
  assertBeatSyncVerification,
  recordBeatSyncVerification,
  type BeatSyncCutPlacement,
  type BeatSyncVerificationReport,
  verifyRenderedBeatSync,
} from "../beat/verify.js";

/**
 * A local control panel for Conductor.
 *
 * A browser cannot spawn an MCP server or speak stdio, so something on this
 * machine has to. That is exactly what Conductor already is — this just gives
 * it a face, so driving After Effects does not require remembering flags.
 *
 * **Bound to 127.0.0.1 only** — but that alone is not a security boundary, and
 * an earlier version of this file wrongly claimed it was. Loopback stops other
 * machines; it does not stop other *websites*, because a page you visit can
 * make your own browser issue the request. See the guards below.
 */

const execFileAsync = promisify(execFile);

export interface ServeOptions {
  configPath: string;
  port: number;
  host?: string;
  /** The one HTTPS shell origin allowed to call this loopback server. */
  publicOrigin?: string;
}

interface PendingRender {
  outputPath: string;
  renderPath: string;
  postProcess?: "hevc-hlg";
  templateApplied: string | null;
  beatSync?: {
    journalPath: string;
    requestedFrameRate: number;
    cuts: BeatSyncCutPlacement[];
  };
}

/**
 * One generated sample. `files` lists everything to remove when the sample is
 * superseded, so cleanup never has to know which kind it was looking at.
 */
interface PreviewEntry {
  look: string;
  clip: string;
  kind: "clip" | "still";
  files: string[];
  videoPath?: string;
  thumbnailPath?: string;
  imagePath?: string;
}

/**
 * Binding to loopback keeps other machines out. It does NOT keep other
 * *websites* out: a page you visit can make your own browser issue requests to
 * 127.0.0.1, and can point a hostname it controls at 127.0.0.1 so the request
 * looks same-origin to the browser. Since this server drives After Effects and
 * accepts file paths, an unguarded endpoint would let any site you happen to
 * open import files and queue renders on your machine.
 *
 * Three guards, each closing a different door:
 *
 * 1. `assertLocalHost` — the Host header must name loopback, which is what
 *    DNS rebinding cannot produce.
 * 2. `assertSameOrigin` — an Origin or Referer from anywhere else is refused.
 * 3. `assertToken` — a value minted per server start and readable only from
 *    the served page, which another origin cannot read.
 */

function isLoopbackHost(hostHeader: string | undefined, port: number): boolean {
  if (hostHeader === undefined) return false;
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  return allowed.has(hostHeader.toLowerCase());
}

function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error(
      "CONDUCTOR_PUBLIC_ORIGIN must be one exact HTTPS origin, for example https://director.aikizi.com",
    );
  }
  return origin.origin;
}

function isLoopbackOrigin(origin: URL): boolean {
  return (
    origin.protocol === "http:" &&
    (origin.hostname === "127.0.0.1" || origin.hostname === "localhost" || origin.hostname === "::1")
  );
}

function isAllowedCorsOrigin(
  value: string | undefined,
  publicOrigin: string | undefined,
): value is string {
  if (value === undefined || value === "" || value === "null") return false;
  try {
    const origin = new URL(value);
    return origin.origin === publicOrigin || isLoopbackOrigin(origin);
  } catch {
    return false;
  }
}

function isAllowedRequestSource(
  value: string | undefined,
  publicOrigin: string | undefined,
): boolean {
  if (value === undefined || value === "" || value === "null") return true;
  try {
    const origin = new URL(value);
    return origin.origin === publicOrigin || isLoopbackOrigin(origin);
  } catch {
    return false;
  }
}

function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  publicOrigin: string | undefined,
): string | undefined {
  const origin = typeof request.headers.origin === "string"
    ? request.headers.origin
    : undefined;
  if (!isAllowedCorsOrigin(origin, publicOrigin)) return undefined;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("cross-origin-resource-policy", "cross-origin");
  return origin;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // A local control surface should never be framed or sniffed.
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(text);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A control-panel request is tiny; refuse anything that is not.
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Opens the operating system's own file dialog and returns the chosen path.
 *
 * A browser cannot show you a real Finder window, and it cannot tell a page the
 * true path of a file you pick. But Conductor is already a local process, so it
 * can simply ask the OS — which is the only reason typing absolute paths was
 * ever the alternative.
 *
 * Cancelling is not an error: AppleScript reports -128, which becomes a plain
 * "cancelled" rather than a failure the console has to explain.
 */
async function chooseFileViaFinder(options: {
  mode: "open-file" | "save-file";
  prompt: string;
  suggestedName?: string;
  multiple?: boolean;
}): Promise<{
  path?: string;
  paths?: string[];
  cancelled?: boolean;
}> {
  // The prompt is the only caller-influenced value; quotes are escaped so it
  // cannot terminate the AppleScript string.
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const script =
    options.mode === "open-file" && options.multiple === true
      ? `set chosenFiles to choose file with prompt ${quote(options.prompt)} with multiple selections allowed
set chosenPaths to {}
repeat with chosenFile in chosenFiles
  set end of chosenPaths to POSIX path of chosenFile
end repeat
set AppleScript's text item delimiters to linefeed
return chosenPaths as text`
      : options.mode === "open-file"
        ? `POSIX path of (choose file with prompt ${quote(options.prompt)})`
      : `POSIX path of (choose file name with prompt ${quote(options.prompt)}` +
        (options.suggestedName === undefined
          ? ")"
          : ` default name ${quote(options.suggestedName)})`);

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
      timeout: 300_000,
    });
    if (options.multiple === true) {
      return {
        paths: stdout
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean),
      };
    }
    return { path: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("-128") || /user cancel/i.test(message)) {
      return { cancelled: true };
    }
    throw new Error(`Could not open the file dialog: ${message}`);
  }
}

/**
 * Where After Effects keeps its headless renderer.
 *
 * Rendering through ExtendScript would block After Effects and the MCP
 * connection with it — and the panel's own timeout is far shorter than any
 * real render, so a long one would be reported as a failure while it quietly
 * succeeded. `aerender` avoids all of that: Conductor is already a local
 * process, so it can run Adobe's renderer directly and read its progress.
 *
 * Conductor deliberately does not pass `-reuse`: on AE 26 that mode can return
 * before the output is durable and can replace the GUI session with an empty
 * project. A separate aerender process waits for completion and exits cleanly.
 */
const AERENDER_CANDIDATES = [
  "/Applications/Adobe After Effects 2026/aerender",
  "/Applications/Adobe After Effects 2025/aerender",
  "/Applications/Adobe After Effects (Beta)/aerender",
];

async function findAerender(): Promise<string | undefined> {
  for (const candidate of AERENDER_CANDIDATES) {
    if (await stat(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return undefined;
}

/** Always reveal in Finder; never hand `open` a path that it could launch. */
export function finderRevealArgs(target: string, exists: boolean): string[] {
  return ["-R", exists ? target : dirname(target)];
}

/** Render only the queue item the recipe just created, not stale queued work. */
export function aerenderArgs(projectPath: string, renderQueueIndex: number): string[] {
  return ["-project", projectPath, "-rqindex", String(renderQueueIndex)];
}

/** An untitled AE project is implementation state, not another user decision. */
export function automaticProjectPath(deliveryPath: string): string {
  const projectName = basename(deliveryPath, extname(deliveryPath));
  return join(dirname(deliveryPath), ".conductor-projects", `${projectName}.aep`);
}

/** Matches the known-good HLG delivery verified on 2026-07-25. */
export function hevcHlgArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a?",
    "-vf", "setparams=range=limited:color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc",
    "-c:v", "hevc_videotoolbox",
    "-profile:v", "main10",
    "-pix_fmt", "p010le",
    "-b:v", "20M",
    "-maxrate:v", "24M",
    "-bufsize:v", "40M",
    "-tag:v", "hvc1",
    "-color_range", "tv",
    "-color_primaries", "bt2020",
    "-color_trc", "arib-std-b67",
    "-colorspace", "bt2020nc",
    "-bsf:v", "hevc_metadata=video_full_range_flag=0:colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9",
    "-c:a", "aac",
    "-b:a", "256k",
    "-movflags", "+faststart",
    outputPath,
  ];
}

/** macOS ColorSync tone-maps the HLG sample into a browser-safe BT.709 proxy. */
export function cinematicPreviewProxyArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    "--source", inputPath,
    "--preset", "Preset1280x720",
    "--output", outputPath,
    "--replace",
  ];
}

/**
 * The scale between an After Effects `saveFrameToPng` value and an HLG signal.
 *
 * A frame saved out of a `Rec.2100 HLG Scene W100` project is not a picture a
 * browser can show: it holds the HLG signal divided by ten — diffuse white at
 * 100 nits inside a 1000-nit container — which renders as a nearly black image.
 * Ten is not a guess. It was measured against frames extracted straight from
 * the source clip, across five patches from sky to shadow, and the
 * reconstruction below is visually indistinguishable from the source.
 *
 * This holds only for that working space, which the recipe's configure step
 * verifies before any frame is written.
 */
export const HLG_SCENE_SIGNAL_SCALE = 10;

/**
 * Converts an After Effects HLG still into an image a browser shows honestly:
 * undo the scaling, invert the HLG transfer to scene light, move BT.2020
 * primaries to BT.709, then encode sRGB. Every look goes through exactly this,
 * so comparing two samples compares the grades and nothing else.
 */
export function cinematicStillDisplayArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  const signal = `min(1,val/maxval*${HLG_SCENE_SIGNAL_SCALE})`;
  // The HLG OETF's inverse: the square-law branch below half signal, the
  // logarithmic branch above it.
  const toSceneLight =
    `if(lte(${signal},0.5),pow(${signal},2)/3,` +
    `(exp((${signal}-0.55991073)/0.17883277)+0.28466892)/12)*maxval`;
  const bt2020ToBt709 =
    "colorchannelmixer=" +
    "rr=1.6605:rg=-0.5876:rb=-0.0728:" +
    "gr=-0.1246:gg=1.1329:gb=-0.0083:" +
    "br=-0.0182:bg=-0.1006:bb=1.1187";
  const sRgb =
    "if(lte(val/maxval,0.0031308),12.92*val/maxval," +
    "1.055*pow(val/maxval,1/2.4)-0.055)*maxval";
  // The expressions contain commas, which separate filters — ffmpeg's own
  // parser needs them quoted, so these single quotes are not shell quoting.
  const lut = (expression: string) =>
    `lut=c0='${expression}':c1='${expression}':c2='${expression}'`;
  return [
    "-y",
    "-i", inputPath,
    "-vf",
    `format=gbrp16le,${lut(toSceneLight)},${bt2020ToBt709},${lut(sRgb)}`,
    "-q:v", "3",
    outputPath,
  ];
}

/** One frame of the source clip, exactly as the clip itself looks. */
export function sourceFrameArgs(
  clipPath: string,
  timeSeconds: number,
  outputPath: string,
): string[] {
  return [
    "-y",
    "-ss", String(Math.max(0, timeSeconds)),
    "-i", clipPath,
    "-frames:v", "1",
    "-q:v", "3",
    outputPath,
  ];
}

function cinematicThumbnailArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-ss", "0.75",
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath,
  ];
}

export function cinematicPreviewOutputPath(
  directory: string,
  look: string,
  unique: string = `${Date.now()}-${randomUUID()}`,
  extension = "mp4",
): string {
  const slug = look.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "") || "mp4";
  return join(directory, `${slug}-${unique}.${safeExtension}`);
}

/** Reserved sample key for the ungraded source frame, which is not a look. */
export const SOURCE_FRAME_KEY = "\u0000source-frame";

/**
 * Waits for a file to exist and stop growing.
 *
 * `saveFrameToPng` returns to the script before the PNG is closed, so reading
 * it immediately finds nothing — or worse, half of it.
 */
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    const info = await stat(path).catch(() => undefined);
    if (info !== undefined && info.size > 0 && info.size === lastSize) return true;
    if (info !== undefined) lastSize = info.size;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

async function streamLocalMedia(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  contentType: string,
): Promise<void> {
  const info = await stat(path);
  const range = request.headers.range;
  const common = {
    "content-type": contentType,
    "cache-control": "no-store",
    "accept-ranges": "bytes",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
  };
  if (range === undefined) {
    response.writeHead(200, { ...common, "content-length": info.size });
    createReadStream(path).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match === null) {
    response.writeHead(416, { ...common, "content-range": `bytes */${info.size}` });
    response.end();
    return;
  }
  const start = match[1] === "" ? 0 : Number(match[1]);
  const requestedEnd = match[2] === "" ? info.size - 1 : Number(match[2]);
  const end = Math.min(requestedEnd, info.size - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) {
    response.writeHead(416, { ...common, "content-range": `bytes */${info.size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    ...common,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${info.size}`,
  });
  createReadStream(path, { start, end }).pipe(response);
}

function parseRenderQueueIndices(value: string | null): number[] | undefined {
  if (value === null || value === "") return undefined;
  const parts = value.split(",");
  if (
    parts.length > 100 ||
    parts.some((part) => !/^[1-9]\d*$/.test(part))
  ) {
    return undefined;
  }
  return [...new Set(parts.map((part) => Number(part)))];
}

function renderProjectStateScript(saveAsPath?: string): string {
  const save =
    saveAsPath === undefined
      ? "if (!p.file) { return { saved: false }; }\np.save();"
      : `p.save(new File(${JSON.stringify(saveAsPath)}));`;
  return (
    "var p = app.project;\n" +
    `${save}\n` +
    "var queuedItems = [];\n" +
    "for (var i = 1; i <= p.renderQueue.numItems; i++) {\n" +
    "  var item = p.renderQueue.item(i);\n" +
    "  if (item.status === RQItemStatus.QUEUED) {\n" +
    "    var file = item.outputModule(1).file;\n" +
    "    queuedItems.push({ index: i, renderPath: file ? file.fsName : null });\n" +
    "  }\n" +
    "}\n" +
    "return { saved: true, path: p.file.fsName, queuedItems: queuedItems };"
  );
}

async function assertRenderedFile(path: string): Promise<void> {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error(`Adobe reported success, but no rendered file exists at ${path}`);
  }
}

async function assertHlgDelivery(path: string): Promise<void> {
  await assertRenderedFile(path);
  const ffprobe = await findExecutable(FFPROBE_CANDIDATES);
  if (ffprobe === undefined) {
    throw new Error("ffprobe is required to verify the HDR delivery, but it was not found.");
  }
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries",
      "stream=codec_name,profile,pix_fmt,color_space,color_transfer,color_primaries",
      "-of", "json",
      path,
    ],
    { timeout: 30_000 },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
  };
  const video = parsed.streams?.[0];
  const valid =
    video?.codec_name === "hevc" &&
    video.profile === "Main 10" &&
    typeof video.pix_fmt === "string" &&
    video.pix_fmt.includes("10") &&
    video.color_space === "bt2020nc" &&
    video.color_transfer === "arib-std-b67" &&
    video.color_primaries === "bt2020";
  if (!valid) {
    throw new Error(
      `The rendered file exists, but its HDR metadata is invalid: ${JSON.stringify(video)}`,
    );
  }
}

/**
 * Counts established connections between the CEP panel and its proxy. Zero is
 * the signature of a disconnected panel, which is the failure people actually
 * hit, so the console reports it rather than leaving them guessing.
 */
async function panelSocketCount(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/lsof",
      ["-nP", "-iTCP:3001", "-sTCP:ESTABLISHED"],
      { timeout: 4_000 },
    );
    return stdout.split("\n").filter((line) => line.includes("node")).length;
  } catch {
    // lsof is absent or refused; the count is a nicety, not a requirement.
    return undefined;
  }
}

/** Removes preview files older than `maxAgeMs`. Never touches anything else. */
export async function sweepStalePreviews(
  directory: string,
  maxAgeMs: number,
): Promise<number> {
  const entries = await readdir(directory).catch(() => []);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const entry of entries) {
    const path = join(directory, entry);
    const info = await stat(path).catch(() => undefined);
    if (info === undefined || !info.isFile() || info.mtimeMs > cutoff) continue;
    await unlink(path).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

export async function startConductorServer(options: ServeOptions): Promise<{
  url: string;
  publicOrigin?: string;
  close: () => Promise<void>;
}> {
  const host = options.host ?? "127.0.0.1";
  const publicOrigin = normalizePublicOrigin(
    options.publicOrigin ?? process.env.CONDUCTOR_PUBLIC_ORIGIN,
  );
  // New every start, so a token cannot outlive the session it belongs to.
  const sessionToken = randomUUID();
  const pendingRenders = new Map<number, PendingRender>();
  const previewMedia = new Map<string, PreviewEntry>();
  const beatAnalysisCache = new Map<
    string,
    { size: number; modifiedMs: number; analysis: BeatAnalysis }
  >();
  const cachedBeatAnalysis = async (audioPath: string): Promise<BeatAnalysis> => {
    const file = await stat(audioPath);
    const cached = beatAnalysisCache.get(audioPath);
    if (
      cached !== undefined &&
      cached.size === file.size &&
      cached.modifiedMs === file.mtimeMs
    ) {
      return cached.analysis;
    }
    const analysis = await analyzeAudioFile(audioPath);
    beatAnalysisCache.set(audioPath, {
      size: file.size,
      modifiedMs: file.mtimeMs,
      analysis,
    });
    return analysis;
  };
  /**
   * Local files the console is allowed to display.
   *
   * The stage shows the real logo, which means serving a file from outside
   * Conductor's own folders — so the readable set is exactly the paths someone
   * picked in a Finder dialog, plus the bundled mark. A path arriving in a
   * request is never sufficient on its own.
   */
  const displayableFiles = new Set<string>([DEFAULT_SAMPLE_LOGO]);
  /** Delivered renders, addressable by id so no path travels in a request. */
  const deliveredRenders = new Map<string, string>();
  /**
   * Parameters waiting for the EventSource that will run them.
   *
   * EventSource cannot POST, so parameters used to travel in the query string.
   * That silently stopped working the moment a recipe took a real motion path:
   * a minute-long clip encodes to ~29 KB, Node refuses a request line past
   * `maxHeaderSize` (16 KB by default), and a browser reports that to an
   * EventSource as nothing more than a dropped connection. So the console
   * hands the parameters over first and streams against a one-shot ticket.
   */
  const pendingRunParams = new Map<
    string,
    { recipeId: string; params: Record<string, unknown> }
  >();
  const previewDirectory = join(
    homedir(),
    "Movies",
    "Conductor",
    ".cinematic-previews",
  );
  let boundPort = options.port;

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.end();
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${host}`);

    // Guard 1: refuse a Host that is not loopback. A rebinding attack reaches
    // this port under a hostname it controls, and that name lands here.
    if (!isLoopbackHost(request.headers.host, boundPort)) {
      sendJson(response, 403, { error: "Conductor only answers to a loopback host." });
      return;
    }

    const corsOrigin = applyCorsHeaders(request, response, publicOrigin);

    // Answer both the legacy Private Network Access preflight and the normal
    // CORS preflight used by token-bearing requests. Current Chrome also puts
    // public → loopback behind a Local Network Access permission prompt; the
    // hosted page expects that prompt and does not attempt to suppress it.
    if (request.method === "OPTIONS") {
      const requestedMethod = request.headers["access-control-request-method"];
      const requestedHeaders = String(
        request.headers["access-control-request-headers"] ?? "",
      )
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      const allowedHeaders = new Set(["content-type", "x-conductor-token"]);
      if (
        corsOrigin === undefined ||
        (requestedMethod !== undefined && !["GET", "HEAD", "POST"].includes(requestedMethod)) ||
        requestedHeaders.some((header) => !allowedHeaders.has(header))
      ) {
        sendJson(response, 403, { error: "This cross-origin preflight is refused." });
        return;
      }
      response.setHeader("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "Content-Type, X-Conductor-Token");
      if (request.headers["access-control-request-private-network"] === "true") {
        response.setHeader("access-control-allow-private-network", "true");
      }
      response.writeHead(204, {
        "cache-control": "no-store",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }

    // Guard 2: refuse anything except the local UI, the one configured hosted
    // console, and loopback origins used for development.
    if (
      !isAllowedRequestSource(request.headers.origin, publicOrigin) ||
      !isAllowedRequestSource(request.headers.referer, publicOrigin)
    ) {
      sendJson(response, 403, { error: "Cross-site requests are refused." });
      return;
    }

    // The hosted document cannot receive a token through HTML injection. It
    // may bootstrap the same per-process token only when the browser supplies
    // an explicitly allowlisted Origin. Every operational route below still
    // requires that token exactly as the local page does.
    if (url.pathname === "/api/session" && request.method === "GET") {
      if (corsOrigin === undefined) {
        sendJson(response, 403, { error: "A trusted browser origin is required." });
        return;
      }
      sendJson(response, 200, { token: sessionToken });
      return;
    }

    if (
      (url.pathname === "/console.css" ||
        url.pathname === "/console.js") &&
      request.method === "GET"
    ) {
      const filename =
        url.pathname === "/console.css" ? "console.css" : "console.js";
      response.writeHead(200, {
        "content-type":
          filename.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(
        await readFile(new URL(`./${filename}`, import.meta.url), "utf8"),
      );
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        // The two same-origin console assets are the only executable resources.
        "content-security-policy":
          "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; form-action 'none'; frame-ancestors 'none'",
        "permissions-policy": "local-network=(self), loopback-network=(self)",
        "referrer-policy": "no-referrer",
      });
      response.end(renderConsoleHtml({ sessionToken, apiBase: "" }));
      return;
    }

    // Guard 3: every API route needs the token the page was served with.
    // A page on another origin cannot read this page, so it cannot obtain it.
    const presented = request.headers["x-conductor-token"] ?? url.searchParams.get("token");
    if (presented !== sessionToken) {
      sendJson(response, 403, {
        error: "Missing or stale session token. Reload the Conductor console.",
      });
      return;
    }

    if (url.pathname === "/api/recipes") {
      sendJson(response, 200, {
        recipes: listRecipes().map((recipe) => ({
          id: recipe.id,
          title: recipe.title,
          description: recipe.description,
          params: Object.fromEntries(
            Object.entries(recipe.params).filter(
              ([_name, definition]) => definition.internal !== true,
            ),
          ),
        })),
      });
      return;
    }

    if (url.pathname === "/api/doctor") {
      const config = await loadConductorConfig(options.configPath);
      const clients = new McpClientManager(config);
      try {
        const servers = [];
        for (const name of clients.serverNames) {
          const connection = await clients.get(name);
          const tools = await connection.listTools();
          servers.push({ name, toolCount: tools.length, tools: tools.map((tool) => tool.name) });
        }
        sendJson(response, 200, { ok: true, servers });
      } catch (error) {
        sendJson(response, 200, {
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
          sockets: await panelSocketCount(),
          servers: [],
        });
      } finally {
        await clients.closeAll();
      }
      return;
    }

    if (
      url.pathname === "/api/paths/validate" &&
      request.method === "POST"
    ) {
      const body = (await readJsonBody(request)) as { paths?: unknown };
      if (
        !Array.isArray(body.paths) ||
        body.paths.length > 250 ||
        body.paths.some(
          (path) => typeof path !== "string" || !path.startsWith("/"),
        )
      ) {
        sendJson(response, 400, {
          error: "Path validation requires at most 250 absolute paths.",
        });
        return;
      }
      const paths = await Promise.all(
        body.paths.map(async (path) => ({
          path,
          exists: await stat(path).then(() => true).catch(() => false),
          parentExists: await stat(dirname(path))
            .then((info) => info.isDirectory())
            .catch(() => false),
        })),
      );
      sendJson(response, 200, { paths });
      return;
    }

    /**
     * Reports what a clip actually is, before anything is built from it.
     *
     * The console needs the real duration to keep a control like "one loop
     * every 8 seconds" honest: the same request has to produce visibly the same
     * rate on a two-second comparison and on a two-minute master, and only the
     * duration can convert between them. Failure is reported as unavailable
     * rather than as an error — this is an enhancement to the form, and a
     * closed After Effects should not stop someone filling it in.
     */
    if (url.pathname === "/api/inspect-clip" && request.method === "POST") {
      const body = (await readJsonBody(request)) as { path?: string };
      const clipPath = String(body.path ?? "");
      if (!clipPath.startsWith("/")) {
        sendJson(response, 400, { error: "An absolute clip path is required." });
        return;
      }
      const config = await loadConductorConfig(options.configPath);
      const clients = new McpClientManager(config);
      try {
        const call = createAdapterRegistryFromConfig(config)
          .get("aftereffects")
          .mapCall("projectInfo", {
            action: "inspect",
            mediaPath: clipPath,
            settings: {
              includeColorMetadata: true,
              includeFrameRateAndDuration: true,
            },
          });
        const connection = await clients.get("aftereffects");
        const raw = await connection.callTool(call.tool, call.args, 60_000);
        const payload =
          (normalizeToolResult(raw) as { structuredContent?: Record<string, unknown> })
            .structuredContent ?? {};
        sendJson(response, 200, {
          available: typeof payload.durationSeconds === "number",
          width: payload.width,
          height: payload.height,
          frameRate: payload.frameRate,
          durationSeconds: payload.durationSeconds,
          previewDurationSeconds: payload.previewDurationSeconds,
          hasAudio: payload.hasAudio,
        });
      } catch (error) {
        sendJson(response, 200, {
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await clients.closeAll();
      }
      return;
    }

    if (url.pathname === "/api/cinematic/preview-output") {
      const look = url.searchParams.get("look") ?? "";
      if (!(CINEMATIC_LOOKS as readonly string[]).includes(look)) {
        sendJson(response, 400, { error: "Unknown cinematic look." });
        return;
      }
      await mkdir(previewDirectory, { recursive: true });
      // A still is written by After Effects itself and is a PNG; a moving
      // sample goes through the render queue and is an mp4.
      const extension = url.searchParams.get("kind") === "still" ? "png" : "mp4";
      sendJson(response, 200, {
        path: cinematicPreviewOutputPath(previewDirectory, look, undefined, extension),
      });
      return;
    }

    /**
     * Registers a sample and clears the ones it supersedes.
     *
     * Two things strand a sample: regenerating that look, and moving to a
     * different clip. Both are cleared here, so the cache holds at most one set
     * for the clip in front of you. Only Conductor's own preview folder is ever
     * touched, and only once the replacement has been verified.
     */
    const supersedePreviews = async (look: string, clip: string, keep: string) => {
      for (const [previousId, previous] of previewMedia) {
        const superseded = previous.look === look || previous.clip !== clip;
        if (!superseded || previous.files.includes(keep)) continue;
        previewMedia.delete(previousId);
        for (const stale of previous.files) {
          if (resolve(dirname(stale)) !== resolve(previewDirectory)) continue;
          await unlink(stale).catch(() => undefined);
        }
      }
    };

    const previewUrl = (id: string, kind: string) =>
      `/api/cinematic/media?id=${encodeURIComponent(id)}&kind=${kind}` +
      `&token=${encodeURIComponent(sessionToken)}`;

    if (
      url.pathname === "/api/cinematic/register-still" &&
      request.method === "POST"
    ) {
      const body = (await readJsonBody(request)) as {
        look?: string;
        path?: string;
        clip?: string;
      };
      const look = String(body.look ?? "");
      const path = String(body.path ?? "");
      const clip = String(body.clip ?? "");
      if (!(CINEMATIC_LOOKS as readonly string[]).includes(look)) {
        sendJson(response, 400, { error: "Unknown cinematic look." });
        return;
      }
      if (
        extname(path).toLowerCase() !== ".png" ||
        resolve(dirname(path)) !== resolve(previewDirectory)
      ) {
        sendJson(response, 400, {
          error: "A still must come from Conductor’s private preview folder.",
        });
        return;
      }
      const ffmpeg = await findExecutable(FFMPEG_CANDIDATES);
      if (ffmpeg === undefined) {
        sendJson(response, 500, { error: "ffmpeg is required to prepare a still." });
        return;
      }
      // After Effects returns from saveFrameToPng before the file is closed,
      // so the frame is waited for rather than assumed.
      const raw = await waitForFile(path, 8_000);
      if (!raw) {
        sendJson(response, 500, {
          error: "After Effects reported a saved frame, but no file appeared.",
        });
        return;
      }
      const imagePath = `${path.slice(0, -extname(path).length)}.display.jpg`;
      await execFileAsync(ffmpeg, cinematicStillDisplayArgs(path, imagePath), {
        timeout: 60_000,
        maxBuffer: 4_000_000,
      });
      await assertRenderedFile(imagePath);
      // The 16-bit frame was an intermediate — six megabytes of it — and the
      // displayable copy is verified, so it does not stay on disk.
      await unlink(path).catch(() => undefined);
      await supersedePreviews(look, clip, imagePath);
      const id = randomUUID();
      previewMedia.set(id, {
        look,
        clip,
        kind: "still",
        files: [imagePath],
        imagePath,
      });
      sendJson(response, 200, {
        id,
        look,
        kind: "still",
        imageUrl: previewUrl(id, "image"),
        thumbnailUrl: previewUrl(id, "image"),
      });
      return;
    }

    if (
      url.pathname === "/api/cinematic/register-preview" &&
      request.method === "POST"
    ) {
      const body = (await readJsonBody(request)) as {
        look?: string;
        path?: string;
        clip?: string;
      };
      const look = String(body.look ?? "");
      const path = String(body.path ?? "");
      const clip = String(body.clip ?? "");
      if (!(CINEMATIC_LOOKS as readonly string[]).includes(look)) {
        sendJson(response, 400, { error: "Unknown cinematic look." });
        return;
      }
      if (
        extname(path).toLowerCase() !== ".mp4" ||
        resolve(dirname(path)) !== resolve(previewDirectory)
      ) {
        sendJson(response, 400, {
          error: "Preview media must come from Conductor’s private preview folder.",
        });
        return;
      }
      await assertHlgDelivery(path);
      const ffmpeg = await findExecutable(FFMPEG_CANDIDATES);
      if (ffmpeg === undefined) {
        sendJson(response, 500, { error: "ffmpeg is required to prepare the preview viewer." });
        return;
      }
      const stem = path.slice(0, -extname(path).length);
      const videoPath = `${stem}.browser.m4v`;
      const thumbnailPath = `${stem}.jpg`;
      await execFileAsync(
        "/usr/bin/avconvert",
        cinematicPreviewProxyArgs(path, videoPath),
        { timeout: 180_000, maxBuffer: 4_000_000 },
      );
      await execFileAsync(
        ffmpeg,
        cinematicThumbnailArgs(videoPath, thumbnailPath),
        { timeout: 60_000, maxBuffer: 4_000_000 },
      );
      await assertRenderedFile(videoPath);
      await assertRenderedFile(thumbnailPath);
      await supersedePreviews(look, clip, videoPath);
      const id = randomUUID();
      previewMedia.set(id, {
        look,
        clip,
        kind: "clip",
        files: [path, videoPath, thumbnailPath],
        videoPath,
        thumbnailPath,
      });
      sendJson(response, 200, {
        id,
        look,
        kind: "clip",
        thumbnailUrl: previewUrl(id, "thumbnail"),
        videoUrl: previewUrl(id, "video"),
      });
      return;
    }

    if (url.pathname === "/api/cinematic/media" && request.method === "GET") {
      const media = previewMedia.get(url.searchParams.get("id") ?? "");
      const kind = url.searchParams.get("kind") ?? "";
      const file =
        kind === "video"
          ? media?.videoPath
          : kind === "thumbnail"
            ? media?.thumbnailPath
            : kind === "image"
              ? media?.imagePath
              : undefined;
      if (file === undefined) {
        sendJson(response, 404, { error: "Preview media not found." });
        return;
      }
      await streamLocalMedia(
        request,
        response,
        file,
        kind === "video" ? "video/mp4" : "image/jpeg",
      );
      return;
    }

    /**
     * One frame of the source clip, so the stage has something real to show
     * before any look has been generated. This is the clip untouched — no
     * grade, no HDR — which is exactly what makes it useful for judging where
     * a logo sits and how large a watermark reads.
     */
    if (url.pathname === "/api/source-frame" && request.method === "POST") {
      const body = (await readJsonBody(request)) as {
        clip?: string;
        timeSeconds?: number;
      };
      const clip = String(body.clip ?? "");
      if (!clip.startsWith("/")) {
        sendJson(response, 400, { error: "An absolute clip path is required." });
        return;
      }
      const ffmpeg = await findExecutable(FFMPEG_CANDIDATES);
      if (ffmpeg === undefined) {
        sendJson(response, 500, { error: "ffmpeg is required to read a frame." });
        return;
      }
      await mkdir(previewDirectory, { recursive: true });
      const framePath = join(previewDirectory, `source-frame-${randomUUID()}.jpg`);
      await execFileAsync(
        ffmpeg,
        sourceFrameArgs(clip, Number(body.timeSeconds ?? 0), framePath),
        { timeout: 60_000, maxBuffer: 4_000_000 },
      );
      await assertRenderedFile(framePath);
      for (const [previousId, previous] of previewMedia) {
        if (previous.look !== SOURCE_FRAME_KEY) continue;
        previewMedia.delete(previousId);
        for (const stale of previous.files) await unlink(stale).catch(() => undefined);
      }
      const id = randomUUID();
      previewMedia.set(id, {
        look: SOURCE_FRAME_KEY,
        clip,
        kind: "still",
        files: [framePath],
        imagePath: framePath,
      });
      sendJson(response, 200, { id, imageUrl: previewUrl(id, "image") });
      return;
    }

    /**
     * Serves a local image the person themselves chose — the brand logo — so
     * the stage can show the actual mark rather than a rectangle standing in
     * for one. Only paths returned by a Finder dialog, plus the bundled mark,
     * are ever readable.
     */
    if (url.pathname === "/api/local-image" && request.method === "GET") {
      const path = url.searchParams.get("path") ?? "";
      if (!displayableFiles.has(path)) {
        sendJson(response, 403, {
          error: "That file was not chosen in Conductor, so it is not readable.",
        });
        return;
      }
      const type = extname(path).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
      await streamLocalMedia(request, response, path, type);
      return;
    }

    /**
     * Opens a delivered render in QuickTime.
     *
     * Chrome cannot decode HEVC Main 10 HLG — a <video> pointed at the
     * delivery never even reports its duration — and the only way to show it
     * in the page would be an SDR proxy, which is precisely the degradation
     * this pipeline exists to avoid. QuickTime plays the delivered file itself,
     * in HDR, so that is what the console offers. Only files Conductor
     * delivered in this session can be opened.
     */
    if (url.pathname === "/api/delivery/open" && request.method === "POST") {
      const body = (await readJsonBody(request)) as { id?: string };
      const target = deliveredRenders.get(String(body.id ?? ""));
      if (target === undefined) {
        sendJson(response, 404, { error: "That delivery is not from this session." });
        return;
      }
      await execFileAsync("/usr/bin/open", ["-a", "QuickTime Player", target]);
      sendJson(response, 200, { opened: target });
      return;
    }

    if (url.pathname === "/api/dry-run" && request.method === "POST") {
      const body = (await readJsonBody(request)) as { recipeId?: string; params?: Record<string, unknown> };
      const recipe = getRecipe(String(body.recipeId ?? ""));
      if (recipe === undefined) {
        sendJson(response, 400, { error: `Unknown recipe '${String(body.recipeId)}'` });
        return;
      }
      // Preparation may decode local audio, but a dry run still never connects
      // to After Effects or mutates a project.
      const prepared = await prepareRecipeRun(recipe, body.params ?? {}, {
        analyzeAudio: cachedBeatAnalysis,
      });
      sendJson(
        response,
        200,
        createDryRunPlan(prepared.recipe, prepared.params),
      );
      return;
    }

    if (
      url.pathname === "/api/beat-sync/analyze" &&
      request.method === "POST"
    ) {
      const body = (await readJsonBody(request)) as {
        params?: Record<string, unknown>;
      };
      const recipe = getRecipe("beat-sync-edit");
      if (recipe === undefined) {
        sendJson(response, 500, { error: "Beat Sync Studio is not registered." });
        return;
      }
      const prepared = await prepareRecipeRun(recipe, body.params ?? {}, {
        analyzeAudio: cachedBeatAnalysis,
      });
      sendJson(response, 200, {
        beatCount: prepared.params.planBeatCount,
        cutCount: prepared.params.planCutCount,
        estimatedBpm: prepared.params.planEstimatedBpm,
        firstDownbeatSeconds: prepared.params.planFirstDownbeatSeconds,
        tempoOctave: prepared.params.tempoOctave,
        phaseNudge: prepared.params.phaseNudge,
        treatment: prepared.params.treatment,
        barCount: prepared.params.planBarCount,
        effectiveDensity: prepared.params.planEffectiveDensity,
        participatingBeatCount: prepared.params.planParticipatingBeatCount,
        treatmentKeyCount: prepared.params.planTreatmentKeyCount,
        treatmentEasingSeconds:
          prepared.params.planTreatmentEasingSeconds,
        tempoConfidence: prepared.params.planTempoConfidence,
        durationSeconds: prepared.params.planDurationSeconds,
        audioDurationSeconds: prepared.params.planAudioDurationSeconds,
        mediaDurationSeconds: prepared.params.planMediaDurationSeconds,
        durationLimit: prepared.params.planDurationLimit,
      });
      return;
    }

    if (url.pathname === "/api/choose" && request.method === "POST") {
      const body = (await readJsonBody(request)) as {
        mode?: string;
        prompt?: string;
        suggestedName?: string;
        multiple?: boolean;
      };
      const mode = body.mode === "save-file" ? "save-file" : "open-file";
      const chosen = await chooseFileViaFinder({
        mode,
        prompt: String(body.prompt ?? "Choose a file"),
        multiple: body.multiple === true,
        ...(body.suggestedName === undefined ? {} : { suggestedName: String(body.suggestedName) }),
      });
      // Picking a file in Finder is the person granting Conductor sight of it;
      // that grant is what /api/local-image checks against later.
      if (chosen.path !== undefined) displayableFiles.add(chosen.path);
      for (const path of chosen.paths ?? []) displayableFiles.add(path);
      sendJson(response, 200, chosen);
      return;
    }

    if (url.pathname === "/api/suggest-output") {
      // A blank required field is a dead end. Offer somewhere real to write,
      // already unique, that a person can accept or replace.
      const recipeId = (url.searchParams.get("recipe") ?? "render").replace(/[^a-z0-9-]/gi, "");
      const extension = (url.searchParams.get("ext") ?? "mov").replace(/[^a-z0-9]/gi, "");
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace("T", "-")
        .slice(0, 15);
      const directory = join(homedir(), "Movies", "Conductor");
      await mkdir(directory, { recursive: true });
      sendJson(response, 200, {
        path: join(directory, `${recipeId}-${stamp}.${extension}`),
      });
      return;
    }

    if (url.pathname === "/api/reveal" && request.method === "POST") {
      // Opens Finder at the file, or at its folder when it does not exist yet —
      // which is the normal case for a queued render.
      const body = (await readJsonBody(request)) as { path?: string };
      const target = String(body.path ?? "");
      if (target === "" || !target.startsWith("/")) {
        sendJson(response, 400, { error: "An absolute path is required." });
        return;
      }
      const exists = await stat(target).then(() => true).catch(() => false);
      await execFileAsync("/usr/bin/open", finderRevealArgs(target, exists));
      sendJson(response, 200, { revealed: exists ? target : dirname(target), fileExists: exists });
      return;
    }

    if (url.pathname === "/api/privacy-clean" && request.method === "POST") {
      const body = (await readJsonBody(request)) as { path?: string };
      try {
        const result = await createPrivacyCleanCopy(String(body.path ?? ""));
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (url.pathname === "/api/render" && request.method === "GET") {
      await streamRender(url, response);
      return;
    }

    if (url.pathname === "/api/run-params" && request.method === "POST") {
      const body = (await readJsonBody(request)) as {
        recipeId?: string;
        params?: Record<string, unknown>;
      };
      const recipeId = String(body.recipeId ?? "");
      if (getRecipe(recipeId) === undefined) {
        sendJson(response, 400, { error: `Unknown recipe '${recipeId}'` });
        return;
      }
      // A ticket is consumed by the run that follows it. Abandoned ones — a
      // reload between the two calls — must not accumulate.
      while (pendingRunParams.size >= 16) {
        const oldest = pendingRunParams.keys().next().value;
        if (oldest === undefined) break;
        pendingRunParams.delete(oldest);
      }
      const id = randomUUID();
      pendingRunParams.set(id, {
        recipeId,
        params: (body.params ?? {}) as Record<string, unknown>,
      });
      sendJson(response, 200, { id });
      return;
    }

    if (url.pathname === "/api/run") {
      await streamRun(url, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  }

  /**
   * Renders the exact queue items created by the preceding recipe and streams
   * aerender/ffmpeg output back.
   *
   * aerender works from a project file, not merely the in-memory project. An
   * existing project is saved in place. An untitled project is saved
   * automatically beside the delivery in a hidden Conductor project folder;
   * the render output path already supplied by the user is enough information.
   */
  async function streamRender(url: URL, response: ServerResponse): Promise<void> {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    const send = (event: string, data: unknown) => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const requestedIndices = parseRenderQueueIndices(url.searchParams.get("indices"));
    if (requestedIndices === undefined) {
      send("done", {
        status: "failed",
        error: "No valid render queue items were selected.",
      });
      response.end();
      return;
    }

    const aerender = await findAerender();
    if (aerender === undefined) {
      send("done", {
        status: "failed",
        error: "Could not find aerender. It ships with After Effects, inside its application folder.",
      });
      response.end();
      return;
    }

    const config = await loadConductorConfig(options.configPath);
    const clients = new McpClientManager(config);
    let projectPath: string | undefined;
    let queuedItems: Array<{ index: number; renderPath: string }> = [];
    try {
      // Ask After Effects to flush the project to disk and report where it lives.
      const connection = await clients.get("aftereffects");
      let raw = await connection.callTool(
        "execute_extend_script",
        { script_string: renderProjectStateScript() },
        30_000,
      );
      let payload =
        (normalizeToolResult(raw) as { structuredContent?: Record<string, unknown> })
          .structuredContent ?? {};

      if (payload.saved !== true) {
        const deliveryPath = pendingRenders.get(requestedIndices[0] as number)?.outputPath;
        if (deliveryPath === undefined) {
          throw new Error("Conductor lost the output path for this untitled project.");
        }
        const projectPathForDelivery = automaticProjectPath(deliveryPath);
        await mkdir(dirname(projectPathForDelivery), { recursive: true });
        raw = await connection.callTool(
          "execute_extend_script",
          { script_string: renderProjectStateScript(projectPathForDelivery) },
          30_000,
        );
        payload =
          (normalizeToolResult(raw) as { structuredContent?: Record<string, unknown> })
            .structuredContent ?? {};
      }

      if (payload.saved !== true || typeof payload.path !== "string") {
        throw new Error("After Effects did not report a saved project path.");
      }
      projectPath = payload.path;
      queuedItems = Array.isArray(payload.queuedItems)
        ? payload.queuedItems.flatMap((value) => {
          if (
            typeof value !== "object" ||
            value === null ||
            !Number.isInteger((value as { index?: unknown }).index) ||
            typeof (value as { renderPath?: unknown }).renderPath !== "string"
          ) {
            return [];
          }
          return [{
            index: (value as { index: number }).index,
            renderPath: (value as { renderPath: string }).renderPath,
          }];
        })
        : [];
    } catch (error) {
      send("done", {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      response.end();
      return;
    } finally {
      await clients.closeAll();
    }

    const unavailable = requestedIndices.filter(
      (index) => !queuedItems.some((item) => item.index === index),
    );
    if (unavailable.length > 0) {
      send("done", {
        status: "failed",
        error:
          `Render queue item${unavailable.length === 1 ? "" : "s"} `
          + `${unavailable.join(", ")} ${unavailable.length === 1 ? "is" : "are"} no longer queued.`,
      });
      response.end();
      return;
    }

    send("start", { projectPath, indices: requestedIndices, aerender });
    let tail = "";
    const runProcess = async (
      command: string,
      args: string[],
      renderQueueIndex: number,
    ): Promise<number> => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const emit = (chunk: Buffer, stream: "out" | "err") => {
        tail = (tail + chunk.toString("utf8")).slice(-4_000);
        for (const line of chunk.toString("utf8").split("\n")) {
          const text = line.trim();
          if (text !== "") send("log", { stream, text, renderQueueIndex });
        }
      };
      child.stdout.on("data", (chunk: Buffer) => emit(chunk, "out"));
      child.stderr.on("data", (chunk: Buffer) => emit(chunk, "err"));
      return await new Promise<number>((resolve) => {
        child.on("close", (exitCode) => resolve(exitCode ?? -1));
        child.on("error", (error) => {
          tail = (tail + `\n${error.message}`).slice(-4_000);
          resolve(-1);
        });
      });
    };

    const delivered: string[] = [];
    const deliveredIds: Array<{ id: string; outputPath: string }> = [];
    const beatSyncVerification: BeatSyncVerificationReport[] = [];
    for (let position = 0; position < requestedIndices.length; position += 1) {
      const renderQueueIndex = requestedIndices[position] as number;
      const queuedItem = queuedItems.find((item) => item.index === renderQueueIndex);
      if (queuedItem === undefined) continue;
      const pending = pendingRenders.get(renderQueueIndex) ?? {
        outputPath: queuedItem.renderPath,
        renderPath: queuedItem.renderPath,
        templateApplied: null,
      };
      send("item", {
        status: "started",
        renderQueueIndex,
        position: position + 1,
        total: requestedIndices.length,
      });

      try {
        const before = await stat(pending.renderPath).catch(() => undefined);
        if (pending.postProcess !== undefined) {
          // This is an internal intermediate, never a user-authored file.
          await unlink(pending.renderPath).catch(() => undefined);
        }
        const renderCode = await runProcess(
          aerender,
          aerenderArgs(projectPath, renderQueueIndex),
          renderQueueIndex,
        );
        if (renderCode !== 0) {
          throw new Error(`aerender exited with code ${renderCode}.`);
        }
        await assertRenderedFile(pending.renderPath);
        const after = await stat(pending.renderPath);
        if (
          before !== undefined &&
          before.size === after.size &&
          before.mtimeMs === after.mtimeMs
        ) {
          throw new Error(
            `Adobe exited successfully but did not update ${pending.renderPath}`,
          );
        }

        if (pending.postProcess === "hevc-hlg") {
          const ffmpeg = await findExecutable(FFMPEG_CANDIDATES);
          if (ffmpeg === undefined) {
            throw new Error("ffmpeg is required for 10-bit HLG delivery, but it was not found.");
          }
          await mkdir(dirname(pending.outputPath), { recursive: true });
          const partialPath = `${pending.outputPath}.conductor-partial.mp4`;
          await unlink(partialPath).catch(() => undefined);
          send("item", {
            status: "encoding",
            renderQueueIndex,
            position: position + 1,
            total: requestedIndices.length,
          });
          const encodeCode = await runProcess(
            ffmpeg,
            hevcHlgArgs(pending.renderPath, partialPath),
            renderQueueIndex,
          );
          if (encodeCode !== 0) {
            throw new Error(`HLG encoding exited with code ${encodeCode}.`);
          }
          await assertHlgDelivery(partialPath);
          await rename(partialPath, pending.outputPath);
          await assertHlgDelivery(pending.outputPath);
          await unlink(pending.renderPath).catch(() => undefined);
        } else {
          await assertRenderedFile(pending.outputPath);
        }

        if (pending.beatSync !== undefined) {
          const ffmpeg = await findExecutable(FFMPEG_CANDIDATES);
          if (ffmpeg === undefined) {
            throw new Error(
              "ffmpeg is required for rendered A/V beat-sync verification, but it was not found.",
            );
          }
          const ffprobe = await findExecutable(FFPROBE_CANDIDATES);
          if (ffprobe === undefined) {
            throw new Error(
              "ffprobe is required for beat-sync verification, but it was not found.",
            );
          }
          const verification = await verifyRenderedBeatSync({
            outputPath: pending.outputPath,
            requestedFrameRate: pending.beatSync.requestedFrameRate,
            cuts: pending.beatSync.cuts,
            ffmpegPath: ffmpeg,
            ffprobePath: ffprobe,
          });
          await recordBeatSyncVerification(
            pending.beatSync.journalPath,
            verification,
          );
          beatSyncVerification.push(verification);
          send("beat-sync-verification", verification);
          const placement = verification.framePlacement;
          const endToEnd = verification.endToEndAlignment;
          process.stdout.write(
            placement.status === "not-applicable"
              ? "Beat Sync authored frame placement: no cut events were enabled.\n"
              : `Beat Sync authored frame placement: ${placement.cutsWithinHalfFrame} of ${placement.cutCount} cuts within half a frame; `
                + `max ${(placement.maxDeviationSeconds * 1_000).toFixed(3)} ms, `
                + `mean ${(placement.meanDeviationSeconds * 1_000).toFixed(3)} ms.\n`,
          );
          process.stdout.write(
            endToEnd.status === "not-applicable"
              ? "Beat Sync rendered A/V conformance: no authored visual cuts to compare.\n"
              : `Beat Sync rendered A/V conformance: detected ${endToEnd.detectedVisualCutCount} visual cuts and `
                + `${endToEnd.detectedAudioOnsetCount} audio onsets; ${endToEnd.cutsWithinHalfFrame} cuts within half a frame, `
                + `${endToEnd.cutsWithinOneFrame} within one frame; max `
                + `${endToEnd.maxDeviationSeconds === null ? "unmeasurable" : `${(endToEnd.maxDeviationSeconds * 1_000).toFixed(3)} ms`}, `
                + `mean ${endToEnd.meanDeviationSeconds === null ? "unmeasurable" : `${(endToEnd.meanDeviationSeconds * 1_000).toFixed(3)} ms`}.\n`,
          );
          assertBeatSyncVerification(verification);
        }

        delivered.push(pending.outputPath);
        // Addressable by id so the console can offer to play it without ever
        // handing a path back to the server.
        deliveredIds.push({ id: randomUUID(), outputPath: pending.outputPath });
        deliveredRenders.set(
          deliveredIds[deliveredIds.length - 1]!.id,
          pending.outputPath,
        );
        pendingRenders.delete(renderQueueIndex);
      } catch (error) {
        send("done", {
          status: "failed",
          renderQueueIndex,
          error: error instanceof Error ? error.message : String(error),
          tail,
        });
        response.end();
        return;
      }

      send("item", {
        status: "completed",
        renderQueueIndex,
        position: position + 1,
        total: requestedIndices.length,
      });
    }

    send("done", {
      status: "completed",
      rendered: requestedIndices.length,
      outputPaths: delivered,
      deliveries: deliveredIds,
      projectPath,
      ...(beatSyncVerification.length === 0
        ? {}
        : { beatSyncVerification }),
    });
    response.end();
  }

  /** Streams step-by-step progress; a recipe can spend a minute inside After Effects. */
  async function streamRun(url: URL, response: ServerResponse): Promise<void> {
    // A ticket from /api/run-params, or — for a small call by hand — the
    // recipe and parameters directly.
    const ticket = url.searchParams.get("run");
    const claimed = ticket === null ? undefined : pendingRunParams.get(ticket);
    if (ticket !== null) {
      if (claimed === undefined) {
        sendJson(response, 400, {
          error: "That run was already started, or its parameters expired. Try again.",
        });
        return;
      }
      pendingRunParams.delete(ticket);
    }

    const recipe = getRecipe(claimed?.recipeId ?? url.searchParams.get("recipe") ?? "");
    if (recipe === undefined) {
      sendJson(response, 400, { error: "Unknown recipe" });
      return;
    }

    let params: Record<string, unknown> = claimed?.params ?? {};
    if (claimed === undefined) {
      try {
        params = JSON.parse(url.searchParams.get("params") ?? "{}") as Record<string, unknown>;
      } catch {
        sendJson(response, 400, { error: "Parameters were not valid JSON" });
        return;
      }
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });

    const send = (event: string, data: unknown) => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const config = await loadConductorConfig(options.configPath);
    const clients = new McpClientManager(config);
    try {
      const prepared = await prepareRecipeRun(recipe, params, {
        analyzeAudio: cachedBeatAnalysis,
      });
      const result = await new RecipeEngine({
        clientProvider: clients,
        adapters: createAdapterRegistryFromConfig(config),
        onStep: (step: JournalStep) => send("step", step),
      }).run(prepared.recipe, prepared.params);
      /*
       * A recipe QUEUES a render; it does not run one. Saying "finished" and
       * showing the path someone typed sent them looking for a file that does
       * not exist — and After Effects rewrites the extension to match the
       * output module, so even the path was wrong. Report what was actually
       * queued, using the path After Effects resolved.
       */
      const queued: Array<{
        outputPath: string;
        renderPath: string;
        renderQueueIndex: number;
        postProcess?: "hevc-hlg";
        templateApplied: string | null;
      }> = [];
      let beatSync:
        | {
            journalPath: string;
            requestedFrameRate: number;
            cuts: BeatSyncCutPlacement[];
          }
        | undefined;
      if (recipe.id === "beat-sync-edit") {
        const placementPayload = (
          result.outputs["place-beat-sync-media"] as {
            structuredContent?: { placements?: unknown };
          } | undefined
        )?.structuredContent?.placements;
        const cuts = Array.isArray(placementPayload)
          ? placementPayload.flatMap((placement) => {
              const value = placement as Record<string, unknown>;
              return Number.isInteger(value.cutFrame) &&
                Number.isInteger(value.actualFrame) &&
                typeof value.intendedOnsetSeconds === "number"
                ? [{
                    cutFrame: value.cutFrame as number,
                    actualFrame: value.actualFrame as number,
                    intendedOnsetSeconds: value.intendedOnsetSeconds,
                  }]
                : [];
            })
          : [];
        const plannedCutCount = prepared.params.planCutCount;
        if (
          typeof plannedCutCount !== "number" ||
          cuts.length !== plannedCutCount
        ) {
          throw new Error(
            `After Effects reported ${cuts.length} placed cuts for a ${String(plannedCutCount)}-cut beat plan.`,
          );
        }
        beatSync = {
          journalPath: result.journalPath,
          requestedFrameRate: prepared.params.frameRate as number,
          cuts,
        };
      }
      for (const value of Object.values(result.outputs)) {
        const payload = (value as { structuredContent?: Record<string, unknown> })
          ?.structuredContent;
        if (
          payload?.queued === true &&
          typeof payload.outputPath === "string" &&
          typeof payload.renderPath === "string" &&
          typeof payload.renderQueueIndex === "number"
        ) {
          const entry: PendingRender & { renderQueueIndex: number } = {
            outputPath: payload.outputPath,
            renderPath: payload.renderPath,
            renderQueueIndex: payload.renderQueueIndex,
            ...(payload.postProcess === "hevc-hlg"
              ? { postProcess: "hevc-hlg" as const }
              : {}),
            templateApplied:
              typeof payload.templateApplied === "string" ? payload.templateApplied : null,
            ...(beatSync === undefined ? {} : { beatSync }),
          };
          queued.push({
            outputPath: entry.outputPath,
            renderPath: entry.renderPath,
            renderQueueIndex: entry.renderQueueIndex,
            ...(entry.postProcess === undefined
              ? {}
              : { postProcess: entry.postProcess }),
            templateApplied: entry.templateApplied,
          });
          pendingRenders.set(entry.renderQueueIndex, entry);
        }
      }
      send("done", {
        status: "completed",
        runId: result.runId,
        journalPath: result.journalPath,
        queued,
      });
    } catch (error) {
      // "failed validation" alone is useless. Zod already knows which field and
      // why, so pass that through rather than discarding it.
      const details = (error as { details?: unknown }).details;
      const fieldErrors = Array.isArray(details)
        ? details.map((issue) => {
          const record = issue as { path?: unknown[]; message?: string };
          const field = Array.isArray(record.path) ? record.path.join(".") : "";
          return field === "" ? String(record.message) : `${field}: ${String(record.message)}`;
        })
        : [];
      send("done", {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        fieldErrors,
      });
    } finally {
      await clients.closeAll();
      response.end();
    }
  }

  // Samples from sessions that were closed or killed have nothing pointing at
  // them any more, so nothing would ever clear them. A day is long enough that
  // a second console running right now keeps its own.
  await sweepStalePreviews(previewDirectory, 24 * 60 * 60 * 1000);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  // Port 0 asks the OS to choose, so the guards must check the real port.
  boundPort = port;

  return {
    url: `http://${host}:${port}/`,
    publicOrigin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
