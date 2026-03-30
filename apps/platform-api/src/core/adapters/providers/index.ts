import { registerProviderHooks } from "../index.js";
import { mimoAnthropicHooks } from "./mimo.js";

/** Register all provider-specific hooks. Call once at startup. */
export function registerAllProviderHooks(): void {
  registerProviderHooks("MiMo", { anthropic: mimoAnthropicHooks });
}
