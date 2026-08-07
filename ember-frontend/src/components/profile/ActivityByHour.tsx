"use client";

import { useMemo } from "react";
import type { NormalizedTrade } from "@/lib/tradeStats";
import type { TraderMetrics } from "@/lib/traderMetrics";
import clsx from "clsx";

interface Props {
  trades: NormalizedTrade[];
  metrics: TraderMetrics | null;
  loading: boolean;
}

interface HourBucket {
  hour: number;
  count: number;
  totalPnl: number;
  avgPnl: number;
}

/**
 * When-do-they-trade histogram (24 UTC hours) + behavioral footer. Reads the
 * real `realizedPnl`/`time` fields (the /analytics original read `t.pnl`).
 */
export function ActivityByHour({ trades, metrics, loading }: Props) {
  const buckets = useMemo<HourBucket[]>(() => {
    const hours: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0, totalPnl: 0, avgPnl: 0 }));
    for (const t of trades) {
      if (t.time <= 0) continue;
      const h = new Date(t.time * 1000).getUTCHours();
      hours[h].count++;
      hours[h].totalPnl += t.realizedPnl;
    }
    for (const b of hours) b.avgPnl = b.count > 0 ? b.totalPnl / b.count : 0;
    return hours;
  }, [trades]);

  const maxCount = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets]);
  const m = metrics;

  return (
    <div className="border border-ember-border bg-surface-l1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Activity by hour (UTC)</span>
        <span className="font-mono text-[9px] text-text-secondary/40">{trades.length.toLocaleString()} trades</span>
      </div>

      {loading ? (
        <div className="flex h-[120px] items-center justify-center font-mono text-[10px] text-text-secondary/40 animate-pulse">Analyzing…</div>
      ) : trades.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center font-mono text-[10px] text-text-secondary/40">No trade data.</div>
      ) : (
        <div className="flex items-end gap-[3px]" style={{ height: 120 }}>
          {buckets.map((b) => {
            const heightPct = (b.count / maxCount) * 100;
            const isProfit = b.avgPnl >= 0;
            return (
              <div key={b.hour} className="group relative flex flex-1 flex-col items-center">
                <div className="relative w-full" style={{ height: 120 }}>
                  <div
                    className={clsx(
                      "absolute bottom-0 w-full transition-all group-hover:opacity-80",
                      b.count === 0 ? "bg-surface-l2/30" : isProfit ? "bg-ember-green/60" : "bg-ember-red/60",
                    )}
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                  />
                </div>
                <span className="mt-1 font-mono text-[7px] text-text-secondary/40">{b.hour.toString().padStart(2, "0")}</span>
                <div className="pointer-events-none absolute -top-14 left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap border border-ember-border bg-surface-l2 px-2 py-1 shadow-lg group-hover:block">
                  <div className="font-mono text-[9px] text-text-secondary">{b.hour.toString().padStart(2, "0")}:00 UTC</div>
                  <div className="font-mono text-[9px] text-text-primary">{b.count} trades</div>
                  <div className={clsx("font-mono text-[9px]", b.avgPnl >= 0 ? "text-ember-green" : "text-ember-red")}>
                    avg {b.avgPnl >= 0 ? "+" : ""}${b.avgPnl.toFixed(2)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {m && !loading && (
        <div className="mt-4 grid grid-cols-3 gap-px border-t border-ember-border/40 pt-3 sm:grid-cols-6">
          <Mini label="Active days" value={m.activeDays.toLocaleString()} />
          <Mini label="Trades / day" value={m.tradesPerDay.toFixed(1)} />
          <Mini label="Win streak" value={`${m.maxWinStreak}`} tone="green" />
          <Mini label="Loss streak" value={`${m.maxLossStreak}`} tone="red" />
          <Mini label="Buy / Sell" value={`${m.buyCount}/${m.sellCount}`} />
          <Mini label="Liquidations" value={`${m.liquidations}`} tone={m.liquidations > 0 ? "red" : undefined} />
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const c = tone === "green" ? "text-ember-green" : tone === "red" ? "text-ember-red" : "text-text-primary";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[8px] uppercase tracking-wider text-text-secondary/45">{label}</span>
      <span className={clsx("font-mono text-xs font-medium tabular-nums", c)}>{value}</span>
    </div>
  );
}
