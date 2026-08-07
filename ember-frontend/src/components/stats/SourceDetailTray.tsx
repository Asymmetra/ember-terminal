"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { DataSource } from "@/lib/observability/types";
import { generateSnippets } from "@/lib/observability/snippets";
import { CodeBlock } from "./CodeBlock";
import { Sparkline } from "./Sparkline";
import { formatPriceAuto } from "@/lib/format";
import clsx from "clsx";

interface Props {
  source: DataSource | null;
  /**
   * Other sources sharing the same symbol + category as `source`. When
   * present and length > 1, a channel-switcher pill bar is rendered at
   * the top of the tray so the user can hop between (e.g.) AAVE's
   * market, funding, orderbook, trades, and candles channels without
   * closing and re-opening the tray. Order in this array determines
   * pill order.
   */
  siblings?: DataSource[];
  /** Called when the user clicks a sibling pill. */
  onSelectSibling?: (id: string) => void;
  onClose: () => void;
  defaultLanguage?: string;
  onLanguageChange?: (lang: string) => void;
}

/**
 * "phoenix-ws-market" → "market". Used as the short pill label so the
 * channel switcher reads cleanly without the redundant prefix.
 */
function channelShortLabel(kind: DataSource["kind"]): string {
  return kind.replace(/^phoenix-ws-/, "").replace(/^ember-(ws|rest)-/, "");
}

const KIND_ORDER: Record<string, number> = {
  "phoenix-ws-market":    0,
  "phoenix-ws-all-mids":  1,
  "phoenix-ws-funding":   2,
  "phoenix-ws-orderbook": 3,
  "phoenix-ws-trades":    4,
  "phoenix-ws-candles":   5,
};

function sortedSiblings(siblings: DataSource[]): DataSource[] {
  return [...siblings].sort((a, b) => (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99));
}

function fmtMs(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${v.toFixed(0)}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(2)}s`;
  return `${(v / 60_000).toFixed(2)}m`;
}
function fmtAge(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  if (sec < 60) return `${sec.toFixed(2)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${Math.floor(sec % 60).toString().padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h`;
}
function fmtUsdAbbrev(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Slide-out detail panel. Surfaces market-specific analytics for
 * phoenix-ws-market sources (price spreads, OI, volume, funding) plus
 * the raw inter-arrival gaps that feed the latency percentiles.
 */
export function SourceDetailTray({ source, siblings, onSelectSibling, onClose, defaultLanguage, onLanguageChange }: Props) {
  useEffect(() => {
    if (!source) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [source, onClose]);

  // Only show pills when the user has actually landed on a multi-channel
  // symbol (Phoenix WS market/funding/orderbook/trades/candles for one
  // asset). Single-source views — e.g. allMids, health endpoints — get
  // the original cleaner header.
  const hasSiblings = !!(siblings && siblings.length > 1);
  const orderedSiblings = hasSiblings ? sortedSiblings(siblings!) : [];

  return (
    <AnimatePresence>
      {source && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/40"
          />
          {/*
            The animation key is based on the SYMBOL+category (or source id
            for non-merged sources) rather than `source.id` directly — so
            clicking a sibling pill swaps tray content in place without
            re-running the slide-in transition, which would feel jumpy.
          */}
          <motion.div
            key={hasSiblings ? `${source.category}:${source.symbol ?? source.id}` : source.id}
            initial={{ x: 580 }} animate={{ x: 0 }} exit={{ x: 580 }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed right-0 top-0 bottom-0 z-[91] w-[580px] border-l border-ember-border bg-surface-l1 shadow-[−24px_0_96px_rgba(0,0,0,0.55)] overflow-y-auto"
          >
            <Header
              source={source}
              onClose={onClose}
              siblings={orderedSiblings}
              onSelectSibling={onSelectSibling}
            />
            <Body source={source} defaultLanguage={defaultLanguage} onLanguageChange={onLanguageChange} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Header({
  source,
  onClose,
  siblings,
  onSelectSibling,
}: {
  source: DataSource;
  onClose: () => void;
  siblings: DataSource[];
  onSelectSibling?: (id: string) => void;
}) {
  const ss = statusBadge(source.status);
  const hasSiblings = siblings.length > 1;
  // When the tray is the merged-symbol view, show the symbol as the
  // big title and let the eyebrow communicate the category. Otherwise
  // keep the per-source label as the title.
  const titleText = hasSiblings ? (source.symbol ?? source.label) : source.label;
  const eyebrowText = hasSiblings ? "Phoenix · WebSocket" : source.kind;
  return (
    <div className="border-b border-ember-border/70 px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ember-orange">{eyebrowText}</span>
          <h2 className="font-mono text-sm uppercase tracking-wider text-text-primary">{titleText}</h2>
          <code className="font-mono text-[10px] text-text-secondary/50">{source.endpoint}</code>
        </div>
        <button onClick={onClose} className="text-text-secondary/60 hover:text-text-primary transition-colors">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={clsx("inline-block h-2 w-2 rounded-full", ss.dot)} />
        <span className={clsx("font-mono text-[10px] uppercase tracking-wider", ss.cls)}>{ss.label}</span>
        <span className="ml-2 font-mono text-[10px] text-text-secondary/50">last update {fmtAge(source.stats.ageSec)} ago · {source.stats.count.toLocaleString()} total</span>
      </div>
      {hasSiblings && (
        <ChannelSwitcher
          source={source}
          siblings={siblings}
          onSelect={onSelectSibling}
        />
      )}
    </div>
  );
}

function ChannelSwitcher({
  source,
  siblings,
  onSelect,
}: {
  source: DataSource;
  siblings: DataSource[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-text-secondary/40">Channels</span>
      {siblings.map((sib) => {
        const active = sib.id === source.id;
        const ss = statusBadge(sib.status);
        return (
          <button
            key={sib.id}
            onClick={() => onSelect?.(sib.id)}
            className={clsx(
              "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
              active
                ? "border-ember-orange/60 bg-ember-orange/15 text-ember-orange"
                : "border-ember-border text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary",
            )}
            title={`${sib.kind} · ${sib.status} · ${sib.stats.count.toLocaleString()} msgs`}
          >
            <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", ss.dot)} />
            {channelShortLabel(sib.kind)}
          </button>
        );
      })}
    </div>
  );
}

function Body({ source, defaultLanguage, onLanguageChange }: { source: DataSource; defaultLanguage?: string; onLanguageChange?: (lang: string) => void }) {
  const snippets = generateSnippets(source);
  const [tab, setTab] = useState<"code" | "payload" | "history">("code");

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Description */}
      <p className="font-mono text-[10px] leading-relaxed text-text-secondary/70">{source.description}</p>

      {/* Market-data snapshot (only for sources whose payload carries it) */}
      {source.kind === "phoenix-ws-market" && <MarketSnapshot payload={source.latestPayload as PhoenixMarketPayload | null} />}

      {/* Latency / cadence — with explanation of what each number is */}
      <CadencePanel source={source} />

      {/* Tabs */}
      <div className="flex border border-ember-border bg-surface-l2/40">
        {(["code", "payload", "history"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              "flex-1 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors border-r border-ember-border/40 last:border-r-0",
              tab === k ? "bg-ember-orange/10 text-ember-orange" : "text-text-secondary/60 hover:text-text-primary",
            )}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === "code" && <CodeBlock snippets={snippets} defaultLanguage={defaultLanguage} onLanguageChange={onLanguageChange} />}
      {tab === "payload" && (
        <div className="border border-ember-border bg-surface-l2/40">
          <div className="border-b border-ember-border/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Latest payload</div>
          <pre className="overflow-x-auto p-3 font-mono text-[10px] leading-relaxed text-text-primary/90 whitespace-pre">{source.latestPayload ? JSON.stringify(source.latestPayload, null, 2) : "(none)"}</pre>
        </div>
      )}
      {tab === "history" && (
        <div className="border border-ember-border bg-surface-l2/40 max-h-[60vh] overflow-y-auto">
          <div className="border-b border-ember-border/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Recent {source.recentPayloads.length} payloads (newest first)</div>
          <div className="flex flex-col">
            {[...source.recentPayloads].reverse().map((entry, i) => (
              <div key={i} className="border-b border-ember-border/20 px-3 py-1.5 font-mono text-[9px] text-text-secondary/70">
                <div className="text-text-secondary/40">t = {(entry.tMs / 1000).toFixed(3)}s</div>
                <div className="truncate text-text-primary/80" title={JSON.stringify(entry.payload)}>{JSON.stringify(entry.payload).slice(0, 180)}</div>
              </div>
            ))}
            {source.recentPayloads.length === 0 && <div className="px-3 py-3 font-mono text-[10px] text-text-secondary/40">No payloads received yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

interface PhoenixMarketPayload {
  channel: string;
  symbol: string;
  oraclePx?: number;
  markPx?: number;
  midPx?: number;
  openInterest?: number;
  prevDayPx?: number;
  dayNtlVlm?: number;
  funding?: number;
}

/**
 * Market data snapshot for phoenix-ws-market sources. Shows the prices
 * with their definitions, the spreads between them in dollars and bps,
 * plus open interest, 24h volume, funding rate, and 24h % change.
 */
function MarketSnapshot({ payload }: { payload: PhoenixMarketPayload | null }) {
  if (!payload) return null;
  const oracle = payload.oraclePx ?? 0;
  const mark = payload.markPx ?? 0;
  const mid = payload.midPx ?? 0;
  // Phoenix publishes openInterest in BASE asset units (e.g. 10.34 for
  // "10.34 BTC of OI"); convert to USD with the mark price for display.
  const oiBase = payload.openInterest ?? 0;
  const oi = oiBase * mark;
  const vol = payload.dayNtlVlm ?? 0;
  const fundingPct = (payload.funding ?? 0) * 100;
  const prev = payload.prevDayPx ?? 0;
  const change24h = prev > 0 ? ((mark - prev) / prev) * 100 : 0;

  const markVsOracle = oracle > 0 ? mark - oracle : 0;
  const markVsOracleBps = oracle > 0 ? (markVsOracle / oracle) * 10_000 : 0;
  const midVsOracle = oracle > 0 ? mid - oracle : 0;
  const midVsOracleBps = oracle > 0 ? (midVsOracle / oracle) * 10_000 : 0;
  const midVsMark = mark > 0 ? mid - mark : 0;
  const midVsMarkBps = mark > 0 ? (midVsMark / mark) * 10_000 : 0;

  return (
    <div className="border border-ember-border bg-surface-l2/40">
      <div className="border-b border-ember-border/50 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Market snapshot</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-ember-border/40">
        <PriceCell
          label="Oracle"
          value={oracle}
          color="text-ember-orange"
          tooltip="The aggregated, off-chain oracle price Phoenix sources for this market (typically Pyth/Switchboard fed). This is the truest reference price — used as the starting point for the mark calculation. Updates whenever the upstream oracle publishes."
        />
        <PriceCell
          label="Mark"
          value={mark}
          color="text-text-primary"
          tooltip="The EMA-smoothed price Phoenix uses for margin requirements, liquidations, and PnL accounting. Computed from oracle ± deviations bounded by an execution band, with an EMA over recent slots to dampen flicker. Lags the oracle slightly by design."
        />
        <PriceCell
          label="Mid"
          value={mid}
          color="text-text-secondary"
          tooltip="The midpoint of the on-orderbook best bid and ask: (best_bid + best_ask) / 2. Reflects what traders are actively willing to transact at — not used for margin math. Can diverge from oracle/mark when the book is thin or one-sided."
        />
      </div>
      <div className="grid grid-cols-3 gap-px bg-ember-border/40">
        <SpreadCell label="Mark − Oracle" deltaUsd={markVsOracle} deltaBps={markVsOracleBps}
          tooltip="How far Phoenix's mark has drifted from the oracle. Small drifts (a few bps) are normal — they're the EMA dampening doing its job. Large persistent drifts can indicate oracle stress." />
        <SpreadCell label="Mid − Oracle" deltaUsd={midVsOracle} deltaBps={midVsOracleBps}
          tooltip="Difference between orderbook mid and oracle. Large positive = book is paying premium over oracle (longs paying up); large negative = discount (shorts paying down). The basis." />
        <SpreadCell label="Mid − Mark" deltaUsd={midVsMark} deltaBps={midVsMarkBps}
          tooltip="Difference between orderbook mid and Phoenix's mark. If you're trying to predict whether mark will move, this is the leading indicator — mark chases mid." />
      </div>
      <div className="grid grid-cols-4 gap-px bg-ember-border/40">
        <MetricCell label="Open Interest"  value={fmtUsdAbbrev(oi)}                  tooltip="Total notional of all open positions in this market, in USD. A measure of how much capital is currently expressed here." />
        <MetricCell label="24h Volume"     value={fmtUsdAbbrev(vol)}                 tooltip="Total notional traded in this market over the trailing 24 hours, in USD. Day-rolling sum from Phoenix." />
        <MetricCell label="Funding rate"   value={`${fundingPct.toFixed(4)}%`}      tooltip="Current funding rate. Positive = longs pay shorts (mark > oracle persistently); negative = shorts pay longs. Settled every 8h on a rolling epoch." colored={fundingPct >= 0 ? "text-ember-green" : "text-ember-red"} />
        <MetricCell label="24h change"     value={`${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`} tooltip="Mark price change vs the mark price 24 hours ago." colored={change24h >= 0 ? "text-ember-green" : "text-ember-red"} />
      </div>
    </div>
  );
}

/**
 * CSS-only hover hint. Native `title=` has a ~700-1000ms browser-driven
 * delay before showing — annoying on a dense dashboard where the user
 * just wants a quick definition. This fires on `group-hover` so the
 * label appears the instant the cursor enters the cell.
 *
 * Caller is responsible for adding `group relative` to the cell.
 */
function HoverHint({ text }: { text: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute left-2 top-full z-50 mt-1 whitespace-normal rounded border border-ember-border bg-surface-l3/95 px-2 py-1.5 font-mono text-[10px] leading-snug text-text-primary opacity-0 shadow-xl backdrop-blur-sm transition-opacity duration-75 group-hover:visible group-hover:opacity-100"
      style={{ width: "max-content", maxWidth: "300px" }}
    >
      {text}
    </span>
  );
}

function PriceCell({ label, value, color, tooltip }: { label: string; value: number; color: string; tooltip: string }) {
  return (
    <div className="group relative flex flex-col gap-0.5 bg-surface-l1 px-3 py-2.5">
      <span className="cursor-help font-mono text-[9px] uppercase tracking-wider text-text-secondary/50 border-b border-dotted border-text-secondary/30 w-fit">{label}</span>
      <span className={clsx("font-mono text-base", color)}>${formatPriceAuto(value)}</span>
      <HoverHint text={tooltip} />
    </div>
  );
}

function SpreadCell({ label, deltaUsd, deltaBps, tooltip }: { label: string; deltaUsd: number; deltaBps: number; tooltip: string }) {
  const isPos = deltaUsd > 0;
  const color = Math.abs(deltaBps) < 1 ? "text-text-secondary/60" : isPos ? "text-ember-green" : "text-ember-red";
  return (
    <div className="group relative flex flex-col gap-0.5 bg-surface-l1 px-3 py-2">
      <span className="cursor-help font-mono text-[9px] uppercase tracking-wider text-text-secondary/50 border-b border-dotted border-text-secondary/30 w-fit">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={clsx("font-mono text-xs", color)}>{isPos ? "+" : ""}${deltaUsd.toFixed(4)}</span>
        <span className={clsx("font-mono text-[10px]", color)}>{isPos ? "+" : ""}{deltaBps.toFixed(2)}bp</span>
      </div>
      <HoverHint text={tooltip} />
    </div>
  );
}

function MetricCell({ label, value, tooltip, colored }: { label: string; value: string; tooltip: string; colored?: string }) {
  return (
    <div className="group relative flex flex-col gap-0.5 bg-surface-l1 px-3 py-2">
      <span className="cursor-help font-mono text-[9px] uppercase tracking-wider text-text-secondary/50 border-b border-dotted border-text-secondary/30 w-fit">{label}</span>
      <span className={clsx("font-mono text-xs", colored ?? "text-text-primary")}>{value}</span>
      <HoverHint text={tooltip} />
    </div>
  );
}

/**
 * Latency cadence panel. Renders the percentiles alongside the raw
 * inter-arrival samples that feed them, so the user can directly
 * reconcile "p50 = 1s" with "Age = 128ms": the two measure DIFFERENT
 * things (gap-between-messages vs how-old-is-the-freshest-value).
 */
function CadencePanel({ source }: { source: DataSource }) {
  const samples = source.stats.recentArrivals;
  return (
    <div className="border border-ember-border bg-surface-l2/40">
      <div className="border-b border-ember-border/50 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Cadence & latency</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-ember-border/40">
        <StatBox label="Age (now)" value={fmtAge(source.stats.ageSec)} tooltip="How long since the most recent message arrived, as of this instant. Fluctuates from 0 up to roughly p50 — every time a message arrives this resets to 0. NOT a request-latency measurement." />
        <StatBox label="Gap p50" value={fmtMs(source.stats.p50Ms)} highlight tooltip="Median time BETWEEN consecutive messages over the rolling window. If Phoenix publishes every ~1s, this will be ~1000ms. This is the cadence of the upstream feed, not the speed of any individual transaction." />
        <StatBox label="Gap p95" value={fmtMs(source.stats.p95Ms)} tooltip="95th-percentile inter-message gap. Captures the worst-typical wait between updates. Healthy if ≤ ~500ms for liquid markets." />
        <StatBox label="Gap p99" value={fmtMs(source.stats.p99Ms)} tooltip="99th-percentile gap. The occasional bad-luck wait. Spikes here indicate Phoenix had a brief silent stretch." />
        <StatBox label="Gap max" value={fmtMs(source.stats.maxMs)} tooltip="Worst gap seen in the rolling window. One real outlier." />
        <StatBox label="Rate (60s)" value={`${source.stats.rate60s.toFixed(2)}/s`} tooltip="Messages per second over the trailing 60 seconds." />
      </div>
      <div className="border-t border-ember-border/50 px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">Recent inter-arrival gaps (the raw samples behind the percentiles)</span>
          <span className="font-mono text-[9px] text-text-secondary/40">{samples.length} samples</span>
        </div>
        <Sparkline values={samples} reference={source.stats.p50Ms ?? undefined} referenceLabel={source.stats.p50Ms != null ? `p50 ${fmtMs(source.stats.p50Ms)}` : undefined} />
        {samples.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-text-secondary/50 hover:text-text-primary transition-colors">
              raw values
            </summary>
            <div className="mt-1 max-h-32 overflow-y-auto font-mono text-[9px] text-text-secondary/70">
              {samples.slice().reverse().map((v, i) => (
                <span key={i} className="mr-2 inline-block">{v.toFixed(0)}ms</span>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tooltip, highlight }: { label: string; value: string; tooltip?: string; highlight?: boolean }) {
  return (
    <div className="group relative flex flex-col gap-0.5 bg-surface-l1 px-2 py-1.5">
      <span className={clsx("font-mono text-[9px] uppercase tracking-wider", tooltip ? "cursor-help border-b border-dotted border-text-secondary/30 text-text-secondary/50 w-fit" : "text-text-secondary/50")}>{label}</span>
      <span className={clsx("font-mono text-xs", highlight ? "text-ember-orange" : "text-text-primary")}>{value}</span>
      {tooltip && <HoverHint text={tooltip} />}
    </div>
  );
}

function statusBadge(s: DataSource["status"]) {
  switch (s) {
    case "healthy":  return { label: "Healthy",  cls: "text-ember-green",       dot: "bg-ember-green" };
    case "degraded": return { label: "Degraded", cls: "text-yellow-500",        dot: "bg-yellow-500" };
    case "stale":    return { label: "Stale",    cls: "text-ember-red",         dot: "bg-ember-red" };
    case "error":    return { label: "Error",    cls: "text-ember-red",         dot: "bg-ember-red" };
    case "idle":     return { label: "Idle",     cls: "text-text-secondary/50", dot: "bg-text-secondary/30" };
  }
}
