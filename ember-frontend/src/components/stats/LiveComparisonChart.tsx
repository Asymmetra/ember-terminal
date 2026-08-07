"use client";

/**
 * Live Comparison Chart — pinned at the top of /stats, between the
 * Market Overview tiles and the Channels chips.
 *
 * Shows up to 6 overlapping price streams for the focused symbol:
 *   - Phoenix oraclePx (orange)
 *   - Phoenix markPx (white)
 *   - Phoenix midPx (grey)
 *   - Phoenix best-bid from orderbook (green)
 *   - Phoenix best-ask from orderbook (red)
 *   - Pyth Network oracle via Hermes (cyan, when available)
 *
 * Modes:
 *   - Line: all six series overlaid via liveline's `series` prop
 *   - Candle: Phoenix candles channel for the focused symbol, single
 *     OHLC series via liveline's `mode="candle"` + `candles` props
 *
 * Controls in the panel header: symbol picker, line/candle mode,
 * time-window selector, collapse chevron. All state persists to
 * localStorage via the stats chart store.
 *
 * Auto-subscribes to the focused symbol's orderbook + candles
 * channels when the chart is visible (since those default OFF on the
 * channel chips above the table). Restores chip state on unmount.
 */

import { useEffect, useMemo } from "react";
import { Liveline } from "liveline";
import { useStatsChartStore, type ChartMode } from "@/stores/statsChartStore";
import { useStatsChartHistoryStore } from "@/stores/statsChartHistoryStore";
import { useChartSeries, readLatestChartValues } from "@/hooks/useChartSeries";
import { pythFeedFor } from "@/lib/observability/pyth";
import type { ObservabilitySnapshot } from "@/hooks/useObservability";
import { formatPriceAuto } from "@/lib/format";
import clsx from "clsx";

interface Props {
  snapshot: ObservabilitySnapshot;
  /** Phoenix symbols with at least one live market source — fed into the symbol picker. */
  availableSymbols: string[];
  /** Highest-OI symbol per the latest tick — used to seed focusedSymbol on first mount. */
  topSymbol: string | null;
}

const WINDOW_OPTIONS = [
  { label: "1m",  secs: 60 },
  { label: "5m",  secs: 300 },
  { label: "10m", secs: 600 },
  { label: "1h",  secs: 3600 },
];

const CANDLE_INTERVAL_OPTIONS = [
  { label: "5s",  secs: 5 },
  { label: "15s", secs: 15 },
  { label: "1m",  secs: 60 },
  { label: "5m",  secs: 300 },
];

export function LiveComparisonChart({ snapshot, availableSymbols, topSymbol }: Props) {
  const {
    focusedSymbol, chartMode, windowSeconds, candleIntervalSeconds, collapsed,
    setFocusedSymbol, setChartMode, setWindowSeconds, setCandleIntervalSeconds, setCollapsed,
  } = useStatsChartStore();

  // Hydrate both stores from localStorage AFTER mount — keeps the
  // server-rendered HTML in sync with the first client render so we
  // don't trip React #418.
  const hydrateChartStore = useStatsChartStore((s) => s.hydrate);
  const hydrateHistoryStore = useStatsChartHistoryStore((s) => s.hydrate);
  useEffect(() => { hydrateChartStore(); hydrateHistoryStore(); }, [hydrateChartStore, hydrateHistoryStore]);

  // Seed on first load: prefer the persisted choice; otherwise pick the
  // top-OI symbol if it's available, otherwise the first one.
  useEffect(() => {
    if (focusedSymbol && availableSymbols.includes(focusedSymbol)) return;
    if (availableSymbols.length === 0) return;
    const seed = topSymbol && availableSymbols.includes(topSymbol)
      ? topSymbol
      : availableSymbols[0];
    setFocusedSymbol(seed);
  }, [focusedSymbol, availableSymbols, topSymbol, setFocusedSymbol]);

  // ── Push fresh samples into the chart history store ──────────────
  // Runs on every snapshot tick (~500ms). The store dedupes to 1Hz
  // internally, so this is cheap even on a fast tick. Without this
  // loop the chart would have no data at all — the history store is
  // the sole source of truth for the line series.
  const addSample = useStatsChartHistoryStore((s) => s.addSample);
  useEffect(() => {
    if (!focusedSymbol) return;
    const values = readLatestChartValues(snapshot, focusedSymbol);
    if (!values) return;
    addSample(focusedSymbol, { tMs: Date.now(), values });
  }, [snapshot, focusedSymbol, addSample]);

  const series = useChartSeries(snapshot, focusedSymbol, windowSeconds, candleIntervalSeconds);

  // Diagnostic: expose snapshot + focused-symbol source state on
  // window so we can introspect from the browser console why a given
  // series (bid/ask/lazer) isn't appearing in the chart history.
  // Cheap to leave on; useful for the next batch of debugging.
  useEffect(() => {
    if (typeof window === "undefined" || !focusedSymbol) return;
    const w = window as unknown as { __emb?: Record<string, unknown> };
    w.__emb = w.__emb ?? {};
    w.__emb.snapshot = snapshot;
    w.__emb.focusedSymbol = focusedSymbol;
    w.__emb.marketSrc = snapshot.sources[`phoenix-ws-market:${focusedSymbol}`];
    w.__emb.orderbookSrc = snapshot.sources[`phoenix-ws-orderbook:${focusedSymbol}`];
    w.__emb.lazerSrc = snapshot.sources[`pyth-hermes:${focusedSymbol}`];
  }, [snapshot, focusedSymbol]);
  const hasLazer = focusedSymbol ? !!pythFeedFor(focusedSymbol) : false;
  const primaryLine = series.lineSeries[0];

  // Reference line: the orderbook mid, when available — a visual
  // anchor that shows where the book is quoting "right now" relative
  // to the various oracle/mark feeds.
  const midRef = useMemo(() => {
    const obSeries = series.lineSeries.find((s) => s.id === "mid");
    if (!obSeries) return undefined;
    return { value: obSeries.value, label: "mid" };
  }, [series.lineSeries]);

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex flex-wrap items-center gap-3 border-b border-ember-border/50 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
          Live comparison
        </span>

        {/* Symbol picker */}
        <select
          value={focusedSymbol ?? ""}
          onChange={(e) => setFocusedSymbol(e.target.value || null)}
          className="border border-ember-border bg-ember-black/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-primary outline-none focus:border-ember-orange/60"
        >
          {availableSymbols.length === 0 && <option value="">—</option>}
          {availableSymbols.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Mode toggle */}
        <ModeToggle mode={chartMode} setMode={setChartMode} />

        {/* Window toggle — visible range. Same options in both modes. */}
        <WindowToggle current={windowSeconds} setCurrent={setWindowSeconds} options={WINDOW_OPTIONS} />

        {/* Candle interval — only in candle mode. Smallest interval is
            5s since our local OHLC aggregation buckets the 1Hz history
            samples; sub-second resolution would require ingesting raw
            tick data which we don't keep. */}
        {chartMode === "candle" && (
          <WindowToggle current={candleIntervalSeconds} setCurrent={setCandleIntervalSeconds} options={CANDLE_INTERVAL_OPTIONS} />
        )}

        {/* Pyth availability indicator */}
        <span
          className={clsx(
            "ml-2 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider",
            hasLazer ? "text-cyan-400" : "text-text-secondary/30",
          )}
          title={hasLazer
            ? "Pyth Hermes feed available for this symbol — 6th line is live"
            : "No matching Pyth feed configured for this symbol — comparison runs on Phoenix's 5 streams only"}
        >
          <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", hasLazer ? "bg-cyan-400" : "bg-text-secondary/30")} />
          pyth {hasLazer ? "on" : "n/a"}
        </span>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto border border-ember-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors"
          aria-label={collapsed ? "Expand chart" : "Collapse chart"}
        >
          {collapsed ? "▾ expand" : "▴ collapse"}
        </button>
      </div>

      {!collapsed && (
        <div className="p-3">
          {focusedSymbol == null || (chartMode === "line" && series.lineSeries.length === 0) ? (
            <div className="flex h-48 items-center justify-center font-mono text-[10px] text-text-secondary/40">
              Waiting for live data… (open the page for ~2 seconds for first prices to land)
            </div>
          ) : chartMode === "line" ? (
            <Liveline
              data={primaryLine?.data ?? []}
              value={primaryLine?.value ?? 0}
              series={series.lineSeries}
              theme="dark"
              grid
              fill
              window={windowSeconds}
              orderbook={series.orderbook}
              referenceLine={midRef}
              formatValue={(v) => `$${formatPriceAuto(v)}`}
              formatTime={(t) => fmtAxisTime(t, windowSeconds)}
              padding={{ top: 12, right: 88, bottom: 36, left: 24 }}
              style={{ height: 360, fontFamily: "var(--font-mono, ui-monospace)" }}
              // Softer rendering: thinner lines so 5–6 overlapping series
              // don't compete visually; lerpSpeed cranked down so the
              // value animates smoothly toward each new 1Hz sample
              // instead of snapping; pulse off so the right-edge cursor
              // doesn't fight the spline shape for attention.
              lineWidth={1}
              lerpSpeed={0.06}
              pulse={false}
            />
          ) : (
            <Liveline
              mode="candle"
              data={primaryLine?.data ?? []}
              value={primaryLine?.value ?? 0}
              candles={series.candles}
              liveCandle={series.liveCandle}
              candleWidth={6}
              theme="dark"
              grid
              orderbook={series.orderbook}
              formatValue={(v) => `$${formatPriceAuto(v)}`}
              formatTime={(t) => fmtAxisTime(t, windowSeconds)}
              padding={{ top: 12, right: 88, bottom: 36, left: 24 }}
              style={{ height: 360, fontFamily: "var(--font-mono, ui-monospace)" }}
              lerpSpeed={0.06}
              pulse={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: ChartMode; setMode: (m: ChartMode) => void }) {
  return (
    <div className="inline-flex border border-ember-border">
      {(["line", "candle"] as ChartMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={clsx(
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
            mode === m ? "bg-ember-orange/15 text-ember-orange" : "text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function WindowToggle({
  current, setCurrent, options,
}: {
  current: number;
  setCurrent: (s: number) => void;
  options: Array<{ label: string; secs: number }>;
}) {
  return (
    <div className="inline-flex border border-ember-border">
      {options.map((o) => (
        <button
          key={o.secs}
          onClick={() => setCurrent(o.secs)}
          className={clsx(
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
            current === o.secs ? "bg-ember-orange/15 text-ember-orange" : "text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Format axis time labels for liveline.
 *
 * Important: liveline emits `time` in UNIX SECONDS to this callback
 * (see useChartSeries.ts:MS_TO_LIVELINE_TIME). For short windows
 * (<= 10m), show HH:MM:SS so a few seconds of difference is obvious;
 * for the 1h window, drop the seconds.
 */
function fmtAxisTime(tSec: number, windowSeconds: number): string {
  if (!Number.isFinite(tSec) || tSec <= 0) return "";
  const d = new Date(tSec * 1000);
  if (windowSeconds <= 600) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
