import { createClient } from "redis";

import { config } from "./config.js";
import { consumeRateLimit as consumeInMemoryRateLimit } from "./rate-limit.js";

type CachedValue = {
  value: string;
  source: "redis" | "memory";
};

const memoryResponseCache = new Map<string, { value: string; expiresAt: number }>();

type RedisClientLike = ReturnType<typeof createClient>;

let redisClientPromise: Promise<RedisClientLike | null> | null = null;

const getRedisClient = async () => {
  if (!config.redisUrl) {
    return null;
  }

  if (redisClientPromise) {
    return redisClientPromise;
  }

  redisClientPromise = (async () => {
    const client = createClient({
      url: config.redisUrl ?? undefined
    });

    client.on("error", (error) => {
      console.error("[cache] redis error", error instanceof Error ? error.message : String(error));
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      console.error("[cache] redis connect failed", error instanceof Error ? error.message : String(error));
      return null;
    }
  })();

  return redisClientPromise;
};

const pruneMemoryCache = () => {
  const now = Date.now();
  for (const [key, entry] of memoryResponseCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryResponseCache.delete(key);
    }
  }
};

export const cacheService = {
  async consumeRateLimit(params: {
    key: string;
    limit: number;
    windowMs: number;
  }) {
    const redis = await getRedisClient();
    if (!redis) {
      return {
        ...consumeInMemoryRateLimit(params),
        source: "memory" as const
      };
    }

    const redisKey = `rate_limit:${params.key}`;
    const count = await redis.incr(redisKey);
    let ttlMs = await redis.pTTL(redisKey);

    if (count === 1 || ttlMs < 0) {
      await redis.pExpire(redisKey, params.windowMs);
      ttlMs = params.windowMs;
    }

    if (count > params.limit) {
      return {
        ok: false as const,
        remaining: 0,
        resetAt: Date.now() + ttlMs,
        source: "redis" as const
      };
    }

    return {
      ok: true as const,
      remaining: Math.max(params.limit - count, 0),
      resetAt: Date.now() + ttlMs,
      source: "redis" as const
    };
  },

  async getCachedResponse(key: string): Promise<CachedValue | null> {
    const redis = await getRedisClient();
    if (redis) {
      const value = await redis.get(`idempotency:${key}`);
      if (value !== null) {
        return { value, source: "redis" };
      }
    }

    pruneMemoryCache();
    const inMemory = memoryResponseCache.get(key);
    if (!inMemory) {
      return null;
    }

    return {
      value: inMemory.value,
      source: "memory"
    };
  },

  async setCachedResponse(params: {
    key: string;
    value: string;
    ttlSeconds?: number;
  }) {
    const ttlSeconds = params.ttlSeconds ?? 300;
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(`idempotency:${params.key}`, params.value, {
        EX: ttlSeconds
      });
      return;
    }

    memoryResponseCache.set(params.key, {
      value: params.value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  },

  async close() {
    const redis = await getRedisClient();
    if (redis) {
      try {
        await redis.quit();
      } catch { /* ignore */ }
    }
    memoryResponseCache.clear();
  },

  async getStatus() {
    const redis = await getRedisClient();
    return {
      enabled: Boolean(config.redisUrl),
      connected: Boolean(redis),
      urlConfigured: Boolean(config.redisUrl)
    };
  }
};
