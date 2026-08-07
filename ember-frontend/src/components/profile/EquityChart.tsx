"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { COLORS } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import { filterByPeriod, PERIOD_SECONDS, type NormalizedTrade, type Period } from "@/lib/tradeStats";
import clsx from "clsx";

type Overlay = "pnl" | "drawdown";

const WINDOWS: Period[] = ["24h", "7d", "30d", "all"];
const WINDOW_LABELS: Record<Period, string> = { "24h": "1D", "7d": "7D", "30d": "30D", all: "All" };

interface Pt { time: number; value: number }

interface Props {
  trades: NormalizedTrade[];
  period: Period;
  loading: boolean;
}

/**
 * Cumulative realized-PnL curve. The series is reconstructed from the SAME
 * trade set the rest of the dashboard uses — a running sum of
 * (realizedPnl − fees) within the selected window, baselined to 0 at the
 * window start — so the chart always agrees with the Window Stats strip and
 * spans exactly the selected window (it previously read a sparse,
 * window-agnostic /pnl series that disagreed with everything else).
 *
 * Rendered as a lightweight responsive SVG (crisp non-scaling stroke + a
 * gradient area fill, à la the /stats line) rather than an embedded charting
 * widget — deterministic for static historical data at any window length.
 */
export function EquityChart({ trades, period, loading }: Props) {
  const [overlay, setOverlay] = useState<Overlay>("pnl");
  const [chartWindow, setChartWindow] = useState<Period>(period);

  // Follow the page period; the local window buttons override until the next change.
  useEffect(() => { setChartWindow(period); }, [period]);

  const { pnlPoints, startSec, endSec, finalPnl, hasTrades } = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowed = filterByPeriod(trades, chartWindow).slice().sort((a, b) => a.time - b.time);
    const ps = PERIOD_SECONDS[chartWindow];
    const start = ps == null
      ? (windowed.length ? Math.min(windowed[0].time, nowSec - 86_400) : nowSec - 86_400)
      : nowSec - ps;
    let cum = 0;
    const pts: Pt[] = [{ time: start, value: 0 }];
    for (const t of windowed) {
      cum += t.realizedPnl - t.fees;
      pts.push({ time: Math.max(t.time, start), value: cum });
    }
    pts.push({ time: nowSec, value: cum });
    return { pnlPoints: pts, startSec: start, endSec: nowSec, finalPnl: cum, hasTrades: windowed.length > 0 };
  }, [trades, chartWindow]);

  const { series, headerValue } = useMemo(() => {
    if (overlay !== "drawdown") return { series: pnlPoints, headerValue: finalPnl };
    let peak = -Infinity;
    let maxDd = 0;
    const dd = pnlPoints.map((p) => {
      if (p.value > peak) peak = p.value;
      const v = p.value - peak;
      if (v < maxDd) maxDd = v;
      return { time: p.time, value: v };
    });
    return { series: dd, headerValue: maxDd };
  }, [pnlPoints, overlay, finalPnl]);

  const headerPositive = overlay === "drawdown" ? headerValue >= 0 : finalPnl >= 0;
  const color = overlay === "drawdown" ? COLORS.emberRed : finalPnl >= 0 ? COLORS.emberGreen : COLORS.emberRed;

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ember-border/60 px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
            {overlay === "drawdown" ? "Drawdown" : "Cumulative PnL"}
          </span>
          <span className={clsx("font-mono text-base font-semibold tabular-nums", headerPositive ? "text-ember-green" : "text-ember-red")}>
            {loading ? "…" : `${headerValue >= 0 ? "+" : ""}${formatUsd(headerValue)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-px border border-ember-border/60 bg-ember-black">
            {WINDOWS.map((w) => (
              <Btn key={w} label={WINDOW_LABELS[w]} active={chartWindow === w} onClick={() => setChartWindow(w)} />
            ))}
          </div>
          <div className="flex items-center gap-px border border-ember-border/60 bg-ember-black">
            <Btn label="PnL" active={overlay === "pnl"} onClick={() => setOverlay("pnl")} />
            <Btn label="Drawdown" active={overlay === "drawdown"} onClick={() => setOverlay("drawdown")} />
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex h-[234px] items-center justify-center font-mono text-[10px] text-text-secondary/40">Loading…</div>
      ) : (
        <PnlLineChart series={series} startSec={startSec} endSec={endSec} color={color} height={234} empty={!hasTrades} />
      )}
    </div>
  );
}

function Btn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
        active ? "bg-ember-orange/15 text-ember-orange" : "text-text-secondary/60 hover:text-text-secondary",
      )}
    >
      {label}
    </button>
  );
}

const VW = 1000; // internal viewBox width; SVG scales to fill container

function PnlLineChart({
  series, startSec, endSec, color, height, empty,
}: {
  series: Pt[];
  startSec: number;
  endSec: number;
  color: string;
  height: number;
  empty: boolean;
}) {
  const gradId = useId();
  const [hover, setHover] = useState<{ xPct: number; value: number; time: number } | null>(null);

  const span = Math.max(1, endSec - startSec);
  const values = series.map((p) => p.value);
  // Always include 0 in the range so the baseline is meaningful.
  const dataMax = Math.max(0, ...values);
  const dataMin = Math.min(0, ...values);
  const pad = (dataMax - dataMin) * 0.12 || 1;
  const yTop = dataMax + pad;
  const yBot = dataMin - pad;
  const yRange = yTop - yBot || 1;

  const xFor = (t: number) => ((t - startSec) / span) * VW;
  const yFor = (v: number) => height - ((v - yBot) / yRange) * (height - 2) - 1;
  const zeroY = yFor(0);

  const linePts = series.map((p) => `${xFor(p.time).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(" ");
  const areaPts = `0,${height} ${linePts} ${VW},${height}`;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const t = startSec + frac * span;
    // nearest point by time
    let best = series[0];
    for (const p of series) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
    setHover({ xPct: ((best.time - startSec) / span) * 100, value: best.value, time: best.time });
  }

  return (
    <div className="relative w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${VW} ${height}`} preserveAspectRatio="none" width="100%" height={height} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* horizontal gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={VW} y1={height * f} y2={height * f} stroke="rgba(42,43,51,0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {/* zero baseline */}
        {zeroY > 0 && zeroY < height && (
          <line x1="0" x2={VW} y1={zeroY} y2={zeroY} stroke="rgba(156,163,175,0.35)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        {!empty && <polyline points={areaPts} fill={`url(#${gradId})`} stroke="none" />}
        {!empty && (
          <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {hover && !empty && (
          <line x1={(hover.xPct / 100) * VW} x2={(hover.xPct / 100) * VW} y1="0" y2={height} stroke="rgba(255,85,0,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {/* y-axis range hints */}
      <span className="pointer-events-none absolute right-1 top-1 font-mono text-[9px] text-text-secondary/45">{formatUsd(yTop)}</span>
      <span className="pointer-events-none absolute right-1 bottom-1 font-mono text-[9px] text-text-secondary/45">{formatUsd(yBot)}</span>
      {/* x-axis range hints (right edge is implicitly "now"; y-range labels live on the right) */}
      <span className="pointer-events-none absolute left-2 bottom-1 font-mono text-[9px] text-text-secondary/40">{fmtDate(startSec)}</span>
      <span className="pointer-events-none absolute font-mono text-[9px] text-text-secondary/40" style={{ left: "42%", bottom: 4, transform: "translateX(-50%)" }}>{fmtDate((startSec + endSec) / 2)}</span>

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] text-text-secondary/40">No realized PnL in this window</span>
        </div>
      )}

      {/* hover tooltip */}
      {hover && !empty && (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 whitespace-nowrap border border-ember-border bg-surface-l2 px-2 py-1 shadow-lg"
          style={{ left: `${hover.xPct}%` }}
        >
          <div className="font-mono text-[9px] text-text-secondary">{fmtDateTime(hover.time)}</div>
          <div className={clsx("font-mono text-[10px] tabular-nums", hover.value >= 0 ? "text-ember-green" : "text-ember-red")}>
            {hover.value >= 0 ? "+" : ""}{formatUsd(hover.value)}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(tSec: number): string {
  const d = new Date(tSec * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(tSec: number): string {
  const d = new Date(tSec * 1000);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
