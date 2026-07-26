import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, stat } from "node:fs/promises";

import { createAdapterRegistryFromConfig } from "../adapters/registry.js";
import { RecipeEngine } from "../engine/engine.js";
import { createDryRunPlan } from "../engine/dry-run.js";
import type { JournalStep } from "../engine/journal.js";
import { normalizeToolResult } from "../engine/normalizeResult.js";
import { loadConductorConfig } from "../mcp/config.js";
import { McpClientManager } from "../mcp/client.js";
import { getRecipe, listRecipes } from "../recipes/index.js";
import { CONSOLE_HTML } from "./page.js";

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

function isSameOrigin(value: string | undefined, port: number): boolean {
  if (value === undefined || value === "" || value === "null") return true;
  try {
    const origin = new URL(value);
    return (
      origin.protocol === "http:" &&
      (origin.hostname === "127.0.0.1" || origin.hostname === "localhost" || origin.hostname === "::1") &&
      origin.port === String(port)
    );
  } catch {
    return false;
  }
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
}): Promise<{ path?: string; cancelled?: boolean }> {
  // The prompt is the only caller-influenced value; quotes are escaped so it
  // cannot terminate the AppleScript string.
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const script =
    options.mode === "open-file"
      ? `POSIX path of (choose file with prompt ${quote(options.prompt)})`
      : `POSIX path of (choose file name with prompt ${quote(options.prompt)}` +
        (options.suggestedName === undefined
          ? ")"
          : ` default name ${quote(options.suggestedName)})`);

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
      timeout: 300_000,
    });
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
 * `-reuse` hands the work to the instance already open rather than launching a
 * second one, which also means it will not quit the application afterwards.
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
  return ["-reuse", "-project", projectPath, "-rqindex", String(renderQueueIndex)];
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
    "var queuedIndices = [];\n" +
    "for (var i = 1; i <= p.renderQueue.numItems; i++) {\n" +
    "  if (p.renderQueue.item(i).status === RQItemStatus.QUEUED) { queuedIndices.push(i); }\n" +
    "}\n" +
    "return { saved: true, path: p.file.fsName, queuedIndices: queuedIndices };"
  );
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

export async function startConductorServer(options: ServeOptions): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const host = options.host ?? "127.0.0.1";
  // New every start, so a token cannot outlive the session it belongs to.
  const sessionToken = randomUUID();
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

    // Guard 2: refuse anything a different site initiated.
    if (
      !isSameOrigin(request.headers.origin, boundPort) ||
      !isSameOrigin(request.headers.referer, boundPort)
    ) {
      sendJson(response, 403, { error: "Cross-site requests are refused." });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        // Nothing external loads; say so, so an injection has nowhere to go.
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
      });
      response.end(CONSOLE_HTML.replace("__CONDUCTOR_SESSION_TOKEN__", sessionToken));
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
          params: recipe.params,
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

    if (url.pathname === "/api/dry-run" && request.method === "POST") {
      const body = (await readJsonBody(request)) as { recipeId?: string; params?: Record<string, unknown> };
      const recipe = getRecipe(String(body.recipeId ?? ""));
      if (recipe === undefined) {
        sendJson(response, 400, { error: `Unknown recipe '${String(body.recipeId)}'` });
        return;
      }
      // A dry run never connects to anything, so it is always safe to click.
      sendJson(response, 200, createDryRunPlan(recipe, body.params ?? {}));
      return;
    }

    if (url.pathname === "/api/choose" && request.method === "POST") {
      const body = (await readJsonBody(request)) as {
        mode?: string;
        prompt?: string;
        suggestedName?: string;
      };
      const mode = body.mode === "save-file" ? "save-file" : "open-file";
      const chosen = await chooseFileViaFinder({
        mode,
        prompt: String(body.prompt ?? "Choose a file"),
        ...(body.suggestedName === undefined ? {} : { suggestedName: String(body.suggestedName) }),
      });
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

    if (url.pathname === "/api/render" && request.method === "GET") {
      await streamRender(url, response);
      return;
    }

    if (url.pathname === "/api/run") {
      await streamRun(url, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  }

  /**
   * Runs everything sitting in After Effects' render queue, and streams
   * aerender's own output back.
   *
   * aerender works from a project file, not merely the in-memory project. An
   * existing project is saved in place; for an untitled project, Conductor
   * opens a Finder Save dialog and then asks After Effects to save there.
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
    let queuedIndices: number[] = [];
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
        const chosen = await chooseFileViaFinder({
          mode: "save-file",
          prompt: "Save the After Effects project so Conductor can render it.",
          suggestedName: "Conductor Project.aep",
        });
        if (chosen.path === undefined) {
          send("done", {
            status: "failed",
            error: "Rendering was cancelled because the After Effects project was not saved.",
          });
          response.end();
          return;
        }
        raw = await connection.callTool(
          "execute_extend_script",
          { script_string: renderProjectStateScript(chosen.path) },
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
      queuedIndices = Array.isArray(payload.queuedIndices)
        ? payload.queuedIndices.filter(
          (value): value is number => Number.isInteger(value) && Number(value) > 0,
        )
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

    const unavailable = requestedIndices.filter((index) => !queuedIndices.includes(index));
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
    for (let position = 0; position < requestedIndices.length; position += 1) {
      const renderQueueIndex = requestedIndices[position] as number;
      send("item", {
        status: "started",
        renderQueueIndex,
        position: position + 1,
        total: requestedIndices.length,
      });

      // -reuse drives the instance already open rather than starting a second
      // one. -rqindex prevents old queue entries from rendering by surprise.
      const child = spawn(aerender, aerenderArgs(projectPath, renderQueueIndex), {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const emit = (chunk: Buffer, stream: "out" | "err") => {
        tail = (tail + chunk.toString("utf8")).slice(-4_000);
        for (const line of chunk.toString("utf8").split("\n")) {
          const text = line.trim();
          if (text !== "") send("log", { stream, text, renderQueueIndex });
        }
      };
      child.stdout.on("data", (chunk: Buffer) => emit(chunk, "out"));
      child.stderr.on("data", (chunk: Buffer) => emit(chunk, "err"));

      const code = await new Promise<number>((resolve) => {
        child.on("close", (exitCode) => resolve(exitCode ?? -1));
        child.on("error", () => resolve(-1));
      });
      if (code !== 0) {
        send("done", {
          status: "failed",
          exitCode: code,
          renderQueueIndex,
          error: `aerender exited with code ${code}.`,
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

    send("done", { status: "completed", rendered: requestedIndices.length });
    response.end();
  }

  /** Streams step-by-step progress; a recipe can spend a minute inside After Effects. */
  async function streamRun(url: URL, response: ServerResponse): Promise<void> {
    const recipe = getRecipe(url.searchParams.get("recipe") ?? "");
    if (recipe === undefined) {
      sendJson(response, 400, { error: "Unknown recipe" });
      return;
    }

    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(url.searchParams.get("params") ?? "{}") as Record<string, unknown>;
    } catch {
      sendJson(response, 400, { error: "Parameters were not valid JSON" });
      return;
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
      const result = await new RecipeEngine({
        clientProvider: clients,
        adapters: createAdapterRegistryFromConfig(config),
        onStep: (step: JournalStep) => send("step", step),
      }).run(recipe, params);
      /*
       * A recipe QUEUES a render; it does not run one. Saying "finished" and
       * showing the path someone typed sent them looking for a file that does
       * not exist — and After Effects rewrites the extension to match the
       * output module, so even the path was wrong. Report what was actually
       * queued, using the path After Effects resolved.
       */
      const queued: Array<{
        outputPath: string;
        renderQueueIndex: number;
        templateApplied: string | null;
      }> = [];
      for (const value of Object.values(result.outputs)) {
        const payload = (value as { structuredContent?: Record<string, unknown> })
          ?.structuredContent;
        if (
          payload?.queued === true &&
          typeof payload.outputPath === "string" &&
          typeof payload.renderQueueIndex === "number"
        ) {
          queued.push({
            outputPath: payload.outputPath,
            renderQueueIndex: payload.renderQueueIndex,
            templateApplied:
              typeof payload.templateApplied === "string" ? payload.templateApplied : null,
          });
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
