"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarketStore } from "@/stores/marketStore";
import { useStatsStore } from "@/stores/statsStore";
import { useTraderStore } from "@/stores/traderStore";
import { api } from "@/lib/api";
import { wsClient } from "@/lib/ws";
import { COLORS } from "@/lib/constants";
import clsx from "clsx";

const TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1d" },
] as const;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

export function Chart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const currentCandleRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  // Full candle dataset (ascending by time). Kept in a ref so the scroll-back
  // loader can prepend older pages without forcing a re-render cascade.
  const allCandlesRef = useRef<Candle[]>([]);
  const loadingOlderRef = useRef(false);
  const noMoreOlderRef = useRef(false);
  const [earliestTime, setEarliestTime] = useState<number | null>(null);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const [activeTimeframe, setActiveTimeframe] = useState("1m");
  const [chartError, setChartError] = useState<string | null>(null);
  const [showMarkers, setShowMarkers] = useState(true);
  const { publicKey } = useWallet();
  const lastRefresh = useTraderStore((s) => s.lastRefresh);

  // WS candle handler — updates the last bar in real-time
  // Only process candles matching the active timeframe (WS only sends 1m)
  const activeTimeframeRef = useRef(activeTimeframe);
  activeTimeframeRef.current = activeTimeframe;

  const handleCandleUpdate = useCallback((data: any) => {
    if (!data?.candle || !candleSeriesRef.current) return;
    // Bug fix #2: WS only sends 1m candles — filter by active timeframe
    if (data.timeframe && data.timeframe !== activeTimeframeRef.current) return;
    const c = data.candle;
    // Bug fix #1: Backend sends ms timestamps, Lightweight Charts expects seconds
    const time = c.time > 1e12 ? Math.floor(c.time / 1000) : c.time;
    const candle = { time, open: c.open, high: c.high, low: c.low, close: c.close };
    currentCandleRef.current = candle;
    candleSeriesRef.current.update(candle);
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.update({
        time,
        value: c.volume || 0,
        color:
          c.close >= c.open
            ? "rgba(46,226,155,0.15)"
            : "rgba(242,59,78,0.15)",
      });
    }
  }, []);

  useEffect(() => {
    if (!chartAreaRef.current) return;

    setChartError(null);
    let chart: any;
    let observer: ResizeObserver | null = null;
    let unsubCandles: (() => void) | null = null;
    const abortController = new AbortController();

    async function initChart() {
      const { createChart, ColorType, CrosshairMode } = await import("lightweight-charts");
      if (!chartAreaRef.current) return;

      chart = createChart(chartAreaRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: COLORS.surfaceL1 },
          textColor: COLORS.textSecondary,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "rgba(42,43,51,0.5)" },
          horzLines: { color: "rgba(42,43,51,0.5)" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: "rgba(255,85,0,0.3)",
            width: 1,
            style: 2,
            labelBackgroundColor: COLORS.emberOrange,
          },
          horzLine: {
            color: "rgba(255,85,0,0.3)",
            width: 1,
            style: 2,
            labelBackgroundColor: COLORS.surfaceL2,
          },
        },
        rightPriceScale: {
          borderColor: COLORS.emberBorder,
          textColor: COLORS.textSecondary,
          entireTextOnly: true,
        },
        timeScale: {
          borderColor: COLORS.emberBorder,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 5,
          barSpacing: 6,
          fixLeftEdge: false,
          fixRightEdge: true,
        },
        localization: {
          timeFormatter: (timestamp: number) => {
            const date = new Date(timestamp * 1000);
            return date.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });
          },
        },
        width: chartAreaRef.current.clientWidth,
        height: chartAreaRef.current.clientHeight,
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: COLORS.emberGreen,
        downColor: COLORS.emberRed,
        borderUpColor: COLORS.emberGreen,
        borderDownColor: COLORS.emberRed,
        wickUpColor: COLORS.emberGreen,
        wickDownColor: COLORS.emberRed,
      });
      candleSeriesRef.current = candleSeries;

      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;

      // Reset scroll-back state whenever symbol or timeframe changes.
      allCandlesRef.current = [];
      loadingOlderRef.current = false;
      noMoreOlderRef.current = false;

      // Fetch historical candles from REST (latest page).
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/candles/${selectedSymbol}?timeframe=${activeTimeframe}&limit=300`,
          { signal: abortController.signal }
        );
        if (res.ok) {
          const candles = await res.json();
          const normalized: Candle[] = candles.map((c: any) => ({
            ...c,
            time: c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
          }));
          candleSeries.setData(normalized);
          setChartError(null);
          allCandlesRef.current = normalized;
          setEarliestTime(normalized.length > 0 ? normalized[0].time : null);

          if (normalized.length > 0) {
            const last = normalized[normalized.length - 1];
            currentCandleRef.current = {
              time: last.time,
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close,
            };
          }

          const volumeData = normalized.map((c: any) => ({
            time: c.time,
            value: c.volume || 0,
            color:
              c.close >= c.open
                ? "rgba(46,226,155,0.15)"
                : "rgba(242,59,78,0.15)",
          }));
          volumeSeries.setData(volumeData);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("Failed to fetch candles:", e);
        setChartError("Failed to load chart data");
      }

      // Scroll-back loader: when the user pans the visible window near the
      // left edge of what we've loaded, request the page of candles
      // immediately older than the current earliest one.
      async function loadOlder() {
        if (loadingOlderRef.current || noMoreOlderRef.current) return;
        if (allCandlesRef.current.length === 0) return;
        loadingOlderRef.current = true;
        try {
          const earliestSec = allCandlesRef.current[0].time;
          const before = earliestSec * 1000;
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/candles/${selectedSymbol}?timeframe=${activeTimeframe}&limit=300&before=${before}`,
            { signal: abortController.signal }
          );
          if (!res.ok) return;
          const older = await res.json();
          const normalizedOlder: Candle[] = (older as any[])
            .map((c) => ({
              ...c,
              time: c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
            }))
            .filter((c: Candle) => c.time < earliestSec);
          if (normalizedOlder.length === 0) {
            noMoreOlderRef.current = true;
            return;
          }
          normalizedOlder.sort((a, b) => a.time - b.time);
          const merged = [...normalizedOlder, ...allCandlesRef.current];
          allCandlesRef.current = merged;
          candleSeries.setData(merged);
          volumeSeries.setData(
            merged.map((c) => ({
              time: c.time as any,
              value: c.volume || 0,
              color:
                c.close >= c.open
                  ? "rgba(46,226,155,0.15)"
                  : "rgba(242,59,78,0.15)",
            }))
          );
          setEarliestTime(merged[0].time);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          console.error("Failed to fetch older candles:", e);
        } finally {
          loadingOlderRef.current = false;
        }
      }

      chart
        .timeScale()
        .subscribeVisibleLogicalRangeChange((range: any) => {
          if (!range) return;
          const barsInfo = candleSeries.barsInLogicalRange(range);
          if (barsInfo && barsInfo.barsBefore < 15) loadOlder();
        });

      // Subscribe to real-time candle updates via WebSocket
      unsubCandles = wsClient.subscribe(
        "candles",
        selectedSymbol,
        handleCandleUpdate
      );

      // Handle resize
      observer = new ResizeObserver(() => {
        if (chartAreaRef.current) {
          chart.applyOptions({
            width: chartAreaRef.current.clientWidth,
            height: chartAreaRef.current.clientHeight,
          });
        }
      });
      if (chartAreaRef.current) {
        observer.observe(chartAreaRef.current);
      }
    }

    initChart();

    return () => {
      abortController.abort();
      unsubCandles?.();
      observer?.disconnect();
      chart?.remove();
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      currentCandleRef.current = null;
    };
  }, [selectedSymbol, activeTimeframe, handleCandleUpdate]);

  // Real-time price tick: update current candle's close from mark_price,
  // and roll to a new candle when the time bucket changes.
  // Bridges the gap between infrequent WS candle events and the
  // continuously-updating mark price from the stats channel.
  useEffect(() => {
    const tfSeconds: Record<string, number> = {
      "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
    };
    let lastPrice = 0;
    const unsub = useStatsStore.subscribe((state) => {
      const markPrice = state.stats?.mark_price;
      if (!markPrice || markPrice === lastPrice || !candleSeriesRef.current) return;
      lastPrice = markPrice;

      const interval = tfSeconds[activeTimeframeRef.current] || 60;
      const bucketTime = Math.floor(Date.now() / 1000 / interval) * interval;
      const current = currentCandleRef.current;

      if (!current || current.time !== bucketTime) {
        // Either no candle yet, or the time bucket just rolled over.
        // Start a fresh bar anchored at markPrice instead of stretching
        // the previous one — lightweight-charts treats series.update()
        // with a new timestamp as an append.
        currentCandleRef.current = {
          time: bucketTime as any,
          open: markPrice,
          high: markPrice,
          low: markPrice,
          close: markPrice,
        };
        candleSeriesRef.current.update(currentCandleRef.current);
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({
            time: bucketTime as any,
            value: 0,
            color: "rgba(46,226,155,0.15)",
          });
        }
        return;
      }
      current.close = markPrice;
      if (markPrice > current.high) current.high = markPrice;
      if (markPrice < current.low) current.low = markPrice;
      candleSeriesRef.current.update({ ...current });
    });
    return unsub;
  }, [selectedSymbol, activeTimeframe]);

  // Trade markers: overlay the user's historical fills on this market's chart.
  // Pure-icon encoding, no text — so candles never cover labels:
  //   • arrow (▲/▼)    — OPENING or adding to a position (taking on risk)
  //   • circle (●)     — CLOSING or reducing a position (bleeding off risk)
  //   • green          — long-side action
  //   • red            — short-side action
  //   • position       — above bar = sold at top, below bar = bought at bottom
  //   • dimmed color on reduces vs fully-closing / opening
  // Exact size/price/time is still available in the Trade History panel.
  useEffect(() => {
    if (!publicKey || !candleSeriesRef.current || !showMarkers) {
      if (candleSeriesRef.current) candleSeriesRef.current.setMarkers([]);
      return;
    }

    let cancelled = false;
    // Only render markers whose time falls inside the loaded candle range.
    // Otherwise lightweight-charts snaps out-of-range markers to the
    // earliest loaded bar, producing a cosmetic pile-up on scroll-back.
    const minTime = earliestTime ?? 0;
    api.getTraderTrades(publicKey.toBase58(), { limit: 200 })
      .then((result) => {
        if (cancelled || !candleSeriesRef.current) return;
        const trades = result.trades || [];
        const markers = trades
          .filter((t: any) => t.marketSymbol === selectedSymbol)
          .filter((t: any) => {
            const ts = new Date(t.timestamp).getTime() / 1000;
            return ts >= minTime;
          })
          .map((t: any) => {
            const ts = new Date(t.timestamp);
            const time = Math.floor(ts.getTime() / 1000);
            const before = parseFloat(t.baseLotsBefore || "0");
            const after = parseFloat(t.baseLotsAfter || "0");
            const delta = parseFloat(t.baseLotsDelta || "0");
            const absBefore = Math.abs(before);
            const absAfter = Math.abs(after);
            const isBuy = delta > 0;

            // Classify: opening/adding vs closing/reducing, and which side.
            let opening: boolean;
            let longSide: boolean;
            if (absBefore === 0 && absAfter > 0) {
              opening = true;
              longSide = after > 0;
            } else if (absAfter === 0 && absBefore > 0) {
              opening = false;
              longSide = before > 0;
            } else if (absAfter > absBefore) {
              opening = true;
              longSide = (after || delta) > 0;
            } else {
              opening = false;
              longSide = before > 0;
            }

            const color = longSide
              ? opening ? COLORS.emberGreen : "rgba(46,226,155,0.6)"
              : opening ? COLORS.emberRed : "rgba(242,59,78,0.6)";

            // Shape encodes action, not trade direction:
            //   open/add  → arrow (entering risk)
            //   close/red → circle (exiting risk)
            let shape: "arrowUp" | "arrowDown" | "circle";
            if (opening) {
              shape = isBuy ? "arrowUp" : "arrowDown";
            } else {
              shape = "circle";
            }

            return {
              time,
              position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
              color,
              shape,
              text: "",
            };
          })
          .sort((a: any, b: any) => a.time - b.time);
        candleSeriesRef.current.setMarkers(markers);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [publicKey, selectedSymbol, activeTimeframe, showMarkers, lastRefresh, earliestTime]);

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-ember-border/50 bg-surface-l1 px-2 py-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setActiveTimeframe(tf.value)}
            className={clsx(
              "px-2 py-0.5 font-mono text-[10px] transition-colors",
              activeTimeframe === tf.value
                ? "bg-surface-l2 text-ember-orange"
                : "text-text-secondary/60 hover:text-text-secondary"
            )}
          >
            {tf.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {publicKey && (
            <button
              onClick={() => setShowMarkers((v) => !v)}
              className={clsx(
                "px-2 py-0.5 font-mono text-[10px] transition-colors",
                showMarkers
                  ? "bg-surface-l2 text-ember-orange"
                  : "text-text-secondary/60 hover:text-text-secondary"
              )}
              title={showMarkers ? "Hide trade markers" : "Show trade markers"}
            >
              Trades
            </button>
          )}
          <span className="font-mono text-[10px] text-text-secondary/60">
            {selectedSymbol}-PERP
          </span>
        </div>
      </div>

      {/* Chart area */}
      <div ref={chartAreaRef} className="relative flex-1">
        {chartError && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-l1/80">
            <div className="flex flex-col items-center gap-2">
              <span className="font-mono text-[11px] text-ember-red">{chartError}</span>
              <button
                onClick={() => setChartError(null)}
                className="font-mono text-[10px] text-text-secondary/60 hover:text-text-secondary"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
