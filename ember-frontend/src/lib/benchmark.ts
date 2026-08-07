// Market-benchmark helper for the /profile dashboard. Computes the
// buy-&-hold return of a reference market over a given window from REAL
// candle data, so a trader's performance can be framed against simply
// holding spot ("you made +3% while SOL did +12%").

import { api } from "./api";
import type { Period } from "./tradeStats";

export const BENCHMARK_SYMBOLS = ["SOL", "BTC"] as const;
export type BenchmarkSymbol = (typeof BENCHMARK_SYMBOLS)[number];

function candleParamsForPeriod(period: Period): { timeframe: string; limit: number } {
  switch (period) {
    case "24h": return { timeframe: "1h", limit: 24 };
    case "7d": return { timeframe: "1h", limit: 168 };
    case "30d": return { timeframe: "1d", limit: 30 };
    case "all": return { timeframe: "1d", limit: 365 };
  }
}

/**
 * Buy-&-hold return (as a fraction, e.g. 0.12 = +12%) for `symbol` over the
 * window: (lastClose − firstOpen) / firstOpen. Returns null if no candles.
 */
export async function buyHoldReturnPct(symbol: string, period: Period): Promise<number | null> {
  const { timeframe, limit } = candleParamsForPeriod(period);
  try {
    const candles = await api.getCandles(symbol, timeframe, limit);
    const arr: Array<{ open: number; close: number }> = Array.isArray(candles) ? candles : [];
    if (arr.length < 2) return null;
    const entry = arr[0].open;
    const exit = arr[arr.length - 1].close;
    if (!Number.isFinite(entry) || entry === 0) return null;
    return (exit - entry) / entry;
  } catch {
    return null;
  }
}
