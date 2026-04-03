import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

interface UseCachedFetchOptions {
  /** Time-to-live in ms before background revalidation (default: 60000) */
  ttl?: number;
  /** Skip fetching entirely */
  skip?: boolean;
}

interface UseCachedFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCachedFetch<T>(
  path: string | null,
  options: UseCachedFetchOptions = {},
): UseCachedFetchResult<T> {
  const { ttl = 60_000, skip = false } = options;

  const cached = path ? (cache.get(path) as CacheEntry<T> | undefined) : undefined;
  const [data, setData] = useState<T | null>(cached?.data ?? null);
  const [loading, setLoading] = useState(!cached?.data && !!path && !skip);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(
    async (background = false) => {
      if (!path || skip) return;
      if (!background) setLoading(true);
      setError(null);
      try {
        const result = await apiJson<T>(path);
        if (!mountedRef.current) return;
        setData(result);
        cache.set(path, { data: result, fetchedAt: Date.now() });
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        const msg =
          err && typeof err === "object" && "error" in err
            ? (err as { error: { message: string } }).error.message
            : "Request failed";
        if (!background) setError(msg);
      } finally {
        if (mountedRef.current && !background) setLoading(false);
      }
    },
    [path, skip],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!path || skip) return;

    // On mount: use cache if fresh, otherwise fetch
    const entry = cache.get(path) as CacheEntry<T> | undefined;
    if (entry?.data) {
      setData(entry.data);
      setLoading(false);
      if (Date.now() - entry.fetchedAt > ttl) {
        void fetchData(true);
      }
    } else {
      void fetchData(false);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [path, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(async () => {
    // Force invalidate cache before refetching to prevent stale reads
    if (path) cache.delete(path);
    await fetchData(false);
  }, [path, fetchData]);

  return { data, loading, error, refetch };
}

/** Clear all cached data */
export function clearFetchCache() {
  cache.clear();
}

/** Clear a specific cache entry */
export function invalidateFetchCache(path: string) {
  cache.delete(path);
}
