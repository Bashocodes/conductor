import type { ConductorConfig } from "../mcp/config.js";
import { AdapterError, DeclarativeToolAdapter, type ToolAdapter } from "./adapter.js";
import { adapterConfigSchema, type AdapterConfig } from "./config.js";
import { extendScriptAeAdapterConfig } from "./configs/extendScriptAe.js";
import { ScriptToolAdapter } from "./extendscript/adapter.js";

function createAdapter(serverName: string, config: AdapterConfig): ToolAdapter {
  if (config.kind === "script") {
    return new ScriptToolAdapter(serverName, config);
  }
  return new DeclarativeToolAdapter(serverName, config);
}

export class AdapterRegistry {
  readonly #adapters = new Map<string, ToolAdapter>();

  public constructor(configs: Record<string, AdapterConfig> = {}) {
    for (const [serverName, config] of Object.entries(configs)) {
      this.register(serverName, config);
    }
  }

  public register(serverName: string, config: unknown): void {
    const parsed = adapterConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new AdapterError(
        "ADAPTER_INVALID",
        `Adapter config for server '${serverName}' failed validation`,
        { details: parsed.error.issues },
      );
    }
    this.#adapters.set(serverName, createAdapter(serverName, parsed.data));
  }

  public get(serverName: string): ToolAdapter {
    const adapter = this.#adapters.get(serverName);
    if (adapter === undefined) {
      throw new AdapterError(
        "ADAPTER_INVALID",
        `No ToolContract adapter is configured for server '${serverName}'`,
      );
    }
    return adapter;
  }
}

/**
 * Defaults to the single-tool ExtendScript adapter for After Effects, because
 * that is the shape of the servers that exist and the one verified against a
 * live host. Servers with granular tools declare a `declarative` adapter in
 * conductor.config.json.
 */
export function createDefaultAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry({
    aftereffects: extendScriptAeAdapterConfig,
  });
}

export function createAdapterRegistryFromConfig(
  config: ConductorConfig,
): AdapterRegistry {
  const registry = new AdapterRegistry();

  for (const [serverName, server] of Object.entries(config.servers)) {
    if (server.adapter !== undefined) {
      registry.register(serverName, server.adapter);
    } else if (serverName === "aftereffects") {
      registry.register(serverName, extendScriptAeAdapterConfig);
    }
  }

  return registry;
}
