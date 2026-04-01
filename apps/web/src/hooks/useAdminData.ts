import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

interface UseAdminDataOptions {
  /** Time-to-live in ms before background revalidation (default: 60000) */
  ttl?: number;
  /** Skip fetching entirely */
  skip?: boolean;
}

interface UseAdminDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAdminData<T>(
  path: string | null,
  options: UseAdminDataOptions = {},
): UseAdminDataResult<T> {
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

    if (cached?.data) {
      setData(cached.data);
      setLoading(false);
      if (Date.now() - cached.fetchedAt > ttl) {
        void fetchData(true);
      }
    } else {
      void fetchData(false);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [path, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => fetchData(false), [fetchData]);

  return { data, loading, error, refetch };
}

/** Clear all cached admin data */
export function clearAdminCache() {
  cache.clear();
}

/** Clear a specific cache entry */
export function invalidateAdminCache(path: string) {
  cache.delete(path);
}
