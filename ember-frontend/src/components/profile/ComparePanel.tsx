"use client";

import { formatUsd } from "@/lib/format";
import type { TraderMetrics } from "@/lib/traderMetrics";
import clsx from "clsx";

interface Props {
  label: string;
  you: TraderMetrics | null;
  them: TraderMetrics | null;
  loading: boolean;
  onClear: () => void;
}

interface Row {
  label: string;
  pick: (m: TraderMetrics) => number | null;
  fmt: (v: number | null) => string;
  /** higher value is better (for the ▲ winner marker) */
  higherBetter: boolean;
}

const ratio = (v: number | null) => (v == null ? "—" : v === Infinity ? "∞" : v.toFixed(2));
const usd = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${formatUsd(v)}`);
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const pct0 = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);

const ROWS: Row[] = [
  { label: "ROI", pick: (m) => m.roi, fmt: pct, higherBetter: true },
  { label: "Lifetime net PnL", pick: (m) => m.lifetimeNetPnl, fmt: usd, higherBetter: true },
  { label: "Sharpe", pick: (m) => m.sharpe, fmt: ratio, higherBetter: true },
  { label: "Sortino", pick: (m) => m.sortino, fmt: ratio, higherBetter: true },
  { label: "Calmar", pick: (m) => m.calmar, fmt: ratio, higherBetter: true },
  { label: "Max drawdown", pick: (m) => m.maxDrawdownPct, fmt: pct, higherBetter: true },
  { label: "Win rate", pick: (m) => m.winRate, fmt: pct0, higherBetter: true },
  { label: "Profit factor", pick: (m) => m.profitFactor, fmt: ratio, higherBetter: true },
  { label: "Volume", pick: (m) => m.volume, fmt: (v) => (v == null ? "—" : compact(v)), higherBetter: true },
  { label: "Trades", pick: (m) => m.totalTrades, fmt: (v) => (v == null ? "—" : v.toLocaleString()), higherBetter: true },
];

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return formatUsd(n);
}

export function ComparePanel({ label, you, them, loading, onClear }: Props) {
  return (
    <div className="border border-ember-orange/40 bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ember-orange">
          Head to head · you vs {label}
        </span>
        <button onClick={onClear} className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/50 hover:text-text-primary transition-colors">
          clear ✕
        </button>
      </div>
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="border-b border-ember-border/40 text-[9px] uppercase tracking-wider text-text-secondary/40">
            <th className="px-4 py-1.5 text-left font-normal">Metric</th>
            <th className="px-4 py-1.5 text-right font-normal">You</th>
            <th className="px-4 py-1.5 text-right font-normal">{label}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const yv = you ? r.pick(you) : null;
            const tv = them ? r.pick(them) : null;
            let youWins = false;
            let themWins = false;
            if (yv != null && tv != null && Number.isFinite(yv) && Number.isFinite(tv) && yv !== tv) {
              const yBetter = r.higherBetter ? yv > tv : yv < tv;
              youWins = yBetter;
              themWins = !yBetter;
            }
            return (
              <tr key={r.label} className="border-b border-ember-border/20">
                <td className="px-4 py-1.5 text-text-secondary/70">{r.label}</td>
                <td className={clsx("px-4 py-1.5 text-right tabular-nums", youWins ? "text-ember-green" : "text-text-primary")}>
                  {loading ? "…" : r.fmt(yv)}{youWins && <span className="ml-1 text-ember-green">▲</span>}
                </td>
                <td className={clsx("px-4 py-1.5 text-right tabular-nums", themWins ? "text-ember-green" : "text-text-secondary/80")}>
                  {loading ? "…" : r.fmt(tv)}{themWins && <span className="ml-1 text-ember-green">▲</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
