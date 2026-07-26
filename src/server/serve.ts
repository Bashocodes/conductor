import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createAdapterRegistryFromConfig } from "../adapters/registry.js";
import { RecipeEngine } from "../engine/engine.js";
import { createDryRunPlan } from "../engine/dry-run.js";
import type { JournalStep } from "../engine/journal.js";
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
 * **Bound to 127.0.0.1 only.** This process starts local programs and drives
 * the creative applications you have open. Nothing off this machine can reach
 * it, which is why it needs no authentication and sends no CORS headers.
 */

const execFileAsync = promisify(execFile);

export interface ServeOptions {
  configPath: string;
  port: number;
  host?: string;
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

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      });
      response.end(CONSOLE_HTML);
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

    if (url.pathname === "/api/run") {
      await streamRun(url, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
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
      send("done", { status: "completed", runId: result.runId, journalPath: result.journalPath });
    } catch (error) {
      send("done", { status: "failed", error: error instanceof Error ? error.message : String(error) });
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

  return {
    url: `http://${host}:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
