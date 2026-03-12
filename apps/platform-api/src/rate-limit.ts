type BucketState = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, BucketState>();

export const consumeRateLimit = (params: {
  key: string;
  limit: number;
  windowMs: number;
}) => {
  const now = Date.now();
  const current = buckets.get(params.key);

  if (!current || current.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + params.windowMs
    };
    buckets.set(params.key, next);
    return {
      ok: true as const,
      remaining: params.limit - 1,
      resetAt: next.resetAt
    };
  }

  if (current.count >= params.limit) {
    return {
      ok: false as const,
      remaining: 0,
      resetAt: current.resetAt
    };
  }

  current.count += 1;
  return {
    ok: true as const,
    remaining: params.limit - current.count,
    resetAt: current.resetAt
  };
};
