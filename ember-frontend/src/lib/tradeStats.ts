// Shared trade/PnL aggregation helpers for the profile page (and anywhere else
// that wants the same semantics later). Everything is pure — inputs are raw
// API responses, outputs are plain numbers. The SDK returns decimal values
// either as plain numbers, numeric strings, or { ui: "…", decimals, value }
// objects; sdkNum() collapses all three.

export type Period = "24h" | "7d" | "30d" | "all";

export const PERIOD_SECONDS: Record<Period, number | null> = {
  "24h": 86_400,
  "7d": 7 * 86_400,
  "30d": 30 * 86_400,
  all: null,
};

export interface NormalizedTrade {
  time: number; // seconds since epoch
  symbol: string;
  delta: number; // signed base-size change (+ = bought, − = sold)
  price: number;
  realizedPnl: number;
  fees: number;
  liquidity: "maker" | "taker" | "unknown";
  tradeType: "market" | "limit" | "liquidation" | "unknown";
  signature?: string;
  baseBefore: number;
  baseAfter: number;
}

export function sdkNum(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof val === "object" && "ui" in (val as Record<string, unknown>)) {
    const n = parseFloat((val as { ui: string }).ui);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function normalizeTrade(raw: Record<string, unknown>): NormalizedTrade {
  const ts =
    typeof raw.timestamp === "string"
      ? Math.floor(new Date(raw.timestamp).getTime() / 1000)
      : typeof raw.timestamp === "number"
        ? Math.floor(raw.timestamp)
        : 0;
  const delta = sdkNum(raw.baseLotsDelta);
  return {
    time: ts,
    symbol: String(raw.marketSymbol ?? ""),
    delta,
    price: sdkNum(raw.price),
    realizedPnl: sdkNum(raw.realizedPnl),
    fees: sdkNum(raw.fees),
    liquidity:
      raw.liquidity === "maker" || raw.liquidity === "taker"
        ? raw.liquidity
        : "unknown",
    tradeType:
      raw.tradeType === "market" ||
      raw.tradeType === "limit" ||
      raw.tradeType === "liquidation"
        ? raw.tradeType
        : "unknown",
    signature: typeof raw.signature === "string" ? raw.signature : undefined,
    baseBefore: sdkNum(raw.baseLotsBefore),
    baseAfter: sdkNum(raw.baseLotsAfter),
  };
}

export function filterByPeriod(trades: NormalizedTrade[], period: Period): NormalizedTrade[] {
  const window = PERIOD_SECONDS[period];
  if (window == null) return trades;
  const cutoff = Math.floor(Date.now() / 1000) - window;
  return trades.filter((t) => t.time >= cutoff);
}

/**
 * Pick the narrowest window (24h → 7d → 30d) that still contains at least
 * one trade, falling back to "all". Used to smart-default the dashboard so a
 * wallet whose recent activity is older than 7d doesn't render as all-zeros.
 */
export function widestWindowWithData(trades: NormalizedTrade[]): Period {
  if (trades.length === 0) return "all";
  for (const p of ["24h", "7d", "30d"] as const) {
    if (filterByPeriod(trades, p).length > 0) return p;
  }
  return "all";
}

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  fees: number;
  netPnl: number;
  volume: number; // notional traded (|delta| × price)
  largestWin: number;
  largestLoss: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number; // Infinity when no losses but wins > 0
  expectancy: number;
  liquidations: number;
}

// Per-fill semantics (verified empirically by tests/pnl-accuracy.mjs):
// Phoenix's TradeHistoryItem.realizedPnl is GROSS of fees — i.e. it represents
// the (close - open) × size delta on the closed portion of the position only,
// without subtracting the fee paid on this fill. So netPnl = realizedPnl - fees
// is the correct "what hit my account" number, NOT a double-subtraction.
// If Phoenix changes that semantic the lifecycle test will fail loudly.
export function computeTradeStats(trades: NormalizedTrade[]): TradeStats {
  let realizedPnl = 0;
  let fees = 0;
  let volume = 0;
  let wins = 0;
  let losses = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let liquidations = 0;
  for (const t of trades) {
    realizedPnl += t.realizedPnl;
    fees += t.fees;
    volume += Math.abs(t.delta) * t.price;
    if (t.tradeType === "liquidation") liquidations++;
    if (t.realizedPnl > 0) {
      wins++;
      grossWins += t.realizedPnl;
      if (t.realizedPnl > largestWin) largestWin = t.realizedPnl;
    } else if (t.realizedPnl < 0) {
      losses++;
      grossLosses += Math.abs(t.realizedPnl);
      if (t.realizedPnl < largestLoss) largestLoss = t.realizedPnl;
    }
  }
  const total = trades.length;
  const winRate = total > 0 ? wins / total : 0;
  const lossRate = total > 0 ? losses / total : 0;
  const avgWin = wins > 0 ? grossWins / wins : 0;
  const avgLoss = losses > 0 ? grossLosses / losses : 0;
  return {
    total,
    wins,
    losses,
    winRate,
    realizedPnl,
    fees,
    netPnl: realizedPnl - fees,
    volume,
    largestWin,
    largestLoss,
    avgWin,
    avgLoss,
    profitFactor:
      grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    expectancy: winRate * avgWin - lossRate * avgLoss,
    liquidations,
  };
}

export interface PerMarketStats {
  symbol: string;
  trades: number;
  realizedPnl: number;
  fees: number;
  volume: number;
  winRate: number;
}

export function computePerMarket(trades: NormalizedTrade[]): PerMarketStats[] {
  const acc = new Map<string, { trades: number; pnl: number; fees: number; volume: number; wins: number; losses: number }>();
  for (const t of trades) {
    const cur = acc.get(t.symbol) ?? { trades: 0, pnl: 0, fees: 0, volume: 0, wins: 0, losses: 0 };
    cur.trades++;
    cur.pnl += t.realizedPnl;
    cur.fees += t.fees;
    cur.volume += Math.abs(t.delta) * t.price;
    if (t.realizedPnl > 0) cur.wins++;
    else if (t.realizedPnl < 0) cur.losses++;
    acc.set(t.symbol, cur);
  }
  return Array.from(acc.entries())
    .map(([symbol, v]) => ({
      symbol,
      trades: v.trades,
      realizedPnl: v.pnl,
      fees: v.fees,
      volume: v.volume,
      winRate: v.wins + v.losses > 0 ? v.wins / (v.wins + v.losses) : 0,
    }))
    .sort((a, b) => b.volume - a.volume);
}

// PnL time-series helper. The backend /pnl endpoint returns points with
// cumulativePnl / cumulativeTakerFee / cumulativeMakerFee / cumulativeFundingPayment / unrealizedPnl.
// periodDelta returns the change across the requested window using first and
// last non-null values — safer than last − first when a point is missing.
export interface PnlPoint {
  time: number; // seconds
  cumulativePnl: number;
  // cumulativeFees = takerFee + makerFee. We must include BOTH otherwise a
  // trader who works limit orders sees their fees under-reported. Verified by
  // tests/pnl-accuracy.mjs against summed fill fees.
  cumulativeFees: number;
  cumulativeFunding: number;
  unrealizedPnl: number;
}

export function normalizePnlSeries(raw: unknown[]): PnlPoint[] {
  return (raw as Record<string, unknown>[])
    .map((p) => ({
      time: sdkNum(p.timestamp),
      cumulativePnl: sdkNum(p.cumulativePnl),
      // Sum taker + maker. Phoenix exposes them as separate fields; before
      // this fix we only read taker which dropped maker fees on limit fills.
      cumulativeFees: sdkNum(p.cumulativeTakerFee) + sdkNum(p.cumulativeMakerFee),
      cumulativeFunding: sdkNum(p.cumulativeFundingPayment),
      unrealizedPnl: sdkNum(p.unrealizedPnl),
    }))
    .sort((a, b) => a.time - b.time);
}

export function periodDelta(points: PnlPoint[], key: keyof Omit<PnlPoint, "time">): number {
  if (points.length === 0) return 0;
  const first = points[0][key];
  const last = points[points.length - 1][key];
  return last - first;
}

export function pnlResolutionForPeriod(period: Period): { resolution: string; limit: number } {
  switch (period) {
    case "24h": return { resolution: "1h", limit: 24 };
    case "7d": return { resolution: "1h", limit: 168 };
    case "30d": return { resolution: "1d", limit: 30 };
    case "all": return { resolution: "1d", limit: 1000 };
  }
}
