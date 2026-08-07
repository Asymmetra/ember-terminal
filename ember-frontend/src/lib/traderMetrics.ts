// Risk-adjusted + behavioral trader metrics for the /profile dashboard.
//
// Everything here is derived from REAL data the backend already exposes:
//   • trades          → win rate, profit factor, volume, streaks, bias
//   • daily PnL series → Sharpe / Sortino / Calmar / max drawdown
//   • collateral hist  → net external deposits (for ROI)
//   • trader state     → current equity + unrealized PnL
//
// Methodology + assumptions (surfaced to the user via tooltips):
//   - Returns are computed from the DAILY cumulative-PnL series: the per-day
//     change in cumulative PnL divided by an `equityBase` (a constant capital
//     proxy = max(currentEquity, netDeposits)). This is an approximation — we
//     don't have a true historical equity series — but it's stable and
//     directionally correct.
//   - Risk-free rate is assumed 0 (typical for crypto perp dashboards).
//   - Sharpe/Sortino are annualized by √365 (daily sampling).

import {
  computeTradeStats,
  type NormalizedTrade,
  type PnlPoint,
  sdkNum,
} from "./tradeStats";
import { rawMicroToUsd } from "./normalize";

export interface TraderMetrics {
  // headline
  equity: number;
  unrealizedPnl: number;
  lifetimeNetPnl: number;
  netDeposits: number;
  roi: number | null; // lifetimeNetPnl / netDeposits
  // risk-adjusted
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdown: number; // $, ≤ 0
  maxDrawdownPct: number; // fraction of equityBase, ≤ 0
  annualizedReturnPct: number | null; // fraction
  // trade quality
  winRate: number;
  profitFactor: number; // Infinity when no losses but wins > 0
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  payoff: number; // avgWin / avgLoss
  largestWin: number;
  largestLoss: number;
  volume: number;
  fees: number;
  funding: number; // last cumulativeFunding (paid > 0)
  liquidations: number;
  totalTrades: number;
  // behavioral
  maxWinStreak: number;
  maxLossStreak: number;
  activeDays: number;
  tradesPerDay: number;
  buyCount: number;
  sellCount: number;
  avgTradeNotional: number;
}

export interface MetricsInput {
  trades: NormalizedTrade[];
  /** Daily-resolution PnL series (resolution "1d"). */
  dailyPnl: PnlPoint[];
  /** Raw collateral-history rows ({ amount, eventType, ... }). */
  collateral: Record<string, unknown>[];
  equity: number;
  unrealizedPnl: number;
}

const DAYS_PER_YEAR = 365;

function stddev(xs: number[], mean: number): number {
  if (xs.length < 2) return 0;
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Net external capital: deposits minus withdrawals (internal transfers ignored). */
export function netDepositsFromCollateral(rows: Record<string, unknown>[]): number {
  let net = 0;
  for (const r of rows) {
    const type = String(r.eventType ?? "").toLowerCase();
    const amt = rawMicroToUsd(r.amount);
    if (type === "deposit") net += Math.abs(amt);
    else if (type === "withdraw") net -= Math.abs(amt);
  }
  return net;
}

export function computeTraderMetrics(input: MetricsInput): TraderMetrics {
  const { trades, dailyPnl, collateral, equity, unrealizedPnl } = input;
  const ts = computeTradeStats(trades);

  const netDeposits = netDepositsFromCollateral(collateral);
  const equityBase = Math.max(equity, netDeposits, 1);

  // Lifetime net PnL + cumulative funding from the series tail.
  const last = dailyPnl.length > 0 ? dailyPnl[dailyPnl.length - 1] : null;
  const lifetimeNetPnl = last ? last.cumulativePnl - last.cumulativeFees : ts.netPnl;
  const funding = last ? last.cumulativeFunding : 0;
  const roi = netDeposits > 0 ? lifetimeNetPnl / netDeposits : null;

  // ── Daily returns for risk-adjusted ratios ──
  const dailyReturns: number[] = [];
  for (let i = 1; i < dailyPnl.length; i++) {
    const dPnl = dailyPnl[i].cumulativePnl - dailyPnl[i - 1].cumulativePnl;
    dailyReturns.push(dPnl / equityBase);
  }
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((s, x) => s + x, 0) / dailyReturns.length;
    const sd = stddev(dailyReturns, mean);
    const downside = Math.sqrt(
      dailyReturns.reduce((s, x) => s + (x < 0 ? x * x : 0), 0) / dailyReturns.length,
    );
    sharpe = sd > 0 ? (mean / sd) * Math.sqrt(DAYS_PER_YEAR) : null;
    sortino = downside > 0 ? (mean / downside) * Math.sqrt(DAYS_PER_YEAR) : null;
  }

  // ── Max drawdown on cumulative PnL ──
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of dailyPnl) {
    if (p.cumulativePnl > peak) peak = p.cumulativePnl;
    const dd = p.cumulativePnl - peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = maxDrawdown / equityBase;

  // ── Annualized return + Calmar ──
  let annualizedReturnPct: number | null = null;
  let calmar: number | null = null;
  if (dailyPnl.length >= 2) {
    const first = dailyPnl[0];
    const tail = dailyPnl[dailyPnl.length - 1];
    const days = Math.max(1, (tail.time - first.time) / 86_400);
    const totalReturn = (tail.cumulativePnl - first.cumulativePnl) / equityBase;
    annualizedReturnPct = totalReturn * (DAYS_PER_YEAR / days);
    calmar = maxDrawdownPct < 0 ? annualizedReturnPct / Math.abs(maxDrawdownPct) : null;
  }

  // ── Behavioral: streaks, active days, bias ──
  const chrono = [...trades].sort((a, b) => a.time - b.time);
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  let buyCount = 0;
  let sellCount = 0;
  const days = new Set<string>();
  for (const t of chrono) {
    if (t.realizedPnl > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWinStreak) maxWinStreak = curWin;
    } else if (t.realizedPnl < 0) {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLossStreak) maxLossStreak = curLoss;
    }
    if (t.delta > 0) buyCount++;
    else if (t.delta < 0) sellCount++;
    if (t.time > 0) days.add(new Date(t.time * 1000).toISOString().slice(0, 10));
  }
  const activeDays = days.size;
  const spanDays = chrono.length >= 2 ? Math.max(1, (chrono[chrono.length - 1].time - chrono[0].time) / 86_400) : 1;
  const tradesPerDay = chrono.length / spanDays;
  const avgTradeNotional = ts.total > 0 ? ts.volume / ts.total : 0;

  return {
    equity,
    unrealizedPnl,
    lifetimeNetPnl,
    netDeposits,
    roi,
    sharpe,
    sortino,
    calmar,
    maxDrawdown,
    maxDrawdownPct,
    annualizedReturnPct,
    winRate: ts.winRate,
    profitFactor: ts.profitFactor,
    expectancy: ts.expectancy,
    avgWin: ts.avgWin,
    avgLoss: ts.avgLoss,
    payoff: ts.avgLoss > 0 ? ts.avgWin / ts.avgLoss : ts.avgWin > 0 ? Infinity : 0,
    largestWin: ts.largestWin,
    largestLoss: ts.largestLoss,
    volume: ts.volume,
    fees: ts.fees,
    funding,
    liquidations: ts.liquidations,
    totalTrades: ts.total,
    maxWinStreak,
    maxLossStreak,
    activeDays,
    tradesPerDay,
    buyCount,
    sellCount,
    avgTradeNotional,
  };
}

// ── Qualitative bands (HEURISTIC — clearly labeled in the UI) ──
export type Band = "excellent" | "good" | "ok" | "poor" | "none";

export const BAND_COLOR: Record<Band, string> = {
  excellent: "text-ember-green",
  good: "text-ember-green/80",
  ok: "text-text-secondary/80",
  poor: "text-ember-red",
  none: "text-text-secondary/50",
};

export const BAND_LABEL: Record<Band, string> = {
  excellent: "excellent",
  good: "good",
  ok: "average",
  poor: "weak",
  none: "—",
};

type BandKey = "sharpe" | "sortino" | "calmar" | "profitFactor" | "winRate" | "maxDrawdownPct" | "expectancy" | "payoff";

// Thresholds are deliberately conservative rules of thumb, not population stats.
const THRESHOLDS: Record<BandKey, [number, number, number]> = {
  // [poor<below ok, ok→good, good→excellent]  (higher = better)
  sharpe: [0, 1, 2],
  sortino: [0, 1.5, 2.5],
  calmar: [0, 1, 3],
  profitFactor: [1, 1.3, 2],
  winRate: [0.4, 0.5, 0.6],
  expectancy: [0, 0.0001, Infinity], // sign-based: <0 poor, >0 ok+
  payoff: [1, 1.5, 2.5],
  maxDrawdownPct: [-0.5, -0.25, -0.1], // less-negative = better
};

export function scoreBand(key: BandKey, value: number | null): Band {
  if (value == null || !Number.isFinite(value)) {
    // Infinity profit factor / payoff is genuinely excellent (no losses).
    if (value === Infinity && (key === "profitFactor" || key === "payoff")) return "excellent";
    return "none";
  }
  const [a, b, c] = THRESHOLDS[key];
  if (key === "maxDrawdownPct") {
    // higher (closer to 0) is better
    if (value >= c) return "excellent";
    if (value >= b) return "good";
    if (value >= a) return "ok";
    return "poor";
  }
  if (value >= c) return "excellent";
  if (value >= b) return "good";
  if (value >= a) return "ok";
  return "poor";
}
