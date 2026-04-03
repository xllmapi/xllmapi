/**
 * Re-export unified usage parser from @xllmapi/core.
 * Platform-api adapters import from here for convenience.
 */
export { parseRawUsage, mergeUsage, ZERO_USAGE, detectUsageFormat } from "@xllmapi/core";
export type { ParsedUsage } from "@xllmapi/core";

// ProxyUsage and ParsedUsage are structurally identical — ParsedUsage is the
// canonical definition in @xllmapi/core, ProxyUsage is the platform-api alias.
