/**
 * Data-source model for the observability page.
 *
 * Every observed channel/endpoint is normalized into a `DataSource` so the
 * UI can render them uniformly: same status indicators, same cadence
 * tracking, same code-snippet machinery. The hook in
 * `useObservability.ts` is the single owner of all sources.
 */

export type SourceCategory =
  | "phoenix-ws"      // wss://perp-api.phoenix.trade/ws — direct Phoenix stream
  | "phoenix-rest"    // https://perp-api.phoenix.trade — direct Phoenix REST
  | "ember-ws"        // our backend's /ws — backend-relayed feeds
  | "ember-rest"      // our backend's /api/* — REST endpoints
  | "external-oracle"; // independent price feeds (Pyth Hermes streaming endpoint)

/**
 * The semantic kind of a source. Drives snippet generation and the
 * payload-shape contract. Adding a new kind = registering a generator
 * in snippets.ts.
 */
export type SourceKind =
  // ── Phoenix WS channels (direct) ────────────────────────────────────
  | "phoenix-ws-market"      // subscribe_to_market(symbol): oracle/mark/mid + funding
  | "phoenix-ws-all-mids"    // subscribe_to_all_mids: global heartbeat
  | "phoenix-ws-funding"     // subscribe_to_funding_rate(symbol)
  | "phoenix-ws-orderbook"   // subscribe_to_orderbook(symbol): L2 snapshots
  | "phoenix-ws-trades"      // subscribe_to_trades(symbol): print stream
  | "phoenix-ws-candles"     // subscribe_to_candles(symbol, timeframe)
  // ── Phoenix REST (direct, polled) ───────────────────────────────────
  | "phoenix-rest-exchange"  // GET /exchange — markets snapshot
  | "phoenix-rest-orderbook" // GET /orderbook/{symbol}
  // ── Ember WS (backend-relayed equivalents) ──────────────────────────
  | "ember-ws-stats"
  | "ember-ws-orderbook"
  | "ember-ws-trades"
  | "ember-ws-candles"
  // ── Ember REST ──────────────────────────────────────────────────────
  | "ember-rest-markets"     // GET /api/markets
  | "ember-rest-orderbook"   // GET /api/orderbook/{symbol}
  | "ember-rest-candles"     // GET /api/candles/{symbol}
  | "ember-rest-health-memory" // GET /health/memory
  | "ember-rest-health-relay"  // GET /health/relay
  | "ember-rest-health-ws"     // GET /health/ws
  // ── External oracle (Pyth Network) ──────────────────────────────────
  // Hermes streaming endpoint (https://hermes.pyth.network) — same
  // upstream feed Pyth Lazer uses, delivered over Server-Sent Events.
  // Updates at the Pyth publish cadence (~50–200 ms per feed),
  // independent of Phoenix's 1Hz mark. Used as a cross-validation
  // source for Phoenix's `oraclePx` on the Live Comparison Chart.
  | "pyth-hermes";

export type SourceStatus =
  | "healthy"   // last update recent + cadence within budget
  | "degraded"  // last update somewhat old or cadence stretched
  | "stale"     // no recent update at all
  | "error"     // last attempt errored
  | "idle";     // never started (e.g. paused, awaiting symbol list)

/** Rolling latency / activity stats per source. */
export interface SourceStats {
  /** Total messages or successful polls since the most recent reset. */
  count: number;
  /** Approx count of arrivals in the last 60s window. */
  count60s: number;
  /** Messages per second over the last 60s. */
  rate60s: number;
  /** performance.now() timestamp of the last successful arrival. */
  lastUpdateAtMs: number | null;
  /**
   * Seconds since `lastUpdateAtMs`, recomputed at flush time. This is the
   * "how stale is the freshest value RIGHT NOW" metric — it grows from 0
   * back up to ~p50 inter-arrival between messages. Do NOT confuse with
   * a request-latency measurement; it is unrelated.
   */
  ageSec: number | null;
  /**
   * Inter-arrival GAP percentiles in ms — how long between successive
   * messages, NOT request latency. If a feed publishes ~once per second,
   * `p50Ms` will be ~1000ms even though every individual message arrives
   * in microseconds once it's on the wire.
   */
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Worst gap seen in the window. */
  maxMs: number | null;
  /**
   * The raw inter-arrival samples (ms) feeding the percentiles, newest
   * last. Capped at a reasonable size for display; the full ring lives
   * in the hook. Exposed so the detail tray can render a sparkline /
   * list so the user can see exactly what the aggregate numbers are
   * derived from.
   */
  recentArrivals: number[];
  /** Number of failed polls / WS errors since reset. */
  errorCount: number;
  lastErrorAtMs: number | null;
  lastErrorMessage: string | null;
}

/** Static-ish description of a source — what it is, where it lives. */
export interface SourceDescriptor {
  /** Canonical key e.g. "phoenix-ws:market:SOL". Stable across reloads. */
  id: string;
  kind: SourceKind;
  category: SourceCategory;
  /** Short label for table rows: "SOL — market" or "Health · memory". */
  label: string;
  /** Tooltip / detail-tray description of what this returns + cadence notes. */
  description: string;
  /** URL or wss:// endpoint this source uses. */
  endpoint: string;
  /** Subscribe / poll cadence target in ms. For WS this is heuristic only. */
  expectedCadenceMs?: number;
  /** Symbol context, if relevant. */
  symbol?: string;
  /** Wallet pubkey context, if relevant. */
  pubkey?: string;
  /** Timeframe (for candles). */
  timeframe?: string;
}

/** Hydrated source: descriptor + live stats + latest payload. */
export interface DataSource extends SourceDescriptor {
  stats: SourceStats;
  status: SourceStatus;
  /** Most recently received payload (parsed JSON or whatever). */
  latestPayload: unknown;
  /**
   * Recent payloads with arrival timestamps, capped at HISTORY_LIMIT.
   * Kept in memory while the page is open + persisted to localStorage so
   * a refresh doesn't wipe the visible context.
   */
  recentPayloads: Array<{ tMs: number; payload: unknown }>;
}

/**
 * Per-source-kind history cap. High-volume channels (orderbook, trades)
 * carry potentially huge payloads (full L2 books); we cap them tightly
 * to keep the in-memory + localStorage footprint bounded. Low-volume
 * channels keep the longer tail for richer history scrollback.
 */
export const HISTORY_LIMIT_BY_KIND: Partial<Record<SourceKind, number>> = {
  // Bumped from default 100 → 720 so the Live Comparison Chart on
  // /stats has enough history to render a 10-min window at 1Hz cadence
  // with headroom. ~12 min × 30 markets × ~50B per payload ≈ 1.3 MB,
  // still well under the 3 MB localStorage budget.
  "phoenix-ws-market":    720,
  // Same reasoning for the external oracle: 12 min at ~5Hz is enough
  // to cover all chart windows even under the densest update cadence.
  "pyth-hermes": 3600,
  "phoenix-ws-orderbook": 10,
  "phoenix-ws-trades":    20,
  "phoenix-ws-candles":   30,
};

/** Default cap for any source kind that isn't listed above. */
export const HISTORY_LIMIT_DEFAULT = 100;

export function historyLimitFor(kind: SourceKind): number {
  return HISTORY_LIMIT_BY_KIND[kind] ?? HISTORY_LIMIT_DEFAULT;
}

/** Maximum interarrival samples used to compute percentiles. */
export const ARRIVAL_SAMPLE_LIMIT = 256;

/**
 * Kinds whose payloads contain too much data to be worth persisting
 * (full orderbook snapshots can be tens of KB each). We still track
 * their cadence + latest payload in memory, but they don't go to
 * localStorage. Otherwise the 3MB persistence budget gets blown.
 */
export const NO_PERSIST_KINDS = new Set<SourceKind>([
  "phoenix-ws-orderbook",
  "phoenix-ws-trades",
  // 3,600 samples × 30B per payload ≈ 100 KB per symbol; with 4 feeds
  // that's 400 KB just for Pyth Lazer history. Cheaper to re-warm
  // from the live feed on reload than to persist.
  "pyth-hermes",
]);
