"use client";

import { formatUsd } from "@/lib/format";
import {
  scoreBand,
  BAND_COLOR,
  BAND_LABEL,
  type TraderMetrics,
} from "@/lib/traderMetrics";
import clsx from "clsx";

interface Props {
  metrics: TraderMetrics | null;
  loading: boolean;
  /** Optional head-to-head comparison values shown beside each metric. */
  compareMetrics?: TraderMetrics | null;
  compareLabel?: string;
}

type BandKey = "sharpe" | "sortino" | "calmar" | "profitFactor" | "winRate" | "maxDrawdownPct" | "expectancy" | "payoff";

interface Spec {
  label: string;
  bandKey: BandKey;
  pick: (m: TraderMetrics) => number | null;
  fmt: (v: number | null) => string;
  help: string;
}

const ratio = (v: number | null) =>
  v == null ? "—" : v === Infinity ? "∞" : v.toFixed(2);
const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(0)}%`;
const signedPct = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "" : ""}${(v * 100).toFixed(1)}%`;

const SPECS: Spec[] = [
  {
    label: "Sharpe",
    bandKey: "sharpe",
    pick: (m) => m.sharpe,
    fmt: ratio,
    help: "Annualized risk-adjusted return: mean daily return ÷ volatility of daily returns, ×√365. Computed from the daily PnL series over a constant capital base, risk-free rate 0. >1 is good, >2 excellent.",
  },
  {
    label: "Sortino",
    bandKey: "sortino",
    pick: (m) => m.sortino,
    fmt: ratio,
    help: "Like Sharpe but only penalizes downside volatility (losing days). Rewards upside. >1.5 good, >2.5 excellent.",
  },
  {
    label: "Calmar",
    bandKey: "calmar",
    pick: (m) => m.calmar,
    fmt: ratio,
    help: "Annualized return ÷ max drawdown. How much return you earn per unit of worst peak-to-trough pain. >1 good, >3 excellent.",
  },
  {
    label: "Max drawdown",
    bandKey: "maxDrawdownPct",
    pick: (m) => m.maxDrawdownPct,
    fmt: signedPct,
    help: "Largest peak-to-trough decline in cumulative PnL, as a % of capital base. Smaller (closer to 0) is better.",
  },
  {
    label: "Profit factor",
    bandKey: "profitFactor",
    pick: (m) => m.profitFactor,
    fmt: ratio,
    help: "Gross profit ÷ gross loss across all closed trades. >1 means winners outweigh losers; >2 is strong.",
  },
  {
    label: "Win rate",
    bandKey: "winRate",
    pick: (m) => m.winRate,
    fmt: pct,
    help: "Share of closed trades with positive realized PnL. Read alongside payoff — a low win rate can still be very profitable with big winners.",
  },
  {
    label: "Expectancy",
    bandKey: "expectancy",
    pick: (m) => m.expectancy,
    fmt: (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${formatUsd(v)}`),
    help: "Average realized $ per trade = winRate·avgWin − lossRate·avgLoss. The edge you expect each time you trade.",
  },
  {
    label: "Payoff",
    bandKey: "payoff",
    pick: (m) => m.payoff,
    fmt: ratio,
    help: "Average win ÷ average loss. >1 means your winners are bigger than your losers on average.",
  },
];

export function ScoreCard({ metrics, loading, compareMetrics, compareLabel }: Props) {
  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
          Risk-adjusted scorecard
        </span>
        <span className="font-mono text-[9px] text-text-secondary/35">lifetime · heuristic bands</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-ember-border/40 sm:grid-cols-4">
        {SPECS.map((s) => {
          const v = metrics ? s.pick(metrics) : null;
          const band = scoreBand(s.bandKey, v);
          const cv = compareMetrics ? s.pick(compareMetrics) : null;
          return (
            <div key={s.label} className="flex flex-col gap-1 bg-surface-l1 px-3 py-2.5">
              <span className="group relative flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">
                {s.label}
                <Help text={s.help} />
              </span>
              <span className={clsx("font-mono text-base font-semibold tabular-nums", BAND_COLOR[band])}>
                {loading ? "…" : s.fmt(v)}
              </span>
              {!loading && (
                <span className={clsx("font-mono text-[9px]", BAND_COLOR[band])}>{BAND_LABEL[band]}</span>
              )}
              {compareMetrics && (
                <span className="font-mono text-[9px] tabular-nums text-text-secondary/45">
                  {compareLabel ?? "vs"}: <span className="text-text-secondary/70">{s.fmt(cv)}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Help({ text }: { text: string }) {
  return (
    <span className="group/h relative inline-flex">
      <span className="flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-text-secondary/30 text-[8px] leading-none text-text-secondary/50">
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none hidden absolute left-0 top-full z-50 mt-1 w-[260px] rounded border border-ember-border bg-surface-l3/95 px-2 py-1.5 font-mono text-[10px] normal-case leading-snug tracking-normal text-text-secondary shadow-xl backdrop-blur-sm group-hover/h:block"
      >
        {text}
      </span>
    </span>
  );
}
