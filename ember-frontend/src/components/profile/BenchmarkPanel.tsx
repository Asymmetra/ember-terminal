"use client";

import { useEffect, useState } from "react";
import { buyHoldReturnPct, BENCHMARK_SYMBOLS } from "@/lib/benchmark";
import { PERIOD_SECONDS, type Period, type PnlPoint } from "@/lib/tradeStats";
import clsx from "clsx";

interface Props {
  dailyPnl: PnlPoint[];
  equityBase: number;
  period: Period;
  loading: boolean;
}

/**
 * Frames the trader's window return against simply buying & holding spot
 * (real candle data). "You returned X% while SOL did Y%" — the alpha is the
 * gap. Return % uses ΔcumulativePnl over the window ÷ capital base.
 */
export function BenchmarkPanel({ dailyPnl, equityBase, period, loading }: Props) {
  const [bench, setBench] = useState<Record<string, number | null>>({});
  const [benchLoading, setBenchLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBenchLoading(true);
    Promise.all(BENCHMARK_SYMBOLS.map((s) => buyHoldReturnPct(s, period))).then((vals) => {
      if (cancelled) return;
      const map: Record<string, number | null> = {};
      BENCHMARK_SYMBOLS.forEach((s, i) => (map[s] = vals[i]));
      setBench(map);
      setBenchLoading(false);
    });
    return () => { cancelled = true; };
  }, [period]);

  const windowSec = PERIOD_SECONDS[period];
  const windowed = windowSec == null
    ? dailyPnl
    : dailyPnl.filter((p) => p.time >= Math.floor(Date.now() / 1000) - windowSec);
  const traderReturn = windowed.length >= 2
    ? (windowed[windowed.length - 1].cumulativePnl - windowed[0].cumulativePnl) / Math.max(equityBase, 1)
    : null;

  const rows: Array<{ label: string; value: number | null; you?: boolean }> = [
    { label: "You", value: traderReturn, you: true },
    ...BENCHMARK_SYMBOLS.map((s) => ({ label: `${s} buy & hold`, value: bench[s] ?? null })),
  ];
  const span = Math.max(0.0001, ...rows.map((r) => Math.abs(r.value ?? 0)));

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Return vs benchmark</span>
        <span className="font-mono text-[9px] text-text-secondary/40">window return %</span>
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {rows.map((r) => {
          const v = r.value;
          const pos = (v ?? 0) >= 0;
          const widthPct = v == null ? 0 : (Math.abs(v) / span) * 100;
          return (
            <div key={r.label} className="flex items-center gap-3">
              <span className={clsx("w-28 shrink-0 font-mono text-[10px]", r.you ? "text-text-primary" : "text-text-secondary/60")}>
                {r.label}
              </span>
              <div className="relative h-2 flex-1 bg-ember-border/30">
                <div
                  className={clsx("absolute top-0 h-full", pos ? "bg-ember-green/60" : "bg-ember-red/60")}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className={clsx("w-16 shrink-0 text-right font-mono text-[11px] tabular-nums", v == null ? "text-text-secondary/40" : pos ? "text-ember-green" : "text-ember-red")}>
                {loading || (r.you ? false : benchLoading) ? "…" : v == null ? "—" : `${pos ? "+" : ""}${(v * 100).toFixed(1)}%`}
              </span>
            </div>
          );
        })}
        {traderReturn != null && bench.SOL != null && (
          <div className="mt-1 border-t border-ember-border/40 pt-2 font-mono text-[10px] text-text-secondary/60">
            Alpha vs SOL:{" "}
            <span className={clsx("tabular-nums", traderReturn - bench.SOL >= 0 ? "text-ember-green" : "text-ember-red")}>
              {traderReturn - bench.SOL >= 0 ? "+" : ""}{((traderReturn - bench.SOL) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
