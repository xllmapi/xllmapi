// Re-export from useCachedFetch for backwards compatibility
export {
  useCachedFetch as useAdminData,
  clearFetchCache as clearAdminCache,
  invalidateFetchCache as invalidateAdminCache,
} from "./useCachedFetch";
