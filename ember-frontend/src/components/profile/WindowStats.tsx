"use client";

import { useMemo } from "react";
import { formatUsd, compactUsd } from "@/lib/format";
import { computeTradeStats, filterByPeriod, type NormalizedTrade, type Period } from "@/lib/tradeStats";
import clsx from "clsx";

interface Props {
  trades: NormalizedTrade[];
  period: Period;
  loading: boolean;
}

const PERIOD_LABEL: Record<Period, string> = { "24h": "24h", "7d": "7d", "30d": "30d", all: "all time" };

// Trade-derived stats for the SELECTED window — computed straight from the
// (full, cursor-paged) trade set, so narrowing the window never blanks out.
export function WindowStats({ trades, period, loading }: Props) {
  const stats = useMemo(() => computeTradeStats(filterByPeriod(trades, period)), [trades, period]);
  const netPnl = stats.realizedPnl - stats.fees;

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Window stats</span>
        <span className="font-mono text-[9px] text-text-secondary/40">· {PERIOD_LABEL[period]}</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-ember-border/40 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="Net PnL" value={`${netPnl >= 0 ? "+" : ""}${formatUsd(netPnl)}`} tone={netPnl >= 0 ? "pos" : "neg"} sub={`${stats.realizedPnl >= 0 ? "+" : ""}${formatUsd(stats.realizedPnl)} realized`} loading={loading} />
        <Cell label="Fees" value={formatUsd(stats.fees)} sub="paid" loading={loading} />
        <Cell label="Volume" value={compactUsd(stats.volume)} sub={`${stats.total} fills`} loading={loading} />
        <Cell label="Win rate" value={`${(stats.winRate * 100).toFixed(0)}%`} sub={`${stats.wins}W / ${stats.losses}L`} loading={loading} />
        <Cell
          label="Profit factor"
          value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor === 0 ? "—" : stats.profitFactor.toFixed(2)}
          tone={stats.profitFactor === 0 ? undefined : stats.profitFactor >= 1 ? "pos" : "neg"}
          sub={stats.expectancy !== 0 ? `${stats.expectancy >= 0 ? "+" : ""}${formatUsd(stats.expectancy)}/trade` : "—"}
          loading={loading}
        />
        <Cell label="Liquidations" value={`${stats.liquidations}`} tone={stats.liquidations > 0 ? "neg" : undefined} sub={stats.liquidations > 0 ? "forced" : "none"} loading={loading} />
      </div>
    </div>
  );
}

function Cell({ label, value, tone, sub, loading }: { label: string; value: string; tone?: "pos" | "neg"; sub?: string; loading: boolean }) {
  const c = tone === "pos" ? "text-ember-green" : tone === "neg" ? "text-ember-red" : "text-text-primary";
  return (
    <div className="flex flex-col gap-1 bg-surface-l1 px-3 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">{label}</span>
      <span className={clsx("font-mono text-base font-semibold tabular-nums", c)}>{loading ? "…" : value}</span>
      {sub && <span className="font-mono text-[10px] text-text-secondary/50">{loading ? "" : sub}</span>}
    </div>
  );
}
