"use client";

import { useMemo } from "react";
import type { DataSource } from "@/lib/observability/types";

interface Props {
  /** All observability sources from the hook. We filter to phoenix-ws-market here. */
  sources: DataSource[];
}

interface MarketPayload {
  oraclePx?: number;
  markPx?: number;
  midPx?: number;
  openInterest?: number;
  prevDayPx?: number;
  dayNtlVlm?: number;
  funding?: number;
}

interface Aggregates {
  activeMarkets: number;
  totalOiUsd: number;
  totalVolUsd: number;
  avgAbsSpreadBps: number | null;
  topOi: { symbol: string; usd: number } | null;
  biggestMover: { symbol: string; changePct: number } | null;
}

function fmtUsdAbbrev(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Aggregate-stats strip at the top of /stats. Sums + extremes derived
 * client-side from the per-market `phoenix-ws-market` payloads we
 * already ingest — no extra requests. Re-aggregates on every snapshot
 * tick, but the math is O(symbols) with ~30 markets, so it's free.
 *
 * Tiles shown:
 *   - Active markets    (count of phoenix-ws-market sources with a
 *                        live payload)
 *   - Total OI          (Σ markPx × openInterest)
 *   - 24h Volume        (Σ dayNtlVlm)
 *   - Avg |spread|      (mean of |mark − oracle| in bps)
 *   - Top market by OI  (largest single OI USD)
 *   - Biggest 24h mover (largest |%| change vs prevDayPx)
 *
 * Skipped: per-tile sparklines, time-series of these aggregates. If we
 * want trend, that's a separate "system metrics" panel.
 */
export function MarketOverview({ sources }: Props) {
  const agg = useMemo<Aggregates>(() => computeAggregates(sources), [sources]);

  return (
    <div className="grid grid-cols-2 gap-px border border-ember-border bg-ember-border/40 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Active markets" value={agg.activeMarkets.toString()} sublabel="with live payload" />
      <Tile label="Total OI"       value={fmtUsdAbbrev(agg.totalOiUsd)} sublabel="across all markets" emphasis="primary" />
      <Tile label="24h Volume"     value={fmtUsdAbbrev(agg.totalVolUsd)} sublabel="rolling 24h notional" emphasis="primary" />
      <Tile
        label="Avg |spread|"
        value={agg.avgAbsSpreadBps != null ? `${agg.avgAbsSpreadBps.toFixed(2)} bp` : "—"}
        sublabel="|mark − oracle| across markets"
      />
      <Tile
        label="Top market"
        value={agg.topOi ? agg.topOi.symbol : "—"}
        sublabel={agg.topOi ? `OI ${fmtUsdAbbrev(agg.topOi.usd)}` : "no data yet"}
      />
      <Tile
        label="Biggest 24h move"
        value={agg.biggestMover ? agg.biggestMover.symbol : "—"}
        sublabel={agg.biggestMover ? `${agg.biggestMover.changePct >= 0 ? "+" : ""}${agg.biggestMover.changePct.toFixed(2)}%` : "no data yet"}
        sublabelColor={
          agg.biggestMover == null ? "text-text-secondary/40"
          : agg.biggestMover.changePct >= 0 ? "text-ember-green"
          : "text-ember-red"
        }
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sublabel,
  sublabelColor,
  emphasis,
}: {
  label: string;
  value: string;
  sublabel?: string;
  sublabelColor?: string;
  emphasis?: "primary" | "default";
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface-l1 px-3 py-2">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">{label}</span>
      <span className={`font-mono tabular-nums ${emphasis === "primary" ? "text-base text-text-primary" : "text-sm text-text-primary"}`}>
        {value}
      </span>
      {sublabel && (
        <span className={`font-mono text-[9px] tabular-nums ${sublabelColor ?? "text-text-secondary/45"}`}>{sublabel}</span>
      )}
    </div>
  );
}

function computeAggregates(sources: DataSource[]): Aggregates {
  let activeMarkets = 0;
  let totalOiUsd = 0;
  let totalVolUsd = 0;
  let spreadSum = 0;
  let spreadCount = 0;
  let topOi: { symbol: string; usd: number } | null = null;
  let biggestMover: { symbol: string; changePct: number } | null = null;

  for (const s of sources) {
    if (s.kind !== "phoenix-ws-market") continue;
    const p = s.latestPayload as MarketPayload | null;
    if (!p || typeof p.markPx !== "number") continue;

    activeMarkets += 1;

    if (typeof p.openInterest === "number" && Number.isFinite(p.openInterest)) {
      const oiUsd = p.openInterest * p.markPx;
      totalOiUsd += oiUsd;
      if (s.symbol && (!topOi || oiUsd > topOi.usd)) {
        topOi = { symbol: s.symbol, usd: oiUsd };
      }
    }

    if (typeof p.dayNtlVlm === "number" && Number.isFinite(p.dayNtlVlm)) {
      totalVolUsd += p.dayNtlVlm;
    }

    if (typeof p.oraclePx === "number" && p.oraclePx > 0) {
      const spreadBps = Math.abs(((p.markPx - p.oraclePx) / p.oraclePx) * 10_000);
      spreadSum += spreadBps;
      spreadCount += 1;
    }

    if (typeof p.prevDayPx === "number" && p.prevDayPx > 0) {
      const changePct = ((p.markPx - p.prevDayPx) / p.prevDayPx) * 100;
      if (s.symbol && (!biggestMover || Math.abs(changePct) > Math.abs(biggestMover.changePct))) {
        biggestMover = { symbol: s.symbol, changePct };
      }
    }
  }

  return {
    activeMarkets,
    totalOiUsd,
    totalVolUsd,
    avgAbsSpreadBps: spreadCount > 0 ? spreadSum / spreadCount : null,
    topOi,
    biggestMover,
  };
}
