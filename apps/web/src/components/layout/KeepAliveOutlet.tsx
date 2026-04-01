import { useRef } from "react";
import { useLocation, useOutlet } from "react-router-dom";

const MAX_CACHED = 15;

/**
 * KeepAliveOutlet — caches rendered route children so they are hidden (display:none)
 * instead of unmounted on navigation. Revisiting a page is instant with full state preserved.
 */
export function KeepAliveOutlet() {
  const location = useLocation();
  const currentOutlet = useOutlet();
  const cacheRef = useRef(new Map<string, React.ReactNode>());
  const orderRef = useRef<string[]>([]);

  const key = location.pathname;

  // Cache on first visit only — never overwrite, so React preserves the component tree
  if (currentOutlet && !cacheRef.current.has(key)) {
    cacheRef.current.set(key, currentOutlet);
    orderRef.current.push(key);
  }

  // LRU eviction — keep at most MAX_CACHED entries
  while (orderRef.current.length > MAX_CACHED) {
    const evict = orderRef.current.shift()!;
    if (evict !== key) {
      cacheRef.current.delete(evict);
    }
  }

  return (
    <>
      {Array.from(cacheRef.current.entries()).map(([path, element]) => (
        <div key={path} style={{ display: path === key ? "block" : "none" }}>
          {element}
        </div>
      ))}
    </>
  );
}
