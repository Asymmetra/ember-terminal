"use client";

import { useMemo, useCallback, useRef, useEffect, useState, memo } from "react";
import { useOrderbookStore } from "@/stores/orderbookStore";
import { formatPrice, formatSize, abbreviateNumber } from "@/lib/format";
import clsx from "clsx";

interface OrderbookLevel {
  price: number;
  size: number;
}

const GROUPING_OPTIONS = [0.01, 0.05, 0.10, 0.50, 1.00, 5.00, 10.00];

function aggregateLevels(
  levels: OrderbookLevel[],
  increment: number,
  side: "bid" | "ask"
): OrderbookLevel[] {
  if (increment <= 0) return levels;
  const map = new Map<number, number>();
  for (const level of levels) {
    const bucket =
      side === "bid"
        ? Math.floor(level.price / increment) * increment
        : Math.ceil(level.price / increment) * increment;
    map.set(bucket, (map.get(bucket) || 0) + level.size);
  }
  const result = Array.from(map.entries()).map(([price, size]) => ({ price, size }));
  return side === "bid"
    ? result.sort((a, b) => b.price - a.price)
    : result.sort((a, b) => a.price - b.price);
}

interface RowProps {
  level: OrderbookLevel;
  cumulative: number;
  maxCumulative: number;
  side: "bid" | "ask";
  priceDecimals: number;
  isHovered: boolean;
  isInHoverRange: boolean;
  onClickPrice: (price: number) => void;
  onHover: (price: number, e: React.MouseEvent) => void;
  onLeave: () => void;
}

const OrderbookRow = memo(function OrderbookRow({
  level, cumulative, maxCumulative, side, priceDecimals,
  isHovered, isInHoverRange, onClickPrice, onHover, onLeave,
}: RowProps) {
  const depthPct = maxCumulative > 0 ? (cumulative / maxCumulative) * 100 : 0;
  const isBid = side === "bid";
  const prevSizeRef = useRef(level.size);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevSizeRef.current !== level.size && flashRef.current) {
      prevSizeRef.current = level.size;
      const el = flashRef.current;
      el.classList.remove("ob-flash");
      void el.offsetWidth;
      el.classList.add("ob-flash");
    }
  }, [level.size]);

  return (
    <div
      onClick={() => onClickPrice(level.price)}
      onMouseEnter={(e) => onHover(level.price, e)}
      onMouseLeave={onLeave}
      className={clsx(
        "relative flex cursor-pointer items-center px-2 transition-colors duration-75",
        isHovered ? "bg-surface-l2/80" : "hover:bg-surface-l2/60"
      )}
      style={{ height: "22px" }}
    >
      {/* Flash overlay */}
      <div
        ref={flashRef}
        className="absolute inset-0 pointer-events-none"
        style={{ "--flash-color": isBid ? "rgba(46,226,155,0.12)" : "rgba(242,59,78,0.12)" } as React.CSSProperties}
      />

      {/* Depth bar */}
      <div
        className={clsx(
          "absolute top-0 bottom-0 pointer-events-none",
          isBid ? "right-0 bg-ember-green/[0.12]" : "right-0 bg-ember-red/[0.12]"
        )}
        style={{ width: `${depthPct}%` }}
      />

      {/* Hover range highlight */}
      {isInHoverRange && !isHovered && (
        <div className={clsx(
          "absolute inset-0 pointer-events-none",
          isBid ? "bg-ember-green/[0.06]" : "bg-ember-red/[0.06]"
        )} />
      )}

      {/* Row data */}
      <div className="relative grid w-full grid-cols-3 font-mono text-[11px] leading-none">
        <span className={isBid ? "text-ember-green" : "text-ember-red"}>
          {formatPrice(level.price, priceDecimals)}
        </span>
        <span className="text-right text-text-primary/90">
          {formatSize(level.size)}
        </span>
        <span className="text-right text-text-secondary/60">
          {formatSize(cumulative)}
        </span>
      </div>
    </div>
  );
});

interface HoverInfo {
  side: "bid" | "ask";
  price: number;
  mouseX: number;
  mouseY: number;
}

interface DepthStats {
  cumSize: number;
  cumNotional: number;
  levels: number;
  vwap: number;
  distFromMid: number;
  slippage: number; // % difference between VWAP and best price (effective slippage if you swept this depth)
}

export function Orderbook() {
  const bids = useOrderbookStore((s) => s.bids);
  const asks = useOrderbookStore((s) => s.asks);
  const setFillPrice = useOrderbookStore((s) => s.setFillPrice);
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxRows, setMaxRows] = useState(15);
  const [grouping, setGrouping] = useState(0.01);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let debounceTimer: ReturnType<typeof setTimeout>;

    const observer = new ResizeObserver((entries) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const entry of entries) {
          const totalHeight = entry.contentRect.height;
          const available = totalHeight - 48;
          const rowsPerSide = Math.max(1, Math.floor(available / 2 / 22));
          setMaxRows(rowsPerSide);
        }
      }, 100);
    });

    observer.observe(el);
    return () => {
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, []);

  const handleClickPrice = useCallback((price: number) => {
    setFillPrice(price);
  }, [setFillPrice]);

  // Aggregate levels by grouping increment
  const groupedBids = useMemo(() => aggregateLevels(bids, grouping, "bid"), [bids, grouping]);
  const groupedAsks = useMemo(() => aggregateLevels(asks, grouping, "ask"), [asks, grouping]);

  // Decimal places based on grouping
  const priceDecimals = grouping >= 1 ? 0 : grouping >= 0.1 ? 1 : 2;

  // Mid price from raw best bid/ask
  const midPrice = useMemo(() => {
    if (bids[0] && asks[0]) return (bids[0].price + asks[0].price) / 2;
    return 0;
  }, [bids, asks]);

  // Compute cumulative totals and max for depth bar proportions
  const { displayAsks, displayBids, maxCumulative } = useMemo(() => {
    const askSlice = groupedAsks.slice(0, maxRows);
    const bidSlice = groupedBids.slice(0, maxRows);

    const askCumulatives = askSlice.reduce<number[]>((acc, l) => {
      acc.push((acc[acc.length - 1] ?? 0) + l.size);
      return acc;
    }, []);

    const bidCumulatives = bidSlice.reduce<number[]>((acc, l) => {
      acc.push((acc[acc.length - 1] ?? 0) + l.size);
      return acc;
    }, []);

    const maxCum = Math.max(
      askCumulatives[askCumulatives.length - 1] || 0,
      bidCumulatives[bidCumulatives.length - 1] || 0,
      1
    );

    return {
      displayAsks: askSlice.map((l, i) => ({ level: l, cumulative: askCumulatives[i] })),
      displayBids: bidSlice.map((l, i) => ({ level: l, cumulative: bidCumulatives[i] })),
      maxCumulative: maxCum,
    };
  }, [groupedBids, groupedAsks, maxRows]);

  const paddedAsks = useMemo(() => {
    const padded = [...displayAsks];
    while (padded.length < maxRows) {
      padded.push({ level: { price: 0, size: 0 }, cumulative: 0 });
    }
    return padded;
  }, [displayAsks, maxRows]);

  const paddedBids = useMemo(() => {
    const padded = [...displayBids];
    while (padded.length < maxRows) {
      padded.push({ level: { price: 0, size: 0 }, cumulative: 0 });
    }
    return padded;
  }, [displayBids, maxRows]);

  // Spread from raw (ungrouped) best bid/ask for accuracy at all grouping levels
  const spread = useMemo(() => {
    if (bids[0] && asks[0]) {
      const spreadVal = asks[0].price - bids[0].price;
      const spreadPct = (spreadVal / asks[0].price) * 100;
      return { value: spreadVal, pct: spreadPct };
    }
    return null;
  }, [bids, asks]);

  // 1% and 2% depth from raw (ungrouped) levels
  const depthStats = useMemo(() => {
    if (!midPrice) return null;
    const calc = (levels: OrderbookLevel[], pct: number) => {
      const threshold = midPrice * (pct / 100);
      let total = 0;
      for (const l of levels) {
        if (Math.abs(l.price - midPrice) <= threshold) {
          total += l.size * l.price;
        }
      }
      return total;
    };
    return {
      bid1: calc(bids, 1), ask1: calc(asks, 1),
      bid2: calc(bids, 2), ask2: calc(asks, 2),
    };
  }, [bids, asks, midPrice]);

  // Compute hover stats: cumulative from best price to hovered level
  const hoverStats = useMemo((): DepthStats | null => {
    if (!hoverInfo || !midPrice) return null;
    const { side, price } = hoverInfo;
    const levels = side === "bid" ? groupedBids : groupedAsks;

    let cumSize = 0;
    let cumNotional = 0;
    let count = 0;
    for (const l of levels) {
      // For bids: include levels from best (highest) down to hovered price
      // For asks: include levels from best (lowest) up to hovered price
      const include = side === "bid" ? l.price >= price : l.price <= price;
      if (include) {
        cumSize += l.size;
        cumNotional += l.size * l.price;
        count++;
      }
    }

    if (count === 0) return null;

    const vwap = cumSize > 0 ? cumNotional / cumSize : 0;
    // Slippage: how much worse VWAP is vs the best available price
    const bestPrice = side === "bid" ? (groupedBids[0]?.price || 0) : (groupedAsks[0]?.price || 0);
    const slippage = bestPrice > 0 && vwap > 0
      ? (Math.abs(vwap - bestPrice) / bestPrice) * 100
      : 0;

    return {
      cumSize,
      cumNotional,
      levels: count,
      vwap,
      distFromMid: midPrice > 0 ? (Math.abs(price - midPrice) / midPrice) * 100 : 0,
      slippage,
    };
  }, [hoverInfo, groupedBids, groupedAsks, midPrice]);

  // Track which prices are in the hover range
  const hoverRangePrices = useMemo((): Set<number> => {
    if (!hoverInfo) return new Set();
    const { side, price } = hoverInfo;
    const levels = side === "bid" ? groupedBids : groupedAsks;
    const prices = new Set<number>();
    for (const l of levels) {
      const include = side === "bid" ? l.price >= price : l.price <= price;
      if (include) prices.add(l.price);
    }
    return prices;
  }, [hoverInfo, groupedBids, groupedAsks]);

  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);

  const updateTooltipPosition = useCallback((mouseY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltipPosition({
      left: rect.right + 4,
      top: Math.max(rect.top, Math.min(mouseY - 120, rect.bottom - 280)),
    });
  }, []);

  const handleHoverAsk = useCallback((price: number, e: React.MouseEvent) => {
    setHoverInfo({ side: "ask", price, mouseX: e.clientX, mouseY: e.clientY });
    updateTooltipPosition(e.clientY);
  }, [updateTooltipPosition]);

  const handleHoverBid = useCallback((price: number, e: React.MouseEvent) => {
    setHoverInfo({ side: "bid", price, mouseX: e.clientX, mouseY: e.clientY });
    updateTooltipPosition(e.clientY);
  }, [updateTooltipPosition]);

  const handleLeave = useCallback(() => {
    setHoverInfo(null);
    setTooltipPosition(null);
  }, []);

  return (
    <div ref={containerRef} className="relative flex h-full flex-col overflow-hidden">
      {/* Column headers */}
      <div className="flex items-center px-2 py-1 text-[10px] text-text-secondary/70">
        <div className="grid flex-1 grid-cols-3">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Total</span>
        </div>
        <select
          value={grouping}
          onChange={(e) => setGrouping(parseFloat(e.target.value))}
          title="Price grouping — rows aggregate levels within this USDC increment"
          className="ml-2 bg-surface-l2 border border-ember-border/50 px-1 py-0.5 font-mono text-[9px] text-text-secondary/70 focus:outline-none focus:border-ember-orange/40 cursor-pointer"
        >
          {GROUPING_OPTIONS.map((g) => (
            <option key={g} value={g}>
              ${g >= 1 ? g.toFixed(0) : g.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {/* Asks (sells) — reversed so cheapest is at bottom near spread */}
      <div className="flex flex-1 flex-col justify-end overflow-hidden">
        <div className="flex flex-col">
          {[...paddedAsks].reverse().map((item, i) =>
            item.level.price === 0 ? (
              <div key={`ask-empty-${i}`} style={{ height: "22px" }} />
            ) : (
              <OrderbookRow
                key={`ask-${item.level.price}`}
                level={item.level}
                cumulative={item.cumulative}
                maxCumulative={maxCumulative}
                side="ask"
                priceDecimals={priceDecimals}
                isHovered={hoverInfo?.price === item.level.price && hoverInfo?.side === "ask"}
                isInHoverRange={hoverInfo?.side === "ask" && hoverRangePrices.has(item.level.price)}
                onClickPrice={handleClickPrice}
                onHover={handleHoverAsk}
                onLeave={handleLeave}
              />
            )
          )}
        </div>
      </div>

      {/* Spread bar */}
      <div className="flex items-center justify-between border-y border-ember-border/50 bg-ember-black/50 px-2" style={{ height: "24px" }}>
        <span className="font-mono text-[10px] text-text-secondary/70">
          Spread
        </span>
        <span className="font-mono text-[10px] text-text-secondary/70">
          {spread
            ? `${formatPrice(spread.value, 2)} (${spread.pct.toFixed(2)}%)`
            : "—"}
        </span>
      </div>

      {/* Bids (buys) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-col">
          {paddedBids.map((item, i) =>
            item.level.price === 0 ? (
              <div key={`bid-empty-${i}`} style={{ height: "22px" }} />
            ) : (
              <OrderbookRow
                key={`bid-${item.level.price}`}
                level={item.level}
                cumulative={item.cumulative}
                maxCumulative={maxCumulative}
                side="bid"
                priceDecimals={priceDecimals}
                isHovered={hoverInfo?.price === item.level.price && hoverInfo?.side === "bid"}
                isInHoverRange={hoverInfo?.side === "bid" && hoverRangePrices.has(item.level.price)}
                onClickPrice={handleClickPrice}
                onHover={handleHoverBid}
                onLeave={handleLeave}
              />
            )
          )}
        </div>
      </div>

      {/* Depth stats footer — compact 3-column grid so the two rows
          line up cleanly and never collide on narrow widths. */}
      {depthStats && (
        <div
          className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 border-t border-ember-border/50 bg-ember-black/50 px-2 py-1 font-mono text-[9px]"
        >
          <span className="text-text-secondary/50">1%</span>
          <span className="text-right text-ember-green">${abbreviateNumber(depthStats.bid1)}</span>
          <span className="text-right text-ember-red">${abbreviateNumber(depthStats.ask1)}</span>
          <span className="text-text-secondary/50">2%</span>
          <span className="text-right text-ember-green">${abbreviateNumber(depthStats.bid2)}</span>
          <span className="text-right text-ember-red">${abbreviateNumber(depthStats.ask2)}</span>
        </div>
      )}

      {/* Hover tooltip — fixed position anchored to orderbook right edge */}
      {hoverInfo && hoverStats && tooltipPosition && (
        <div
          className="fixed z-[200] w-[230px] border border-ember-border bg-[#1A1B20] p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
            transition: "top 120ms ease-out",
          }}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-text-primary">
                Depth Summary
              </span>
              <span className={clsx(
                "font-mono text-[10px] font-medium",
                hoverInfo.side === "bid" ? "text-ember-green" : "text-ember-red"
              )}>
                {hoverInfo.side === "bid" ? "BID" : "ASK"}
              </span>
            </div>

            <div className="h-px bg-ember-border/50" />

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">Price</span>
              <span className={clsx(
                "font-mono text-[10px]",
                hoverInfo.side === "bid" ? "text-ember-green" : "text-ember-red"
              )}>
                ${formatPrice(hoverInfo.price)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">From Mid</span>
              <span className={clsx(
                "font-mono text-[10px]",
                hoverStats.distFromMid < 1 ? "text-ember-green" : hoverStats.distFromMid < 2 ? "text-yellow-500" : "text-ember-red"
              )}>
                {hoverStats.distFromMid.toFixed(2)}%
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">Slippage (VWAP)</span>
              <span className={clsx(
                "font-mono text-[10px] font-medium",
                hoverStats.slippage < 0.1 ? "text-ember-green" : hoverStats.slippage < 0.5 ? "text-yellow-500" : "text-ember-red"
              )}>
                {hoverStats.slippage.toFixed(3)}%
              </span>
            </div>

            <div className="h-px bg-ember-border/30" />

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">Cum. Size</span>
              <span className="font-mono text-[10px] text-text-primary">
                {formatSize(hoverStats.cumSize, 2)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">Cum. Notional</span>
              <span className="font-mono text-[10px] text-text-primary">
                ${abbreviateNumber(hoverStats.cumNotional)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">VWAP</span>
              <span className="font-mono text-[10px] text-text-secondary">
                ${formatPrice(hoverStats.vwap)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">Levels</span>
              <span className="font-mono text-[10px] text-text-secondary">
                {hoverStats.levels}
              </span>
            </div>

            {/* Depth threshold indicator */}
            <div className="h-px bg-ember-border/30" />
            <div className="flex items-center gap-1.5">
              <span className={clsx(
                "inline-block h-1.5 w-1.5 rounded-full",
                hoverStats.distFromMid < 1 ? "bg-ember-green" : hoverStats.distFromMid < 2 ? "bg-yellow-500" : "bg-ember-red"
              )} />
              <span className="font-mono text-[9px] text-text-secondary/60">
                {hoverStats.distFromMid < 1
                  ? "Within 1% depth"
                  : hoverStats.distFromMid < 2
                    ? "Within 2% depth"
                    : `Beyond 2% depth`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
