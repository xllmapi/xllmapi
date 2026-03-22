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

export const ErrorCodes = {
  UNAUTHORIZED: "unauthorized",
  INSUFFICIENT_BALANCE: "insufficient_balance",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  RATE_LIMITED: "rate_limited",
  NOT_FOUND: "not_found",
  INVALID_INPUT: "invalid_input",
  DUPLICATE_KEY: "duplicate_provider_key",
} as const;
