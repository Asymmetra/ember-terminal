"use client";

/**
 * Materializes liveline-ready series from the chart history store +
 * the live observability snapshot.
 *
 * Architecture:
 *   - `useStatsChartHistoryStore` holds 1Hz-downsampled samples per
 *     symbol for up to 1 hour, persisted to localStorage.
 *   - `LiveComparisonChart` is responsible for pushing fresh samples
 *     into the store on each observability snapshot tick (~500ms).
 *   - This hook reads the relevant window from the store, materializes
 *     LivelineSeries arrays for each of the 6 lines, and also reads
 *     the LIVE values + latest orderbook + latest candles directly
 *     from the observability snapshot so the chart's right-edge
 *     cursor stays fresh between 1s history samples.
 *
 * Time scale: ALL `time` values emitted to liveline are Unix ms
 * (Date.now()). The chart history store stores Unix ms natively;
 * the observability snapshot uses performance.now() relative to page
 * load, so we apply a one-time offset captured at module init.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LivelinePoint, LivelineSeries, OrderbookData, CandlePoint } from "liveline";
import type { ObservabilitySnapshot } from "@/hooks/useObservability";
import {
  useStatsChartHistoryStore,
  type ChartSample,
  type ChartSeriesId,
} from "@/stores/statsChartHistoryStore";

/**
 * `performance.now()` is page-load-relative; `Date.now()` is Unix ms.
 * Capture the offset once at module init — the relative drift between
 * these two clocks during a session is negligible (<<1ms over hours).
 *
 * NOTE on units passed to liveline:
 * Liveline expects `LivelinePoint.time` in UNIX SECONDS, not ms. The
 * bundled source computes its internal clock as `Date.now() / 1e3`
 * and compares against `point.time` directly. Passing ms values makes
 * every point appear 56 years in the future, which liveline silently
 * crops → empty chart. So: we keep timestamps internally as Unix ms
 * (matches what the history store stores), and divide by 1000 ONLY
 * at the boundary where we emit LivelinePoint / CandlePoint.
 */
const PERF_TO_UNIX_OFFSET = typeof window === "undefined" ? 0 : Date.now() - performance.now();
const MS_TO_LIVELINE_TIME = 1 / 1000;

const COLORS: Record<ChartSeriesId, string> = {
  oracle: "#ff7a00",
  mark:   "#e7e7e7",
  mid:    "#a0a0a0",
  bid:    "#22c55e",
  ask:    "#ef4444",
  lazer:  "#22d3ee",
};

const LABELS: Record<ChartSeriesId, string> = {
  oracle: "Oracle",
  mark:   "Mark",
  mid:    "Mid",
  bid:    "Best bid",
  ask:    "Best ask",
  lazer:  "Pyth Lazer",
};

const SERIES_ORDER: ChartSeriesId[] = ["oracle", "mark", "mid", "bid", "ask", "lazer"];

interface OrderbookPayload {
  bids?: Array<[number, number]>;
  asks?: Array<[number, number]>;
}

interface CandlePayload {
  candle?: { t?: number; o?: number; h?: number; l?: number; c?: number; v?: number; open?: number; high?: number; low?: number; close?: number };
}

const MAX_POINTS_PER_SERIES = 600;

export interface ChartSeriesResult {
  lineSeries: LivelineSeries[];
  candles: CandlePoint[];
  liveCandle?: CandlePoint;
  orderbook: OrderbookData | undefined;
  latest: Record<string, number>;
}

export function useChartSeries(
  snapshot: ObservabilitySnapshot,
  symbol: string | null,
  windowSeconds: number,
  candleIntervalSeconds: number,
): ChartSeriesResult {
  // useShallow is load-bearing: `getWindow` builds a fresh array each
  // call (filter from history). Without shallow content-comparison,
  // Zustand v5 sees a new reference every render → schedules another
  // re-render → infinite loop → React error #185 in production.
  // Shallow compares array length + element refs (which ARE stable —
  // getWindow re-uses the same ChartSample objects), so the
  // subscriber re-renders only when the actual contents change.
  const samples = useStatsChartHistoryStore(
    useShallow((s) => (symbol ? s.getWindow(symbol, windowSeconds) : ([] as ChartSample[])))
  );

  return useMemo<ChartSeriesResult>(() => {
    const empty: ChartSeriesResult = { lineSeries: [], candles: [], orderbook: undefined, latest: {} };
    if (!symbol) return empty;

    const orderbookSrc = snapshot.sources[`phoenix-ws-orderbook:${symbol}`];
    const candlesSrc = snapshot.sources[`phoenix-ws-candles:${symbol}`];

    // ── Materialize the 6 series from the history store ──────────
    const series: LivelineSeries[] = [];
    const latest: Record<string, number> = {};

    for (const id of SERIES_ORDER) {
      const points: LivelinePoint[] = [];
      for (const sample of samples) {
        const v = sample.values[id];
        if (typeof v === "number" && Number.isFinite(v)) {
          // Unix ms → Unix seconds for liveline (see MS_TO_LIVELINE_TIME note above)
          points.push({ time: sample.tMs * MS_TO_LIVELINE_TIME, value: v });
        }
      }
      // Downsample if we somehow exceed the cap (shouldn't with 1Hz
      // dedup but defensive).
      const data = downsample(points, MAX_POINTS_PER_SERIES);
      if (data.length === 0) continue;
      const value = data[data.length - 1].value;
      series.push({ id, label: LABELS[id], color: COLORS[id], data, value });
      latest[id] = value;
    }

    // ── Orderbook depth strip (live snapshot) ────────────────────
    let orderbook: OrderbookData | undefined;
    const latestOb = orderbookSrc?.latestPayload as OrderbookPayload | null | undefined;
    if (latestOb?.bids && latestOb?.asks) {
      orderbook = {
        bids: latestOb.bids.map((lvl) => [lvl[0], lvl[1]] as [number, number]),
        asks: latestOb.asks.map((lvl) => [lvl[0], lvl[1]] as [number, number]),
      };
    }

    // ── Candles (for candle mode) ────────────────────────────────
    // Phoenix's `candles` channel publishes at 1m intervals only — too
    // coarse for the short-window views people actually want on the
    // observability page (a 1m candle on a 1m window is one flat bar).
    // Bucket the 1Hz chart-history samples we already store into
    // arbitrary-size OHLC candles instead, using `mark` as the
    // representative price (falling back to oracle/mid if mark is
    // missing for some reason).
    //
    // The most recent bucket is the "live" candle and gets handed to
    // liveline's `liveCandle` prop so it animates as new samples land.
    const candles: CandlePoint[] = [];
    let liveCandle: CandlePoint | undefined;
    const intervalMs = Math.max(1, candleIntervalSeconds) * 1000;
    const nowBucketStart = Math.floor(Date.now() / intervalMs) * intervalMs;
    const buckets = new Map<number, { o: number; h: number; l: number; c: number }>();
    for (const sample of samples) {
      const price = sample.values.mark ?? sample.values.oracle ?? sample.values.mid;
      if (typeof price !== "number" || !Number.isFinite(price)) continue;
      const bucketStart = Math.floor(sample.tMs / intervalMs) * intervalMs;
      const b = buckets.get(bucketStart);
      if (!b) {
        buckets.set(bucketStart, { o: price, h: price, l: price, c: price });
      } else {
        if (price > b.h) b.h = price;
        if (price < b.l) b.l = price;
        b.c = price;
      }
    }
    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
    for (const k of sortedKeys) {
      const b = buckets.get(k)!;
      const candle: CandlePoint = {
        time: k * MS_TO_LIVELINE_TIME,
        open: b.o, high: b.h, low: b.l, close: b.c,
      };
      if (k === nowBucketStart) {
        liveCandle = candle;  // most-recent bucket is mid-formation
      } else {
        candles.push(candle);
      }
    }
    // Silence unused-var lint for the legacy candle source — kept in
    // the closure in case we want to fall back to Phoenix's native
    // candle data later (e.g. for backfill on first load).
    void candlesSrc;

    return { lineSeries: series, candles, liveCandle, orderbook, latest };
  }, [samples, snapshot.sources, symbol, windowSeconds, candleIntervalSeconds]);
}

/** Stride-downsample a series, preserving first + last points. */
function downsample(points: LivelinePoint[], maxPoints: number): LivelinePoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: LivelinePoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Extract the latest values for the 6 chart series from the
 * observability snapshot for a given symbol. Used by the chart
 * component to push new samples into the history store on each tick.
 *
 * Returns null if NO series has a live value yet — caller can skip
 * pushing in that case.
 */
export function readLatestChartValues(
  snapshot: ObservabilitySnapshot,
  symbol: string,
): Partial<Record<ChartSeriesId, number>> | null {
  const marketSrc = snapshot.sources[`phoenix-ws-market:${symbol}`];
  const orderbookSrc = snapshot.sources[`phoenix-ws-orderbook:${symbol}`];
  const lazerSrc = snapshot.sources[`pyth-hermes:${symbol}`];

  const market = marketSrc?.latestPayload as
    | { oraclePx?: number; markPx?: number; midPx?: number }
    | null
    | undefined;
  const orderbook = orderbookSrc?.latestPayload as OrderbookPayload | null | undefined;
  const lazer = lazerSrc?.latestPayload as { price?: number } | null | undefined;

  const values: Partial<Record<ChartSeriesId, number>> = {};
  if (typeof market?.oraclePx === "number") values.oracle = market.oraclePx;
  if (typeof market?.markPx === "number")   values.mark   = market.markPx;
  if (typeof market?.midPx === "number")    values.mid    = market.midPx;
  const bid = orderbook?.bids?.[0]?.[0];
  const ask = orderbook?.asks?.[0]?.[0];
  if (typeof bid === "number") values.bid = bid;
  if (typeof ask === "number") values.ask = ask;
  if (typeof lazer?.price === "number") values.lazer = lazer.price;
  if (Object.keys(values).length === 0) return null;
  return values;
}

/** Convenient module-level access to the perf→Unix offset. */
export { PERF_TO_UNIX_OFFSET };
