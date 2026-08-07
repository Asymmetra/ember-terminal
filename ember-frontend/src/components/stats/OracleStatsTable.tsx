"use client";

import type { SymbolStats } from "@/hooks/useOracleFeed";
import { formatPrice } from "@/lib/format";
import clsx from "clsx";

interface Props {
  rows: SymbolStats[];
}

function fmtMs(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${v.toFixed(0)}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

function fmtAge(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${Math.floor(sec % 60).toString().padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h`;
}

function HealthBadge({ health }: { health: SymbolStats["health"] }) {
  const styles: Record<SymbolStats["health"], { label: string; cls: string; dot: string }> = {
    healthy:   { label: "Healthy",  cls: "text-ember-green",        dot: "bg-ember-green" },
    degraded:  { label: "Degraded", cls: "text-yellow-500",         dot: "bg-yellow-500" },
    stale:     { label: "Stale",    cls: "text-ember-red",          dot: "bg-ember-red" },
    "no-data": { label: "No data",  cls: "text-text-secondary/40",  dot: "bg-text-secondary/40" },
  };
  const s = styles[health];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", s.dot)} />
      <span className={clsx("font-mono text-[10px] uppercase tracking-wider", s.cls)}>{s.label}</span>
    </span>
  );
}

export function OracleStatsTable({ rows }: Props) {
  // Sort: healthy first by symbol (so the page reads left-to-right top-down
  // as "trustworthy → suspect").
  const sorted = [...rows].sort((a, b) => {
    const healthRank: Record<SymbolStats["health"], number> = { healthy: 0, degraded: 1, stale: 2, "no-data": 3 };
    const dh = healthRank[a.health] - healthRank[b.health];
    if (dh !== 0) return dh;
    return a.symbol.localeCompare(b.symbol);
  });

  return (
    <div className="overflow-x-auto border border-ember-border bg-surface-l1">
      <table className="w-full min-w-[1000px] font-mono text-[11px]">
        <thead>
          <tr className="border-b border-ember-border/60 text-[10px] text-text-secondary/60">
            <Th align="left">Symbol</Th>
            <Th align="right">Oracle</Th>
            <Th align="right">Mark</Th>
            <Th align="right">Mid</Th>
            <Th align="right">Funding</Th>
            <Th align="right" title="Time since the last update arrived. > 30s = stale (Phoenix is silent on this market or the WS is broken).">Last</Th>
            <Th align="right" title="Median inter-arrival time over the rolling 60s window.">p50</Th>
            <Th align="right" title="95th-percentile inter-arrival time. Healthy if ≤ 500ms.">p95</Th>
            <Th align="right" title="99th-percentile inter-arrival time.">p99</Th>
            <Th align="right" title="Worst inter-arrival gap seen in the window.">max</Th>
            <Th align="right" title="Number of arrivals in the last 60s window.">N/60s</Th>
            <Th align="right" title="Total messages received for this symbol since reset.">Total</Th>
            <Th align="left">Status</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} className="border-b border-ember-border/30">
              <td className="px-3 py-1.5 text-text-primary">{r.symbol}</td>
              <td className="px-3 py-1.5 text-right text-ember-orange">
                {r.oraclePrice != null ? `$${formatPrice(r.oraclePrice)}` : "—"}
              </td>
              <td className="px-3 py-1.5 text-right text-text-primary/80">
                {r.markPrice != null ? `$${formatPrice(r.markPrice)}` : "—"}
              </td>
              <td className="px-3 py-1.5 text-right text-text-secondary/60">
                {r.midPrice != null ? `$${formatPrice(r.midPrice)}` : "—"}
              </td>
              <td className={clsx(
                "px-3 py-1.5 text-right text-[10px]",
                r.fundingRate != null && r.fundingRate >= 0 ? "text-ember-green" : "text-ember-red",
              )}>
                {r.fundingRate != null ? `${(r.fundingRate * 100).toFixed(4)}%` : "—"}
              </td>
              <td className={clsx(
                "px-3 py-1.5 text-right",
                r.ageSec == null ? "text-text-secondary/40"
                : r.ageSec < 5 ? "text-ember-green"
                : r.ageSec < 30 ? "text-yellow-500"
                : "text-ember-red",
              )}>
                {fmtAge(r.ageSec)}
              </td>
              <td className="px-3 py-1.5 text-right text-text-secondary/80">{fmtMs(r.p50Ms)}</td>
              <td className={clsx(
                "px-3 py-1.5 text-right",
                r.p95Ms == null ? "text-text-secondary/40"
                : r.p95Ms < 500 ? "text-ember-green"
                : r.p95Ms < 2000 ? "text-yellow-500"
                : "text-ember-red",
              )}>{fmtMs(r.p95Ms)}</td>
              <td className="px-3 py-1.5 text-right text-text-secondary/60">{fmtMs(r.p99Ms)}</td>
              <td className="px-3 py-1.5 text-right text-text-secondary/50">{fmtMs(r.maxMs)}</td>
              <td className="px-3 py-1.5 text-right text-text-secondary/70">{r.count60s}</td>
              <td className="px-3 py-1.5 text-right text-text-secondary/70">{r.totalUpdates.toLocaleString()}</td>
              <td className="px-3 py-1.5"><HealthBadge health={r.health} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = "left", title }: { children: React.ReactNode; align?: "left" | "right"; title?: string }) {
  return (
    <th className={clsx("px-3 py-1.5 font-normal uppercase tracking-wider", align === "right" ? "text-right" : "text-left")} title={title}>
      {title ? <span className="cursor-help border-b border-dotted border-text-secondary/30">{children}</span> : children}
    </th>
  );
}
