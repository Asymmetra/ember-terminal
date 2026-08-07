"use client";

import { useMemo } from "react";
import { formatUsd, compactUsd } from "@/lib/format";
import {
  computePerMarket,
  filterByPeriod,
  type NormalizedTrade,
  type Period,
} from "@/lib/tradeStats";
import { useProfileDetailStore } from "@/stores/profileDetailStore";
import clsx from "clsx";

const PERIOD_LABEL: Record<Period, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "all time",
};

interface Props {
  trades: NormalizedTrade[];
  period: Period;
  loading: boolean;
}

// Per-market breakdown: each row a market, columns for trade count, volume,
// realized PnL, fees, win rate. Sorted by volume descending so the markets
// the trader is most active in lead. Fed by the page's shared (full) trade
// set — no own fetch — so it stays consistent with every other section.
export function MarketBreakdownGrid({ trades, period, loading }: Props) {
  const openDetail = useProfileDetailStore((s) => s.openPerMarket);
  const rows = useMemo(() => computePerMarket(filterByPeriod(trades, period)), [trades, period]);
  const allRows = useMemo(() => computePerMarket(trades), [trades]);

  const maxVolume = rows.reduce((m, r) => (r.volume > m ? r.volume : m), 0);
  const hiddenMarkets = Math.max(0, allRows.length - rows.length);

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
            Per market
          </span>
          <span className="font-mono text-[9px] text-text-secondary/40">
            · {PERIOD_LABEL[period]}
          </span>
        </div>
        <span className="font-mono text-[10px] text-text-secondary/40">
          {rows?.length ?? 0} {rows?.length === 1 ? "market" : "markets"}
          {hiddenMarkets > 0 ? ` · ${hiddenMarkets} hidden` : ""}
        </span>
      </div>

      {loading && (
        <div className="py-8 text-center font-mono text-[10px] text-text-secondary/40">
          Loading…
        </div>
      )}

      {!loading && rows && rows.length === 0 && (
        <div className="py-8 text-center font-mono text-[10px] text-text-secondary/40">
          No trades in this period.
        </div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-text-secondary/50">
                <th className="px-4 py-1.5 text-left font-mono font-normal uppercase tracking-wider">Market</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Trades</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Volume</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Realized PnL</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Fees</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Net</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Win rate</th>
                <th className="px-4 py-1.5 font-mono font-normal uppercase tracking-wider text-left">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const positive = r.realizedPnl >= 0;
                const net = r.realizedPnl - r.fees;
                const netPositive = net >= 0;
                const sharePct = maxVolume > 0 ? (r.volume / maxVolume) * 100 : 0;
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => openDetail(r, period)}
                    className="cursor-pointer border-t border-ember-border/40 font-mono transition-colors hover:bg-surface-l2/40"
                  >
                    <td className="px-4 py-1.5 text-text-primary">{r.symbol}-PERP</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary/80">{r.trades}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary/80">{compactUsd(r.volume)}</td>
                    <td className={clsx("px-4 py-1.5 text-right tabular-nums", positive ? "text-ember-green" : "text-ember-red")}>
                      {positive ? "+" : ""}{formatUsd(r.realizedPnl)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary/70">
                      {formatUsd(r.fees)}
                    </td>
                    <td className={clsx("px-4 py-1.5 text-right tabular-nums", netPositive ? "text-ember-green" : "text-ember-red")}>
                      {netPositive ? "+" : ""}{formatUsd(net)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary/80">
                      {(r.winRate * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="h-1 w-24 bg-ember-border/40">
                        <div className="h-full bg-ember-orange/60" style={{ width: `${sharePct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
