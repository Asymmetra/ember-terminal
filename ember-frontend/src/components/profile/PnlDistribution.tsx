"use client";

import { useMemo } from "react";
import { formatUsd } from "@/lib/format";
import type { NormalizedTrade } from "@/lib/tradeStats";
import clsx from "clsx";

interface Props {
  trades: NormalizedTrade[];
  loading: boolean;
}

interface Bucket {
  min: number;
  max: number;
  count: number;
}

/**
 * Histogram of per-trade realized PnL (closing fills only). Reveals whether
 * the trader's edge comes from many small wins, a few outliers, or fat tails.
 * Reimplemented from the old /analytics version to read the real
 * `realizedPnl` field (the original read a non-existent `pnl`).
 */
export function PnlDistribution({ trades, loading }: Props) {
  const buckets = useMemo<Bucket[]>(() => {
    const pnls = trades.map((t) => t.realizedPnl).filter((p) => p !== 0);
    if (pnls.length === 0) return [];
    const min = Math.min(...pnls);
    const max = Math.max(...pnls);
    const range = max - min;
    if (range === 0) return [{ min, max, count: pnls.length }];
    const n = Math.min(24, Math.max(8, Math.ceil(Math.sqrt(pnls.length))));
    const step = range / n;
    const out: Bucket[] = [];
    for (let i = 0; i < n; i++) {
      const bMin = min + i * step;
      const bMax = i === n - 1 ? max + 1e-9 : min + (i + 1) * step;
      out.push({ min: bMin, max: bMax, count: pnls.filter((p) => p >= bMin && p < bMax).length });
    }
    return out;
  }, [trades]);

  const maxCount = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets]);

  return (
    <div className="border border-ember-border bg-surface-l1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
          Trade PnL distribution
        </span>
        <span className="font-mono text-[9px] text-text-secondary/40">
          {buckets.reduce((s, b) => s + b.count, 0)} closed trades
        </span>
      </div>

      {loading ? (
        <div className="flex h-[100px] items-center justify-center font-mono text-[10px] text-text-secondary/40 animate-pulse">
          Computing…
        </div>
      ) : buckets.length === 0 ? (
        <div className="flex h-[100px] items-center justify-center font-mono text-[10px] text-text-secondary/40">
          No realized-PnL trades yet.
        </div>
      ) : (
        <>
          <div className="flex items-end gap-[2px]" style={{ height: 100 }}>
            {buckets.map((b, i) => {
              const heightPct = (b.count / maxCount) * 100;
              const isProfit = (b.min + b.max) / 2 >= 0;
              return (
                <div key={i} className="group relative flex flex-1 flex-col items-center">
                  <div className="relative w-full" style={{ height: 100 }}>
                    <div
                      className={clsx(
                        "absolute bottom-0 w-full transition-opacity group-hover:opacity-80",
                        b.count === 0 ? "bg-surface-l2/20" : isProfit ? "bg-ember-green/60" : "bg-ember-red/60",
                      )}
                      style={{ height: `${Math.max(heightPct, 1)}%` }}
                    />
                  </div>
                  <div className="pointer-events-none absolute -top-12 left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap border border-ember-border bg-surface-l2 px-2 py-1 shadow-lg group-hover:block">
                    <div className="font-mono text-[9px] text-text-secondary">
                      {formatUsd(b.min)} → {formatUsd(b.max)}
                    </div>
                    <div className="font-mono text-[9px] text-text-primary">{b.count} trades</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between">
            <span className="font-mono text-[8px] text-ember-red/60">{formatUsd(buckets[0]?.min ?? 0)}</span>
            <span className="font-mono text-[8px] text-text-secondary/40">$0</span>
            <span className="font-mono text-[8px] text-ember-green/60">
              {formatUsd(buckets[buckets.length - 1]?.max ?? 0)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
