import { registerProviderHooks, registerCompatModeHooks } from "../index.js";
import { mimoAnthropicHooks } from "./mimo.js";
import { kimiCodingAnthropicHooks } from "./kimi-coding.js";

/** Register all provider-specific hooks. Call once at startup. */
export function registerAllProviderHooks(): void {
  registerProviderHooks("MiMo", { anthropic: mimoAnthropicHooks });

  // compat_mode driven hooks (config-based, not name-dependent)
  registerCompatModeHooks("input_includes_cached", { anthropic: kimiCodingAnthropicHooks });
}
