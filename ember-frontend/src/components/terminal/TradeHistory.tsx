"use client";

import { useMemo } from "react";
import { useTradeStore, hasTimeGap, formatGap } from "@/stores/tradeStore";
import { useTradeDetailStore } from "@/stores/tradeDetailStore";
import { formatPrice, formatSize } from "@/lib/format";
import clsx from "clsx";

export function TradeHistory() {
  const trades = useTradeStore((s) => s.trades);
  const openRecentTrade = useTradeDetailStore((s) => s.openRecentTrade);

  // Compute large trade threshold: top 10% by size or 2x median
  const largeThreshold = useMemo(() => {
    if (trades.length < 5) return Infinity;
    const sizes = trades.map((t) => t.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    const p90 = sizes[Math.floor(sizes.length * 0.9)];
    return Math.min(p90, median * 2);
  }, [trades]);

  // Pre-compute gap indices for rendering
  const gapIndices = useMemo(() => {
    const gaps = new Set<number>();
    for (let i = 0; i < trades.length - 1; i++) {
      if (hasTimeGap(trades[i], trades[i + 1])) {
        gaps.add(i);
      }
    }
    return gaps;
  }, [trades]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Column headers */}
      <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-text-secondary/70">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trade rows */}
      <div className="flex-1 overflow-y-auto">
        {trades.map((trade, i) => {
          const isLarge = trade.size >= largeThreshold;
          const showGap = gapIndices.has(i);
          return (
            <div key={`${trade.timestamp}-${trade.price}-${trade.size}-${i}`}>
              <div
                onClick={() => openRecentTrade(trade)}
                className={clsx(
                  "grid cursor-pointer grid-cols-3 px-2 font-mono leading-none transition-colors hover:bg-surface-l2/40 trade-slide-in",
                  isLarge ? "text-[11.5px] font-semibold" : "text-[11px]"
                )}
                style={{
                  height: "22px",
                  alignItems: "center",
                  backgroundColor: isLarge
                    ? trade.side === "bid" ? "rgba(46,226,155,0.06)" : "rgba(242,59,78,0.06)"
                    : undefined,
                }}
              >
                <span className={trade.side === "bid" ? "text-ember-green" : "text-ember-red"}>
                  {formatPrice(trade.price)}
                </span>
                <span className={clsx("text-right", isLarge ? "text-text-primary" : "text-text-primary/90")}>
                  {formatSize(trade.size)}
                </span>
                <span className="text-right text-text-secondary/60">
                  {(() => {
                    const ts = typeof trade.timestamp === "string"
                      ? new Date(trade.timestamp)
                      : new Date(trade.timestamp * 1000);
                    return ts.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    });
                  })()}
                </span>
              </div>
              {/* Time gap annotation */}
              {showGap && trades[i + 1] && (
                <div className="flex items-center gap-2 px-2 py-0.5">
                  <div className="flex-1 h-px bg-ember-border/40" />
                  <span className="font-mono text-[9px] text-text-secondary/40 whitespace-nowrap">
                    {formatGap(trade, trades[i + 1])}
                  </span>
                  <div className="flex-1 h-px bg-ember-border/40" />
                </div>
              )}
            </div>
          );
        })}

        {trades.length === 0 && (
          <div className="flex items-center justify-center py-12 text-[11px] text-text-secondary/50">
            Waiting for trades...
          </div>
        )}
      </div>
    </div>
  );
}
