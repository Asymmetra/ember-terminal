"use client";

import { formatUsd } from "@/lib/format";
import type { TraderMetrics } from "@/lib/traderMetrics";
import clsx from "clsx";

interface Props {
  metrics: TraderMetrics | null;
  loading: boolean;
}

/**
 * Lifetime headline strip — always populated regardless of the selected
 * window (these come from current account state + the full PnL series, not
 * the windowed trade set), so the dashboard never reads as empty.
 */
export function HeadlineTiles({ metrics, loading }: Props) {
  const m = metrics;
  const upnlPos = (m?.unrealizedPnl ?? 0) >= 0;
  const netPos = (m?.lifetimeNetPnl ?? 0) >= 0;
  const roiPos = (m?.roi ?? 0) >= 0;

  return (
    <div className="grid grid-cols-2 gap-px border border-ember-border bg-ember-border/40 sm:grid-cols-4">
      <Tile
        label="Equity"
        value={m ? formatUsd(m.equity) : "—"}
        sub={m ? `${upnlPos ? "+" : ""}${formatUsd(m.unrealizedPnl)} uPnL` : undefined}
        subClass={upnlPos ? "text-ember-green/80" : "text-ember-red/80"}
        loading={loading}
      />
      <Tile
        label="Lifetime net PnL"
        value={m ? `${netPos ? "+" : ""}${formatUsd(m.lifetimeNetPnl)}` : "—"}
        valueClass={m ? (netPos ? "text-ember-green" : "text-ember-red") : undefined}
        sub="after fees"
        loading={loading}
      />
      <Tile
        label="ROI"
        value={m?.roi != null ? `${m.roi >= 0 ? "+" : ""}${(m.roi * 100).toFixed(1)}%` : "—"}
        valueClass={m?.roi != null ? (roiPos ? "text-ember-green" : "text-ember-red") : undefined}
        sub={m?.roi != null ? "on net deposits" : "no deposit basis"}
        loading={loading}
      />
      <Tile
        label="Net deposits"
        value={m ? formatUsd(m.netDeposits) : "—"}
        sub={m ? `${m.totalTrades.toLocaleString()} trades` : undefined}
        loading={loading}
      />
    </div>
  );
}

function Tile({
  label, value, valueClass, sub, subClass, loading,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  subClass?: string;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface-l1 px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">{label}</span>
      <span
        className={clsx("font-mono text-xl font-semibold tabular-nums", valueClass || "text-text-primary")}
        style={{ letterSpacing: "-0.02em" }}
      >
        {loading ? "…" : value}
      </span>
      {sub && <span className={clsx("font-mono text-[10px]", subClass || "text-text-secondary/50")}>{sub}</span>}
    </div>
  );
}
