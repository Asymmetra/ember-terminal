"use client";

import type { DataSource, SourceCategory, SourceKind, SourceStatus } from "@/lib/observability/types";
import { formatPriceAuto } from "@/lib/format";
import clsx from "clsx";

interface Props {
  sources: DataSource[];
  /** Map of category → expanded state. */
  expanded: Record<string, boolean>;
  /** Toggle a category section open/closed. */
  onToggle: (cat: SourceCategory) => void;
  /** Currently-selected source (for tray). */
  selectedId: string | null;
  /** Click a row to open the detail tray. */
  onSelect: (id: string) => void;
  /** Search filter (matches against label + id). */
  filter: string;
  /** Set of source-kinds the user has hidden via the channel toggles. */
  hiddenKinds: Set<SourceKind>;
}

const CATEGORY_LABELS: Record<SourceCategory, string> = {
  "phoenix-ws":      "Phoenix · WebSocket",
  "phoenix-rest":    "Phoenix · REST",
  "ember-ws":        "Ember Backend · WebSocket",
  "ember-rest":      "Ember Backend · REST",
  "external-oracle": "External Oracle · MagicBlock Pyth Lazer",
};

const CATEGORY_DESC: Record<SourceCategory, string> = {
  "phoenix-ws":      "Streams from wss://perp-api.phoenix.trade/ws — direct from Phoenix's perp infrastructure. Event-driven (no fixed cadence).",
  "phoenix-rest":    "REST snapshots from perp-api.phoenix.trade. Polled at our rate.",
  "ember-ws":        "Our backend's relayed streams (wss://ember-api.asymmetra.xyz/ws). Same data as Phoenix WS but routed through the ember relay.",
  "ember-rest":      "Our backend's HTTP API (ember-api.asymmetra.xyz).",
  "external-oracle": "On-chain Pyth Lazer price feeds via the MagicBlock oracle-template program. Independent oracle source used to cross-validate Phoenix's `oraclePx`.",
};

/**
 * Renders a numeric value + unit as two fixed-width slots so the value
 * occupies the same horizontal footprint regardless of magnitude. The
 * number right-aligns inside a number slot; the unit left-aligns inside
 * a unit slot. Combined with `tabular-nums`, this kills the perceived
 * jitter you get from variable-character-count values being just
 * right-aligned in a cell.
 */
function NumberUnit({
  num,
  unit,
  numClass,
  unitClass,
  numWidth = "2.6em",
  unitWidth = "1.4em",
}: {
  num: string;
  unit: string;
  numClass?: string;
  unitClass?: string;
  numWidth?: string;
  unitWidth?: string;
}) {
  return (
    <span className="inline-flex items-baseline tabular-nums">
      <span className={clsx("inline-block text-right", numClass)} style={{ minWidth: numWidth }}>{num}</span>
      <span className={clsx("inline-block pl-0.5 text-left text-text-secondary/50", unitClass)} style={{ minWidth: unitWidth }}>{unit}</span>
    </span>
  );
}

/**
 * Pretty-print an "age" (seconds since last update). Splits magnitude
 * from unit so cells don't wobble as the value crosses unit boundaries.
 */
function AgeValue({ sec, className }: { sec: number | null; className?: string }) {
  if (sec == null) return <span className="text-text-secondary/40">—</span>;
  let num: string;
  let unit: string;
  // Boundary nudges (same idea as GapValue): a value that would round
  // INTO the next unit gets promoted, so we never show "60.0 s" or
  // "60.0 m" — those render as "1.0 m" / "1.0 h" instead, matching
  // neighboring rows on either side of the threshold.
  if (sec < 59.95) {
    num = sec < 9.995 ? sec.toFixed(2) : sec.toFixed(1);
    unit = "s";
  } else if (sec < 3599.5) {
    num = (sec / 60).toFixed(1);
    unit = "m";
  } else {
    num = (sec / 3600).toFixed(1);
    unit = "h";
  }
  return <NumberUnit num={num} unit={unit} numClass={className} />;
}

/**
 * Pretty-print an inter-arrival GAP in ms. Same fixed-slot treatment.
 *
 * Boundary handling: every branch boundary is set just below the value
 * that would round into the next unit, so e.g. 999.7ms renders as
 * "1.00 s" (consistent with 1001ms) rather than "1000 ms" (visually
 * mixed with neighboring "1.00 s" rows). Same for the s→m boundary.
 */
function GapValue({ ms, className }: { ms: number | null; className?: string }) {
  if (ms == null) return <span className="text-text-secondary/40">—</span>;
  let num: string;
  let unit: string;
  if (ms < 999.5) {
    num = Math.round(ms).toString();
    unit = "ms";
  } else if (ms < 9995) {
    num = (ms / 1000).toFixed(2);
    unit = "s";
  } else if (ms < 59_950) {
    num = (ms / 1000).toFixed(1);
    unit = "s";
  } else {
    num = (ms / 60_000).toFixed(1);
    unit = "m";
  }
  return <NumberUnit num={num} unit={unit} numClass={className} unitWidth="1.6em" />;
}

/**
 * Mark-Oracle spread in bps. Sign + 2-decimal magnitude + "bp" unit.
 */
function BpsValue({ bps, className }: { bps: number; className?: string }) {
  const sign = bps > 0.005 ? "+" : bps < -0.005 ? "−" : " ";
  const num = `${sign}${Math.abs(bps).toFixed(2)}`;
  return <NumberUnit num={num} unit="bp" numClass={className} numWidth="3.2em" unitWidth="1.4em" />;
}

function statusStyles(s: SourceStatus): { label: string; cls: string; dot: string } {
  switch (s) {
    case "healthy":  return { label: "Healthy",  cls: "text-ember-green",         dot: "bg-ember-green" };
    case "degraded": return { label: "Degraded", cls: "text-yellow-500",          dot: "bg-yellow-500" };
    case "stale":    return { label: "Stale",    cls: "text-ember-red",           dot: "bg-ember-red" };
    case "error":    return { label: "Error",    cls: "text-ember-red",           dot: "bg-ember-red" };
    case "idle":     return { label: "Idle",     cls: "text-text-secondary/40",   dot: "bg-text-secondary/30" };
  }
}

function previewLatest(src: DataSource): string {
  const p = src.latestPayload as any;
  if (!p) return "";
  if (typeof p !== "object") return String(p).slice(0, 40);

  // Per-kind preview format — keep the row useful at-a-glance without
  // dumping the full payload.
  switch (src.kind) {
    case "phoenix-ws-market":
      if (typeof p.oraclePx === "number" && typeof p.markPx === "number" && typeof p.midPx === "number") {
        return `O ${formatPriceAuto(p.oraclePx)} · M ${formatPriceAuto(p.markPx)} · m ${formatPriceAuto(p.midPx)}`;
      }
      break;
    case "phoenix-ws-all-mids":
      return `${Object.keys(p.mids ?? {}).length} mids · slot ${p.slot ?? "?"}`;
    case "phoenix-ws-funding":
      return typeof p.funding === "number" ? `${(p.funding * 100).toFixed(4)}% per epoch` : "";
    case "phoenix-ws-orderbook": {
      const bestBid = Array.isArray(p.bids) ? p.bids[0] : null;
      const bestAsk = Array.isArray(p.asks) ? p.asks[0] : null;
      const bidPx = bestBid && typeof bestBid[0] === "number" ? bestBid[0] : null;
      const askPx = bestAsk && typeof bestAsk[0] === "number" ? bestAsk[0] : null;
      const depthBid = Array.isArray(p.bids) ? p.bids.length : 0;
      const depthAsk = Array.isArray(p.asks) ? p.asks.length : 0;
      if (bidPx && askPx) {
        const spread = ((askPx - bidPx) / askPx) * 10_000;
        return `${formatPriceAuto(bidPx)} / ${formatPriceAuto(askPx)} · ${spread.toFixed(1)}bp · ${depthBid}/${depthAsk}`;
      }
      return `${depthBid} bids · ${depthAsk} asks`;
    }
    case "phoenix-ws-trades": {
      const trades = Array.isArray(p.trades) ? p.trades : [];
      const last = trades[trades.length - 1];
      if (last) {
        const side = String(last.side ?? "").toLowerCase();
        const px = typeof last.px === "number" ? last.px : (typeof last.price === "number" ? last.price : null);
        const sz = typeof last.sz === "number" ? last.sz : (typeof last.size === "number" ? last.size : null);
        return `${side} ${sz != null ? sz.toFixed(4) : "?"} @ ${px != null ? formatPriceAuto(px) : "?"} · ${trades.length} this msg`;
      }
      return `${trades.length} trades`;
    }
    case "phoenix-ws-candles": {
      const c = p.candle ?? p;
      if (typeof c?.c === "number") return `O ${c.o} H ${c.h} L ${c.l} C ${c.c}`;
      if (typeof c?.close === "number") return `O ${c.open} H ${c.high} L ${c.low} C ${c.close}`;
      return "";
    }
  }

  // Generic fallback.
  if (Array.isArray(p)) return `[${p.length} items]`;
  const keys = Object.keys(p);
  return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
}

/**
 * Return mark-oracle spread in bps if the source's latest payload has
 * the three prices, else null. Used by the table's Spread column.
 */
function computeSpreadBps(src: DataSource): { markOracleBps: number; midOracleBps: number } | null {
  const p = src.latestPayload as any;
  if (!p || typeof p !== "object") return null;
  if (typeof p.oraclePx !== "number" || p.oraclePx <= 0) return null;
  if (typeof p.markPx !== "number" || typeof p.midPx !== "number") return null;
  return {
    markOracleBps: ((p.markPx - p.oraclePx) / p.oraclePx) * 10_000,
    midOracleBps:  ((p.midPx  - p.oraclePx) / p.oraclePx) * 10_000,
  };
}

/**
 * Compact USD formatter — "$5.21B" / "$172M" / "$84K" / "$12". Used
 * for the OI sub-figure in the Latest column and is the same shape as
 * fmtUsdAbbrev in the detail tray.
 */
function fmtUsdAbbrev(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Distilled "what does this market look like right now?" summary that
 * replaces the previous oracle/mark/mid triple in the Latest column.
 * Easier to read at a glance: price (what is it?), change (is it
 * moving?), OI (is this a real market?).
 *
 * Only populated for sources whose primary is `phoenix-ws-market` and
 * whose latest payload has actually arrived. Other sources (allMids,
 * funding, REST endpoints) keep the existing string preview.
 */
interface MarketSummary {
  markPx: number;
  changePct: number;       // 24h % change vs prevDayPx
  /**
   * Open interest in USD = base-unit open interest × mark price.
   * Phoenix's `openInterest` field is published in BASE asset units
   * (e.g. 10.34 for "10 BTC of OI"), not USD — we multiply by mark
   * here so the displayed value and the sort key are both in dollars.
   */
  openInterestUsd: number | null;
}

/**
 * A row as it appears in the table. May represent a single DataSource
 * (most categories) or a merged group of same-symbol sources (Phoenix
 * WS, where we collapse market/funding/orderbook/trades/candles for
 * one asset into a single row that opens to a multi-channel detail
 * tray).
 */
interface DisplayRow {
  /**
   * If present, the Latest column renders a structured market summary
   * (price + change % + OI). Falls back to `preview` text otherwise.
   * Also serves as the importance signal for sort order — rows with a
   * summary AND a positive OI rank higher than rows without.
   */
  marketSummary?: MarketSummary;
  /** React key — unique across the table. */
  reactKey: string;
  /** id sent to onSelect when the row is clicked. For a merged row,
   *  this is the "primary" channel's id (preferring market). */
  primaryId: string;
  /** All underlying DataSource ids in this row. A merged row contains
   *  many; a single row contains exactly its own. Used to detect
   *  selection when the user has flipped to a sibling channel. */
  memberIds: string[];
  /** Bold label — for merged rows this is the symbol; for single rows
   *  it's the source's label. */
  primaryLabel: string;
  /** Subline below the label — endpoint + context (channel count for
   *  merged rows, symbol for single rows). */
  secondaryLabel: string;
  /** Small pill rendered next to the primary label for merged rows
   *  ("5 channels"). undefined for single rows. */
  channelBadge?: string;
  /** Full-payload JSON used for the row-level title attribute. */
  latestPayloadJson: string;
  /** "Latest" column text. */
  preview: string;
  spread: { markOracleBps: number; midOracleBps: number } | null;
  ageSec: number | null;
  count: number;
  count60s: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  status: SourceStatus;
}

/**
 * Pull a MarketSummary out of a market-kind source's latest payload,
 * or null if the payload hasn't arrived yet (or the source isn't a
 * market kind).
 */
function extractMarketSummary(src: DataSource): MarketSummary | null {
  if (src.kind !== "phoenix-ws-market") return null;
  const p = src.latestPayload as any;
  if (!p || typeof p !== "object") return null;
  if (typeof p.markPx !== "number") return null;
  const prev = typeof p.prevDayPx === "number" && p.prevDayPx > 0 ? p.prevDayPx : null;
  const changePct = prev != null ? ((p.markPx - prev) / prev) * 100 : 0;
  const oiBase = typeof p.openInterest === "number" && Number.isFinite(p.openInterest) ? p.openInterest : null;
  // Phoenix's openInterest is base-asset units (e.g. 10 BTC), not USD.
  // Convert: USD OI = base × mark.
  const openInterestUsd = oiBase != null && p.markPx > 0 ? oiBase * p.markPx : null;
  return { markPx: p.markPx, changePct, openInterestUsd };
}

function toSingleRow(src: DataSource): DisplayRow {
  return {
    reactKey: src.id,
    primaryId: src.id,
    memberIds: [src.id],
    primaryLabel: src.label,
    secondaryLabel: src.endpoint + (src.symbol ? ` · ${src.symbol}` : ""),
    latestPayloadJson: JSON.stringify(src.latestPayload ?? null).slice(0, 400),
    preview: previewLatest(src),
    marketSummary: extractMarketSummary(src) ?? undefined,
    spread: computeSpreadBps(src),
    ageSec: src.stats.ageSec,
    count: src.stats.count,
    count60s: src.stats.count60s,
    p50Ms: src.stats.p50Ms,
    p95Ms: src.stats.p95Ms,
    maxMs: src.stats.maxMs,
    status: src.status,
  };
}

/**
 * Aggregate worst-case status across a group. Order: error/stale beats
 * degraded beats healthy beats idle.
 */
function aggregateStatus(members: DataSource[]): SourceStatus {
  const statuses = members.map((m) => m.status);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("healthy")) return "healthy";
  return "idle";
}

/**
 * Build display rows for the Phoenix WS category. Collapses
 * (market, funding, orderbook, trades, candles) for a given symbol
 * into ONE row whose Latest/Mark-Oracle/cadence columns are sourced
 * from the market channel (the richest one), while Age is the minimum
 * across all channels (freshest message wins) and Count/N/60s are
 * sums across channels.
 *
 * Sources without a symbol (allMids) are passed through as single
 * rows. Symbols with only one active channel also pass through as
 * single rows — there's no benefit to a "merged" UI for a row of one.
 */
function buildPhoenixWsRows(rows: DataSource[]): DisplayRow[] {
  const bySymbol = new Map<string, DataSource[]>();
  for (const r of rows) {
    const key = r.symbol ?? `__nosym:${r.kind}`;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push(r);
  }

  const out: DisplayRow[] = [];
  for (const [key, members] of bySymbol) {
    if (members.length === 1 || key.startsWith("__nosym:")) {
      out.push(toSingleRow(members[0]));
      continue;
    }
    const primary = members.find((m) => m.kind === "phoenix-ws-market") ?? members[0];
    const totalCount = members.reduce((acc, m) => acc + m.stats.count, 0);
    const totalCount60s = members.reduce((acc, m) => acc + m.stats.count60s, 0);
    const minAge = members.reduce<number | null>((acc, m) => {
      if (m.stats.ageSec == null) return acc;
      return acc == null ? m.stats.ageSec : Math.min(acc, m.stats.ageSec);
    }, null);
    out.push({
      reactKey: `phoenix-ws-merged:${primary.symbol ?? "?"}`,
      primaryId: primary.id,
      memberIds: members.map((m) => m.id),
      primaryLabel: primary.symbol ?? primary.label,
      secondaryLabel: `${primary.endpoint} · ${members.length} channels`,
      channelBadge: `${members.length} ch`,
      latestPayloadJson: JSON.stringify(primary.latestPayload ?? null).slice(0, 400),
      preview: previewLatest(primary),
      marketSummary: extractMarketSummary(primary) ?? undefined,
      spread: computeSpreadBps(primary),
      // Age + cadence come from the primary (market) channel —
      // semantic consistency matters: both should describe the same
      // feed. Mixing "freshest of any channel" age with "market only"
      // cadence makes the columns hard to reason about together.
      ageSec: primary.stats.ageSec,
      count: totalCount,
      count60s: totalCount60s,
      p50Ms: primary.stats.p50Ms,
      p95Ms: primary.stats.p95Ms,
      maxMs: primary.stats.maxMs,
      status: aggregateStatus(members),
    });
    void minAge; // (kept above for context — could be a future "freshness" indicator)
  }

  // Sort order:
  //   1. allMids first (global heartbeat — operationally important).
  //   2. Markets with a known open interest, descending by OI USD.
  //      Blue-chip markets (BTC / SOL / ETH) float to the top; the
  //      long tail of microcap perps falls to the bottom — and that
  //      tail is exactly where slow/sparse oracle feeds are likely
  //      to surface, which keeps them visible without crowding the
  //      important rows.
  //   3. Markets with no OI snapshot yet (first message not in) —
  //      sorted alphabetically below the ranked block so they don't
  //      cause shuffling once data lands.
  //   4. Non-market sources (funding-only rows in odd chip states,
  //      etc.) — alphabetical.
  return out.sort((a, b) => {
    const aGlobal = !a.primaryLabel || a.primaryLabel.toLowerCase() === "allmids";
    const bGlobal = !b.primaryLabel || b.primaryLabel.toLowerCase() === "allmids";
    if (aGlobal && !bGlobal) return -1;
    if (!aGlobal && bGlobal) return 1;

    const aOi = a.marketSummary?.openInterestUsd ?? null;
    const bOi = b.marketSummary?.openInterestUsd ?? null;
    if (aOi != null && bOi != null) return bOi - aOi;
    if (aOi != null) return -1;
    if (bOi != null) return 1;
    return a.primaryLabel.localeCompare(b.primaryLabel);
  });
}

function buildDisplayRows(cat: SourceCategory, rows: DataSource[]): DisplayRow[] {
  if (cat === "phoenix-ws") return buildPhoenixWsRows(rows);
  return rows.map(toSingleRow);
}

export function SourceTable({ sources, expanded, onToggle, selectedId, onSelect, filter, hiddenKinds }: Props) {
  // Group by category. Track total-before-filter so we can distinguish
  // "category is empty because we haven't wired it yet" from "category is
  // empty because the filter excluded everything".
  const groups = new Map<SourceCategory, DataSource[]>();
  const totalsByCategory = new Map<SourceCategory, number>();
  const normalizedFilter = filter.trim().toLowerCase();
  for (const s of sources) {
    totalsByCategory.set(s.category, (totalsByCategory.get(s.category) ?? 0) + 1);
    if (hiddenKinds.has(s.kind)) continue;
    if (normalizedFilter && !`${s.id} ${s.label}`.toLowerCase().includes(normalizedFilter)) continue;
    const arr = groups.get(s.category) ?? [];
    arr.push(s);
    groups.set(s.category, arr);
  }

  const categoryOrder: SourceCategory[] = ["phoenix-ws", "external-oracle", "phoenix-rest", "ember-ws", "ember-rest"];

  return (
    <div className="flex flex-col gap-3">
      {categoryOrder.map((cat) => {
        const rawRows = groups.get(cat) ?? [];
        const displayRows = buildDisplayRows(cat, rawRows);
        const totalRegistered = totalsByCategory.get(cat) ?? 0;
        // Hide categories that have ZERO registered sources entirely —
        // they're not wired yet, so listing them with a misleading "no
        // sources match the current filter" message is confusing.
        if (totalRegistered === 0) return null;
        const isOpen = expanded[cat] ?? true;
        const healthy = displayRows.filter((r) => r.status === "healthy").length;
        const degraded = displayRows.filter((r) => r.status === "degraded").length;
        const stale = displayRows.filter((r) => r.status === "stale" || r.status === "error").length;
        const total = displayRows.length;
        return (
          <div key={cat} className="border border-ember-border bg-surface-l1">
            <button
              onClick={() => onToggle(cat)}
              className="flex w-full items-center justify-between border-b border-ember-border/60 px-4 py-2 text-left hover:bg-surface-l2/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-text-secondary/50">{isOpen ? "▾" : "▸"}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-text-primary">{CATEGORY_LABELS[cat]}</span>
                <span className="font-mono text-[10px] text-text-secondary/40">{CATEGORY_DESC[cat]}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[10px]">
                <span className="text-ember-green">● {healthy}</span>
                <span className="text-yellow-500">● {degraded}</span>
                <span className="text-ember-red">● {stale}</span>
                <span className="text-text-secondary/50">{total} total</span>
              </div>
            </button>

            {isOpen && displayRows.length > 0 && (
              <div className="overflow-x-auto">
                {/*
                  table-layout: fixed + explicit colgroup widths so column
                  widths don't jitter every time a number changes precision
                  (e.g. "0.01%" vs "-1.3349%"). tabular-nums on numeric cells
                  reinforces it. With auto layout the table re-measures every
                  cell on every paint — at 500ms flush × 100+ rows that meant
                  the columns visibly wiggled.
                */}
                {/*
                  Six-column distilled view. Anything more detailed
                  (Count, N/60s, Gap p95, Gap p99, Gap max, recent-arrival
                  sparkline, raw samples) lives in the detail tray so the
                  main table stays glanceable.

                  table-layout: fixed + explicit colgroup widths +
                  NumberUnit-formatted numeric cells means columns and
                  in-cell value positions don't shift as values cross
                  unit/magnitude boundaries.
                */}
                <table className="w-full font-mono text-[11px]" style={{ tableLayout: "fixed", minWidth: "960px" }}>
                  <colgroup>
                    <col style={{ width: "240px" }} />  {/* Source */}
                    <col style={{ width: "320px" }} />  {/* Latest */}
                    <col style={{ width: "110px" }} />  {/* Mark-Oracle */}
                    <col style={{ width: "90px"  }} />  {/* Age */}
                    <col style={{ width: "90px"  }} />  {/* Cadence */}
                    <col style={{ width: "110px" }} />  {/* Status */}
                  </colgroup>
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-text-secondary/40">
                      <Th align="left">Source</Th>
                      <Th align="left">Latest</Th>
                      <Th align="right" title="Mark−Oracle spread in basis points (market sources only). Positive = mark trades above oracle. Click any row to see Mid-Oracle and Mid-Mark in the detail panel.">Spread</Th>
                      <Th align="right" title="Time since the most recent message arrived. Grows from 0 to roughly the cadence (one publish interval) and resets each update. Click the row for percentiles + raw samples.">Age</Th>
                      <Th align="right" title="Median GAP between consecutive messages — how often the source publishes. ~1000ms for a 1Hz feed. Click the row for p95, p99, max and the full inter-arrival sparkline.">Cadence</Th>
                      <Th align="left">Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const ss = statusStyles(row.status);
                      const selected = selectedId != null && row.memberIds.includes(selectedId);
                      return (
                        <tr
                          key={row.reactKey}
                          onClick={() => onSelect(row.primaryId)}
                          className={clsx(
                            "cursor-pointer border-b border-ember-border/20 transition-colors",
                            selected ? "bg-ember-orange/10" : "hover:bg-surface-l2/30",
                          )}
                        >
                          <td className="px-3 py-1.5 overflow-hidden">
                            <div className="flex items-center gap-2 truncate">
                              <span className="truncate text-text-primary">{row.primaryLabel}</span>
                              {row.channelBadge && (
                                <span className="shrink-0 rounded border border-ember-border/50 bg-surface-l2/60 px-1 py-0.5 text-[8px] uppercase tracking-wider text-text-secondary/70">
                                  {row.channelBadge}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[9px] text-text-secondary/40">{row.secondaryLabel}</div>
                          </td>
                          <td className="overflow-hidden px-3 py-1.5 truncate text-[10px]" title={row.latestPayloadJson}>
                            {row.marketSummary ? (
                              <MarketSummaryCell summary={row.marketSummary} />
                            ) : (
                              <span className="text-text-secondary/70">{row.preview}</span>
                            )}
                          </td>
                          <td className="overflow-hidden px-3 py-1.5 text-right font-mono text-[10px]">
                            {row.spread ? (
                              <BpsValue
                                bps={row.spread.markOracleBps}
                                className={Math.abs(row.spread.markOracleBps) < 1 ? "text-text-secondary/60" : row.spread.markOracleBps > 0 ? "text-ember-green" : "text-ember-red"}
                              />
                            ) : (
                              <span className="text-text-secondary/30">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <AgeValue
                              sec={row.ageSec}
                              className={
                                row.ageSec == null ? "text-text-secondary/40"
                                : row.ageSec < 5 ? "text-ember-green"
                                : row.ageSec < 30 ? "text-yellow-500"
                                : "text-ember-red"
                              }
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <GapValue
                              ms={row.p50Ms}
                              className={
                                row.p50Ms == null ? "text-text-secondary/40"
                                : row.p50Ms < 1500 ? "text-text-primary"
                                : row.p50Ms < 5000 ? "text-yellow-500"
                                : "text-ember-red"
                              }
                            />
                          </td>
                          <td className="overflow-hidden px-3 py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", ss.dot)} />
                              <span className={clsx("text-[10px] uppercase tracking-wider", ss.cls)}>{ss.label}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {isOpen && displayRows.length === 0 && (
              <div className="px-4 py-3 font-mono text-[10px] text-text-secondary/40">
                {normalizedFilter
                  ? `No sources in this category match "${filter}".`
                  : "No sources match the current filter."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Latest cell for market-backed Phoenix WS rows. Trades the old
 * cryptic "O 95.58 · M 95.50 · m 95.54" oracle/mark/mid triple for a
 * cleaner glance-friendly summary:
 *
 *    $79,295.00   +1.24%   OI $5.2B
 *
 * The price answers "what?", the change answers "is it moving?", and
 * the OI answers "is this a real market?". Full spread analysis lives
 * in the detail tray's Market Snapshot block.
 *
 * Layout: an inline-flex row with explicit gaps and tabular-nums so
 * the price and change-% don't visually wobble between updates.
 */
function MarketSummaryCell({ summary }: { summary: MarketSummary }) {
  const { markPx, changePct, openInterestUsd } = summary;
  const changeColor =
    Math.abs(changePct) < 0.01 ? "text-text-secondary/60"
    : changePct >= 0 ? "text-ember-green"
    : "text-ember-red";
  const changeSign = changePct > 0 ? "+" : changePct < 0 ? "" : " ";
  return (
    <span className="inline-flex items-baseline gap-3 tabular-nums">
      <span className="text-text-primary">${formatPriceAuto(markPx)}</span>
      <span className={changeColor}>
        {changeSign}{changePct.toFixed(2)}%
      </span>
      {openInterestUsd != null && openInterestUsd > 0 && (
        <span className="text-text-secondary/45">
          <span className="text-text-secondary/35">OI </span>{fmtUsdAbbrev(openInterestUsd)}
        </span>
      )}
    </span>
  );
}

/**
 * Column header with an instant CSS hover-popover (not native `title=`,
 * which has a ~700ms-1s browser delay). The popover anchors to the
 * dotted-underline span so it appears just below the label, regardless
 * of header alignment.
 */
function Th({ children, align = "left", title }: { children: React.ReactNode; align?: "left" | "right"; title?: string }) {
  return (
    <th className={clsx("px-3 py-1.5 font-normal", align === "right" ? "text-right" : "text-left")}>
      {title ? (
        <span className="group relative inline-block cursor-help border-b border-dotted border-text-secondary/30">
          {children}
          <span
            role="tooltip"
            className={clsx(
              "pointer-events-none invisible absolute top-full z-50 mt-1 normal-case whitespace-normal rounded border border-ember-border bg-surface-l3/95 px-2 py-1.5 font-mono text-[10px] leading-snug tracking-normal text-text-primary opacity-0 shadow-xl backdrop-blur-sm transition-opacity duration-75 group-hover:visible group-hover:opacity-100",
              align === "right" ? "right-0" : "left-0",
            )}
            style={{ width: "max-content", maxWidth: "320px" }}
          >
            {title}
          </span>
        </span>
      ) : (
        children
      )}
    </th>
  );
}
