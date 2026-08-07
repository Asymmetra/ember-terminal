"use client";

import type { ConnectionStats } from "@/hooks/useOracleFeed";
import clsx from "clsx";

interface Props {
  connection: ConnectionStats;
  onExportCsv: () => void;
  onResetStats: () => void;
  enableAllMids: boolean;
  onToggleAllMids: (next: boolean) => void;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${Math.floor(sec % 60).toString().padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60).toString().padStart(2, "0")}m`;
}

function fmtAge(ms: number | null): string {
  if (ms == null) return "—";
  const ageSec = (performance.now() - ms) / 1000;
  if (ageSec < 1) return `${(ageSec * 1000).toFixed(0)}ms`;
  if (ageSec < 60) return `${ageSec.toFixed(1)}s`;
  return `${Math.floor(ageSec / 60)}m${Math.floor(ageSec % 60).toString().padStart(2, "0")}s`;
}

export function ConnectionPanel({ connection, onExportCsv, onResetStats, enableAllMids, onToggleAllMids }: Props) {
  const statusColor =
    connection.state === "connected" ? "text-ember-green"
    : connection.state === "reconnecting" || connection.state === "connecting" ? "text-yellow-500"
    : "text-ember-red";
  const dot =
    connection.state === "connected" ? "bg-ember-green"
    : connection.state === "reconnecting" || connection.state === "connecting" ? "bg-yellow-500"
    : "bg-ember-red";

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center gap-6 border-b border-ember-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={clsx("inline-block h-2 w-2 rounded-full", dot)} />
          <span className={clsx("font-mono text-[11px] uppercase tracking-wider", statusColor)}>
            {connection.state}
          </span>
        </div>
        <Stat label="Uptime" value={fmtDuration(connection.uptimeSec)} />
        <Stat label="Reconnects" value={connection.reconnects.toString()} colorOnNonZero />
        <Stat label="Total updates" value={connection.totalUpdates.toLocaleString()} />
        <Stat label="Rate (60s)" value={`${connection.rateMsgsPerSec60s.toFixed(1)} msg/s`} />
        {enableAllMids && (
          <Stat
            label="allMids last"
            value={fmtAge(connection.allMidsLastUpdateAtMs)}
            tooltip={connection.allMidsSlot != null ? `Slot ${connection.allMidsSlot}` : undefined}
          />
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={enableAllMids}
              onChange={(e) => onToggleAllMids(e.target.checked)}
              className="accent-ember-orange"
            />
            <span
              className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/70"
              title="Subscribe to the allMids global heartbeat in parallel — useful for distinguishing 'Phoenix is silent on this market' from 'WS is dead'."
            >
              allMids heartbeat
            </span>
          </label>
          <button
            onClick={onResetStats}
            className="border border-ember-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors"
          >
            Reset stats
          </button>
          <button
            onClick={onExportCsv}
            className="border border-ember-orange/40 bg-ember-orange/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ember-orange hover:bg-ember-orange/20 transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="px-4 py-1.5 font-mono text-[9px] text-text-secondary/40">
        {connection.url}
      </div>
    </div>
  );
}

function Stat({ label, value, colorOnNonZero, tooltip }: { label: string; value: string; colorOnNonZero?: boolean; tooltip?: string }) {
  const isNonZero = colorOnNonZero && value !== "0";
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">{label}</span>
      <span className={clsx("font-mono text-[11px]", isNonZero ? "text-yellow-500" : "text-text-primary")}>{value}</span>
    </div>
  );
}
