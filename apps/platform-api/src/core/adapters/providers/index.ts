import { registerProviderHooks } from "../index.js";
import { mimoAnthropicHooks } from "./mimo.js";
import { kimiCodingAnthropicHooks } from "./kimi-coding.js";

/** Register all provider-specific hooks. Call once at startup. */
export function registerAllProviderHooks(): void {
  registerProviderHooks("MiMo", { anthropic: mimoAnthropicHooks });
  registerProviderHooks("Kimi Code", { anthropic: kimiCodingAnthropicHooks });
}
