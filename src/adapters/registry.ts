import type { ConductorConfig } from "../mcp/config.js";
import { DeclarativeToolAdapter, AdapterError } from "./adapter.js";
import type { AdapterConfig } from "./config.js";
import { genericAeAdapterConfig } from "./configs/genericAe.js";

export class AdapterRegistry {
  readonly #adapters = new Map<string, DeclarativeToolAdapter>();

  public constructor(configs: Record<string, AdapterConfig> = {}) {
    for (const [serverName, config] of Object.entries(configs)) {
      this.register(serverName, config);
    }
  }

  public register(serverName: string, config: AdapterConfig): void {
    this.#adapters.set(
      serverName,
      new DeclarativeToolAdapter(serverName, config),
    );
  }

  public get(serverName: string): DeclarativeToolAdapter {
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

export function createDefaultAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry({
    aftereffects: genericAeAdapterConfig,
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
      registry.register(serverName, genericAeAdapterConfig);
    }
  }

  return registry;
}
