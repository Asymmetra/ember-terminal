"use client";

import { useEffect, useRef, useMemo } from "react";
import { useOrderbookStore } from "@/stores/orderbookStore";
import { COLORS } from "@/lib/constants";

const PRICE_SCALE = 100;

export function DepthChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const bidSeriesRef = useRef<any>(null);
  const askSeriesRef = useRef<any>(null);

  const bids = useOrderbookStore((s) => s.bids);
  const asks = useOrderbookStore((s) => s.asks);

  const { bidDepth, askDepth } = useMemo(() => {
    // Bids: sorted desc by price. Cumulate from spread outward, then reverse to ascending.
    let cumBid = 0;
    const bidCum = bids.map((l) => {
      cumBid += l.size;
      return { price: l.price, cumSize: cumBid };
    });
    bidCum.reverse();

    // Asks: sorted asc by price. Cumulate from spread outward.
    let cumAsk = 0;
    const askCum = asks.map((l) => {
      cumAsk += l.size;
      return { price: l.price, cumSize: cumAsk };
    });

    return { bidDepth: bidCum, askDepth: askCum };
  }, [bids, asks]);

  // Keep refs to latest depth data so async init() can read current values
  const bidDepthRef = useRef(bidDepth);
  const askDepthRef = useRef(askDepth);
  bidDepthRef.current = bidDepth;
  askDepthRef.current = askDepth;

  function applyDepthData(
    bid: { price: number; cumSize: number }[],
    ask: { price: number; cumSize: number }[]
  ) {
    if (!bidSeriesRef.current || !askSeriesRef.current) return;
    bidSeriesRef.current.setData(
      bid.map((d) => ({
        time: Math.round(d.price * PRICE_SCALE) as unknown as number,
        value: d.cumSize,
      }))
    );
    askSeriesRef.current.setData(
      ask.map((d) => ({
        time: Math.round(d.price * PRICE_SCALE) as unknown as number,
        value: d.cumSize,
      }))
    );
    chartRef.current?.timeScale().fitContent();
  }

  // Create chart once on mount
  useEffect(() => {
    if (!chartContainerRef.current) return;

    let chart: any;
    let observer: ResizeObserver | null = null;

    async function init() {
      const { createChart, ColorType, LineType } = await import(
        "lightweight-charts"
      );
      if (!chartContainerRef.current) return;

      chart = createChart(chartContainerRef.current, {
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
        rightPriceScale: {
          borderColor: COLORS.emberBorder,
        },
        timeScale: {
          borderColor: COLORS.emberBorder,
          tickMarkFormatter: (time: number) =>
            (time / PRICE_SCALE).toFixed(2),
        },
        localization: {
          timeFormatter: (time: number) => (time / PRICE_SCALE).toFixed(2),
        },
        crosshair: {
          vertLine: {
            color: "rgba(255,85,0,0.3)",
            width: 1,
            style: 2,
            labelBackgroundColor: COLORS.surfaceL2,
          },
          horzLine: {
            color: "rgba(255,85,0,0.3)",
            width: 1,
            style: 2,
            labelBackgroundColor: COLORS.surfaceL2,
          },
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });
      chartRef.current = chart;

      const bidSeries = chart.addAreaSeries({
        lineColor: COLORS.emberGreen,
        topColor: "rgba(46,226,155,0.25)",
        bottomColor: "rgba(46,226,155,0.02)",
        lineWidth: 1,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bidSeriesRef.current = bidSeries;

      const askSeries = chart.addAreaSeries({
        lineColor: COLORS.emberRed,
        topColor: "rgba(242,59,78,0.25)",
        bottomColor: "rgba(242,59,78,0.02)",
        lineWidth: 1,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      askSeriesRef.current = askSeries;

      // Set initial data from refs
      applyDepthData(bidDepthRef.current, askDepthRef.current);

      observer = new ResizeObserver(() => {
        if (chartContainerRef.current) {
          chart.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        }
      });
      observer.observe(chartContainerRef.current);
    }

    init();

    return () => {
      observer?.disconnect();
      chart?.remove();
      chartRef.current = null;
      bidSeriesRef.current = null;
      askSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when depth changes
  useEffect(() => {
    applyDepthData(bidDepth, askDepth);
  }, [bidDepth, askDepth]);

  return <div ref={chartContainerRef} className="h-full w-full" />;
}
