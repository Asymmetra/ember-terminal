"use client";

/**
 * State for the Live Comparison Chart on /stats.
 *
 * Owns:
 *   - focusedSymbol: which asset the chart is currently displaying
 *   - chartMode: line (multi-series oracle/mark/mid/bid/ask/lazer) or
 *     candle (single OHLC series from Phoenix's candles channel)
 *   - windowSeconds: time window for the line-mode x-axis
 *   - candleIntervalSeconds: granularity in candle mode
 *   - collapsed: whether the panel is rolled up to just its header
 *
 * Persisted to localStorage under STORAGE_KEY so the user's preferred
 * symbol / mode / window survives a refresh.
 */

import { create } from "zustand";

export type ChartMode = "line" | "candle";

interface StatsChartState {
  focusedSymbol: string | null;
  chartMode: ChartMode;
  windowSeconds: number;        // 60 / 300 / 600 / 3600
  candleIntervalSeconds: number; // 60 / 300 / 900
  collapsed: boolean;
  /**
   * Load persisted state from localStorage and apply it. Call from a
   * useEffect after mount — calling at module-init time creates a
   * server/client hydration mismatch (React #418) because the
   * server has no localStorage and renders defaults, while the
   * client picks up persisted values.
   */
  hydrate: () => void;
  setFocusedSymbol: (symbol: string | null) => void;
  setChartMode: (mode: ChartMode) => void;
  setWindowSeconds: (s: number) => void;
  setCandleIntervalSeconds: (s: number) => void;
  setCollapsed: (c: boolean) => void;
}

const STORAGE_KEY = "ember-stats-chart-v1";

interface PersistedState {
  focusedSymbol: string | null;
  chartMode: ChartMode;
  windowSeconds: number;
  candleIntervalSeconds: number;
  collapsed: boolean;
}

const DEFAULT_STATE: PersistedState = {
  focusedSymbol: null,
  chartMode: "line",
  windowSeconds: 60,
  // 15s gives ~4 candles per minute — dense enough to be useful at
  // the 1m window without becoming noise at 10m or 1h. User can pick
  // 5s / 15s / 1m / 5m.
  candleIntervalSeconds: 15,
  collapsed: false,
};

function readPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      focusedSymbol: typeof parsed.focusedSymbol === "string" ? parsed.focusedSymbol : null,
      chartMode: parsed.chartMode === "candle" ? "candle" : "line",
      windowSeconds: typeof parsed.windowSeconds === "number" ? parsed.windowSeconds : 60,
      candleIntervalSeconds: typeof parsed.candleIntervalSeconds === "number" ? parsed.candleIntervalSeconds : 60,
      collapsed: parsed.collapsed === true,
    };
  } catch {
    return null;
  }
}

function persist(s: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage full / disabled — silent failure is fine
  }
}

export const useStatsChartStore = create<StatsChartState>((set, get) => {
  const sync = () => {
    const { focusedSymbol, chartMode, windowSeconds, candleIntervalSeconds, collapsed } = get();
    persist({ focusedSymbol, chartMode, windowSeconds, candleIntervalSeconds, collapsed });
  };
  return {
    ...DEFAULT_STATE,
    hydrate: () => {
      const p = readPersisted();
      if (p) set(p);
    },
    setFocusedSymbol: (focusedSymbol) => { set({ focusedSymbol }); sync(); },
    setChartMode: (chartMode) => { set({ chartMode }); sync(); },
    setWindowSeconds: (windowSeconds) => { set({ windowSeconds }); sync(); },
    setCandleIntervalSeconds: (candleIntervalSeconds) => { set({ candleIntervalSeconds }); sync(); },
    setCollapsed: (collapsed) => { set({ collapsed }); sync(); },
  };
});
