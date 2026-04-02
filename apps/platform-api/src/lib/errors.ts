export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

/* ── Format-aware API error responses ── */

export interface XllmapiErrorMeta {
  requestId?: string;
  resetAt?: string;
  [key: string]: unknown;
}

/**
 * Build a spec-compliant error response body for the given client format.
 * - OpenAI: { error: { message, type, param, code }, xllmapi?: {...} }
 * - Anthropic: { type: "error", error: { type, message }, xllmapi?: {...} }
 *
 * The `xllmapi` extension field carries platform-specific metadata (requestId, etc.)
 * that SDKs will ignore but xllmapi tooling can consume.
 */
export function formatApiError(
  clientFormat: "openai" | "anthropic",
  statusCode: number,
  message: string,
  meta?: XllmapiErrorMeta,
): Record<string, unknown> {
  const xllmapi = meta && Object.keys(meta).length > 0 ? { xllmapi: meta } : {};

  if (clientFormat === "anthropic") {
    return {
      type: "error",
      error: {
        type: mapHttpToAnthropicErrorType(statusCode),
        message,
      },
      ...xllmapi,
    };
  }
  // OpenAI format (default)
  return {
    error: {
      message,
      type: mapHttpToOpenaiErrorType(statusCode),
      param: null,
      code: null,
    },
    ...xllmapi,
  };
}

function mapHttpToOpenaiErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 429) return "rate_limit_error";
  if (status === 400 || status === 402 || status === 404) return "invalid_request_error";
  return "server_error";
}

function mapHttpToAnthropicErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 429) return "rate_limit_error";
  if (status === 400) return "invalid_request_error";
  if (status === 404) return "not_found_error";
  if (status === 529) return "overloaded_error";
  return "api_error";
}

export const ErrorCodes = {
  UNAUTHORIZED: "unauthorized",
  INSUFFICIENT_BALANCE: "insufficient_balance",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  RATE_LIMITED: "rate_limited",
  NOT_FOUND: "not_found",
  INVALID_INPUT: "invalid_input",
  DUPLICATE_KEY: "duplicate_provider_key",
} as const;
