const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // fetch network errors: ECONNREFUSED, ECONNRESET, UND_ERR_CONNECT_TIMEOUT
    return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  return false;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number; signal?: AbortSignal }
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelay = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1 && isRetryableError(err)) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
