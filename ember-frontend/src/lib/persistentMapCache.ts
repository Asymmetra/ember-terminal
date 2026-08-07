// Lightweight localStorage persistence for the in-memory Map caches that back
// the leaderboard's per-row enrichment and .sol name resolution. Without this,
// every page reload starts with empty caches and re-fetches everything one
// wallet at a time. We persist the whole map under a single key with one
// "written at" timestamp: on hydrate, if the blob is within its TTL we restore
// all entries, otherwise we ignore it (and it gets overwritten on next write).

interface CacheBlob<V> {
  t: number;
  data: Record<string, V>;
}

/** Restore entries from localStorage into `map` if the stored blob is fresh. */
export function hydrateMap<V>(map: Map<string, V>, storageKey: string, ttlMs: number): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const blob = JSON.parse(raw) as CacheBlob<V>;
    if (!blob || typeof blob.t !== "number" || Date.now() - blob.t > ttlMs) return;
    for (const [k, v] of Object.entries(blob.data)) map.set(k, v);
  } catch {
    // Corrupt/unavailable storage — start cold.
  }
}

/** Returns a debounced persister that snapshots the whole `map` to localStorage. */
export function makeMapPersister<V>(
  map: Map<string, V>,
  storageKey: string,
  debounceMs = 1000,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (typeof window === "undefined" || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        const data: Record<string, V> = {};
        for (const [k, v] of map) data[k] = v;
        window.localStorage.setItem(storageKey, JSON.stringify({ t: Date.now(), data }));
      } catch {
        // Quota exceeded / serialization error — non-fatal, just skip persisting.
      }
    }, debounceMs);
  };
}
