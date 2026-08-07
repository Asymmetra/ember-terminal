"use client";

import { useMemo, useState } from "react";
import { formatUsd } from "@/lib/format";
import type { PnlPoint } from "@/lib/tradeStats";
import clsx from "clsx";

interface Props {
  /** Daily-resolution cumulative PnL series (ascending by time). */
  dailyPnl: PnlPoint[];
  loading: boolean;
}

interface MonthBlock {
  label: string;
  year: number;
  weeks: { date: Date; pnl: number | null }[][];
}

/**
 * GitHub-style daily-PnL heatmap. Reimplemented from /analytics to read the
 * real `cumulativePnl` field (the original read a non-existent
 * `cumulative_pnl`, so it rendered blank).
 */
export function PnlCalendar({ dailyPnl, loading }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<{ date: string; pnl: number; x: number; y: number } | null>(null);

  const pnlByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < dailyPnl.length; i++) {
      const cur = dailyPnl[i].cumulativePnl;
      const prev = i > 0 ? dailyPnl[i - 1].cumulativePnl : cur;
      const date = new Date(dailyPnl[i].time * 1000).toISOString().slice(0, 10);
      m.set(date, i === 0 ? 0 : cur - prev);
    }
    return m;
  }, [dailyPnl]);

  const allMonths = useMemo<MonthBlock[]>(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(1);
    const months: MonthBlock[] = [];
    const cursor = new Date(start);
    while (cursor <= today) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const weeks: { date: Date; pnl: number | null }[][] = [];
      let week: { date: Date; pnl: number | null }[] = [];
      for (let i = 0; i < monthStart.getDay(); i++) week.push({ date: new Date(0), pnl: null });
      const day = new Date(monthStart);
      while (day <= monthEnd && day <= today) {
        const ds = day.toISOString().slice(0, 10);
        if (day.getDay() === 0 && week.length > 0) {
          weeks.push(week);
          week = [];
        }
        week.push({ date: new Date(day), pnl: pnlByDate.has(ds) ? pnlByDate.get(ds)! : null });
        day.setDate(day.getDate() + 1);
      }
      while (week.length < 7) week.push({ date: new Date(0), pnl: null });
      if (week.length > 0) weeks.push(week);
      months.push({ label: monthStart.toLocaleDateString("en-US", { month: "short" }), year: monthStart.getFullYear(), weeks });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [pnlByDate]);

  const visibleMonths = expanded ? allMonths : allMonths.slice(-4);
  const maxAbs = useMemo(() => {
    const v = Array.from(pnlByDate.values()).map(Math.abs).filter((x) => x > 0);
    return v.length > 0 ? Math.max(...v) : 1;
  }, [pnlByDate]);

  // NOTE: full literal class strings — Tailwind's JIT can't see
  // template-constructed names like `bg-${c}/70`, so they'd never compile.
  function cellColor(pnl: number | null): string {
    if (pnl === null) return "bg-[#1E1F25] border border-[#2A2B33]/50";
    if (pnl === 0) return "bg-[#2A2B33] border border-[#2A2B33]";
    const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
    if (pnl > 0) {
      if (intensity > 0.75) return "bg-ember-green border border-ember-green/60";
      if (intensity > 0.5) return "bg-ember-green/70 border border-ember-green/40";
      if (intensity > 0.25) return "bg-ember-green/40 border border-ember-green/25";
      return "bg-ember-green/20 border border-ember-green/15";
    }
    if (intensity > 0.75) return "bg-ember-red border border-ember-red/60";
    if (intensity > 0.5) return "bg-ember-red/70 border border-ember-red/40";
    if (intensity > 0.25) return "bg-ember-red/40 border border-ember-red/25";
    return "bg-ember-red/20 border border-ember-red/15";
  }

  return (
    <div className="border border-ember-border bg-surface-l1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Daily PnL</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="font-mono text-[8px] text-text-secondary/40">Loss</span>
            <span className="h-2 w-2 rounded-[1px] bg-ember-red/30 border border-ember-red/20" />
            <span className="h-2 w-2 rounded-[1px] bg-ember-red border border-ember-red/60" />
            <span className="h-2 w-2 rounded-[1px] bg-[#2A2B33] border border-[#2A2B33]" />
            <span className="h-2 w-2 rounded-[1px] bg-ember-green/30 border border-ember-green/20" />
            <span className="h-2 w-2 rounded-[1px] bg-ember-green border border-ember-green/60" />
            <span className="font-mono text-[8px] text-text-secondary/40">Profit</span>
          </div>
          {allMonths.length > 4 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="font-mono text-[9px] text-ember-orange/70 hover:text-ember-orange transition-colors"
            >
              {expanded ? "Show 4 months" : `Show all (${allMonths.length}mo)`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-[110px] items-center justify-center font-mono text-[10px] text-text-secondary/40 animate-pulse">
          Loading…
        </div>
      ) : dailyPnl.length === 0 ? (
        <div className="flex h-[110px] items-center justify-center font-mono text-[10px] text-text-secondary/40">
          No daily PnL history.
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto">
          {visibleMonths.map((month, mi) => (
            <div key={`${month.label}-${month.year}-${mi}`} className="flex-shrink-0">
              <div className="mb-1.5 flex items-baseline gap-1">
                <span className="font-mono text-[10px] font-medium text-text-primary">{month.label}</span>
                <span className="font-mono text-[8px] text-text-secondary/40">{month.year}</span>
              </div>
              <div className="flex gap-[2px]">
                <div className="mr-0.5 flex flex-col gap-[2px]">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="flex h-[12px] w-3 items-center justify-end">
                      <span className="font-mono text-[7px] text-text-secondary/25">{d}</span>
                    </div>
                  ))}
                </div>
                {month.weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[2px]">
                    {week.map((cell, ci) => {
                      if (cell.date.getTime() === 0) return <div key={ci} className="h-[12px] w-[12px]" />;
                      return (
                        <div
                          key={ci}
                          className={clsx("h-[12px] w-[12px] rounded-[1px] cursor-pointer transition-all hover:brightness-125", cellColor(cell.pnl))}
                          onMouseEnter={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setTooltip({
                              date: cell.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                              pnl: cell.pnl ?? 0,
                              x: r.left + r.width / 2,
                              y: r.top - 44,
                            });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 border border-ember-border bg-surface-l2 px-2.5 py-1.5 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-mono text-[9px] text-text-secondary">{tooltip.date}</div>
          <div className={clsx("font-mono text-[10px] font-medium", tooltip.pnl > 0 ? "text-ember-green" : tooltip.pnl < 0 ? "text-ember-red" : "text-text-secondary/60")}>
            {tooltip.pnl > 0 ? "+" : ""}{formatUsd(tooltip.pnl)}
          </div>
        </div>
      )}
    </div>
  );
}
