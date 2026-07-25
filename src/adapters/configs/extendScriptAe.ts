import { scriptAdapterConfigSchema } from "../config.js";

/**
 * The After Effects MCP servers people actually run.
 *
 * Rather than one tool per operation, these expose a single
 * `execute_extend_script` and let the caller send a program. Verified against a
 * live After Effects 26.3 over the AfterEffects MCP Agent CEP panel.
 *
 * If your server names that tool differently, copy this config and change
 * `tool` — everything else is generated.
 */
export const extendScriptAeAdapterConfig = scriptAdapterConfigSchema.parse({
  kind: "script",
  id: "extendscript-ae",
  label: "After Effects via execute_extend_script (single-tool server)",
  dialect: "extendscript-ae",
  tool: "execute_extend_script",
  scriptArgument: "script_string",
});
