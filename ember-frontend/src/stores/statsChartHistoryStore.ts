"use client";

/**
 * Chart history store — caches per-symbol price samples for the Live
 * Comparison Chart on /stats.
 *
 * Why this exists separately from `useObservability`'s `recentPayloads`
 * ring:
 *   - `recentPayloads` is capped at 720 entries per source (~12 min at
 *     1Hz). That's not enough to show the 1hr window the user can
 *     select on the chart.
 *   - `recentPayloads` stores entire payloads (oraclePx + markPx +
 *     midPx + funding + OI + volume + ...) — too heavy to expand to
 *     3,600+ entries across all sources without blowing the
 *     localStorage budget.
 *   - The chart only needs the 6 numeric series. Stripping to just
 *     (timestamp, six floats) lets us hold 1hr of history per symbol
 *     at 1Hz for ~115KB — well within the budget.
 *
 * Behavior:
 *   - One sample per second per symbol (deduped on `tMs` proximity).
 *     Sub-second resolution is irrelevant at >=1m chart windows; for
 *     <=1m the chart's live cursor / value prop carries the latest
 *     value smoothly between samples.
 *   - Rolling 1hr window — anything older is dropped on insert.
 *   - Persisted to localStorage (debounced every 5s) so refreshing or
 *     navigating away and back keeps your context.
 *
 * Time scale: ALL timestamps in this store are `Date.now()` Unix ms.
 * `performance.now()` is page-load-relative and would be useless for
 * cross-session persistence; converting at ingestion time keeps the
 * rest of the chart code simple.
 */

import { create } from "zustand";

export type ChartSeriesId = "oracle" | "mark" | "mid" | "bid" | "ask" | "lazer";

export interface ChartSample {
  /** Unix ms timestamp. */
  tMs: number;
  /** Sparse — series we couldn't read at this tick are omitted. */
  values: Partial<Record<ChartSeriesId, number>>;
}

interface ChartHistoryState {
  history: Record<string, ChartSample[]>;
  /**
   * Append a sample for a symbol. No-op if the most recent sample
   * for that symbol is less than SAMPLE_INTERVAL_MS old (dedup).
   * Trims entries older than MAX_AGE_MS on every insert.
   */
  addSample: (symbol: string, sample: ChartSample) => void;
  /** Return samples for `symbol` within the last `windowSeconds`. */
  getWindow: (symbol: string, windowSeconds: number) => ChartSample[];
  /** Drop a symbol's history entirely (used on Reset). */
  clear: (symbol?: string) => void;
  /**
   * Load persisted history from localStorage. Call from a useEffect
   * after mount — reading localStorage at module-init time produces
   * a server/client hydration mismatch (React #418).
   */
  hydrate: () => void;
}

const STORAGE_KEY = "ember-chart-history-v1";
const MAX_AGE_MS = 60 * 60 * 1000;     // 1 hour — matches the longest chart window
const SAMPLE_INTERVAL_MS = 1000;        // downsample to 1Hz on insert
const PERSIST_DEBOUNCE_MS = 5_000;

function loadHistory(): Record<string, ChartSample[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    const out: Record<string, ChartSample[]> = {};
    for (const [symbol, samples] of Object.entries(parsed)) {
      if (!Array.isArray(samples)) continue;
      const kept: ChartSample[] = [];
      for (const s of samples as ChartSample[]) {
        if (s && typeof s.tMs === "number" && now - s.tMs < MAX_AGE_MS) kept.push(s);
      }
      if (kept.length > 0) out[symbol] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(getter: () => Record<string, ChartSample[]>) {
  if (typeof window === "undefined") return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(getter()));
    } catch {
      // Storage full / disabled — drop silently. Worst case the user
      // loses cross-session history; in-memory state is unaffected.
    }
  }, PERSIST_DEBOUNCE_MS);
}

export const useStatsChartHistoryStore = create<ChartHistoryState>((set, get) => ({
  history: {},

  hydrate: () => {
    const loaded = loadHistory();
    if (Object.keys(loaded).length === 0) return;
    set({ history: loaded });
  },

  addSample: (symbol, sample) => {
    if (Object.keys(sample.values).length === 0) return;
    set((state) => {
      const existing = state.history[symbol] ?? [];
      const last = existing[existing.length - 1];
      if (last && sample.tMs - last.tMs < SAMPLE_INTERVAL_MS) return state;
      const cutoff = Date.now() - MAX_AGE_MS;
      // Append, then trim head where stale. Splice is O(n) but n is
      // bounded by 3,600 per symbol so this is cheap.
      const next: ChartSample[] = [];
      for (const s of existing) {
        if (s.tMs >= cutoff) next.push(s);
      }
      next.push(sample);
      return { history: { ...state.history, [symbol]: next } };
    });
    schedulePersist(() => get().history);
  },

  getWindow: (symbol, windowSeconds) => {
    const all = get().history[symbol];
    if (!all || all.length === 0) return [];
    const cutoff = Date.now() - windowSeconds * 1000;
    // Binary search would be faster but the array is at most 3,600
    // entries — linear scan is fine.
    const out: ChartSample[] = [];
    for (const s of all) {
      if (s.tMs >= cutoff) out.push(s);
    }
    return out;
  },

  clear: (symbol) => {
    set((state) => {
      if (!symbol) return { history: {} };
      const { [symbol]: _, ...rest } = state.history;
      void _;
      return { history: rest };
    });
    schedulePersist(() => get().history);
  },
}));
