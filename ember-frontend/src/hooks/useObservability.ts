"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DataSource,
  SourceCategory,
  SourceDescriptor,
  SourceKind,
  SourceStats,
  SourceStatus,
} from "@/lib/observability/types";
import { ARRIVAL_SAMPLE_LIMIT, historyLimitFor, NO_PERSIST_KINDS } from "@/lib/observability/types";
import { loadPersisted, loadPreferences, savePersisted } from "@/lib/observability/persistence";
import {
  buildHermesStreamUrl,
  parseHermesEvent,
  PYTH_FEED_IDS,
  pythCoveredPhoenixSymbols,
} from "@/lib/observability/pyth";

/**
 * Observability hook — single source of truth for the /stats page.
 *
 * Owns:
 *  - One Phoenix WebSocket (wss://perp-api.phoenix.trade/ws) with N
 *    subscriptions multiplexed over it
 *  - One Ember backend WebSocket (wss://ember-api.asymmetra.xyz/ws)
 *    for the relayed-feed comparison sources
 *  - Periodic REST pollers for Ember's /api/markets, /health/memory,
 *    /health/relay, /health/ws (and any future REST source)
 *  - A registry mapping `source id → DataSource` with rolling latency
 *    stats, status badges, latest payload, and recent-history buffer
 *  - localStorage persistence so a page refresh doesn't wipe context
 *  - Pause / resume / clear-history controls
 *
 * Auto-discovers new markets by repolling /api/markets every 5 minutes
 * and re-subscribing if the symbol list grew. So when Phoenix lists a
 * new perp, the observability page picks it up automatically.
 *
 * Architectural note: per-message state is mutated on refs (NEVER
 * triggering React re-renders directly). A 500ms tick flushes
 * aggregates + a shallow snapshot into React state for paint. This is
 * the only way to keep the page responsive when ~50 sources are
 * pushing dozens of messages per second.
 */

const PHOENIX_WS_URL = "wss://perp-api.phoenix.trade/ws";
const EMBER_REST_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://ember-api.asymmetra.xyz";
const TICK_MS = 500;
const PERSIST_MS = 5_000;
const MARKETS_POLL_MS = 5 * 60_000;        // re-pull market list every 5 min
const CONNECT_TIMEOUT_MS = 10_000;          // open within 10s or mark "error"
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 30_000;

interface RawSource {
  descriptor: SourceDescriptor;
  latestPayload: unknown;
  recentPayloads: Array<{ tMs: number; payload: unknown }>;
  count: number;
  errorCount: number;
  lastUpdateAtMs: number | null;
  lastErrorAtMs: number | null;
  lastErrorMessage: string | null;
  arrivals: number[]; // ring buffer of inter-arrival deltas in ms
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected" | "error" | "idle";

interface ConnectionRecord {
  state: ConnectionState;
  url: string;
  connectedAtMs: number | null;
  reconnects: number;
  totalUpdates: number;
  lastErrorMessage: string | null;
}

export interface ObservabilitySnapshot {
  /** Every known source, indexed by id, with hydrated stats. */
  sources: Record<string, DataSource>;
  /** Aggregate per-category health (counts of healthy / degraded / stale). */
  categoryHealth: Record<SourceCategory, { healthy: number; degraded: number; stale: number; error: number; idle: number; total: number }>;
  /** Phoenix WS connection state. */
  phoenixWs: ConnectionRecord;
  /** Ember backend WS connection state. */
  emberWs: ConnectionRecord;
  /** Global counters. */
  global: {
    paused: boolean;
    totalMessages: number;
    msgsPerSec60s: number;
    uptimeSec: number;
  };
}

export interface UseObservabilityOptions {
  /** Markets to subscribe to on Phoenix WS. Driven by /api/markets. */
  symbols: string[];
  /** Whether new arrivals should be accepted (pauses ALL ingestion). */
  paused: boolean;
  /**
   * Which Phoenix WS kinds to actually subscribe to. Kinds NOT in this
   * set are not subscribed at all — we don't even ask Phoenix for the
   * data. This is important: subscribing to a kind we're going to hide
   * (e.g. orderbook at ~10Hz × 29 markets ≈ 290 msgs/sec) congests the
   * single Phoenix WebSocket and inflates the perceived inter-arrival
   * GAPS of the channels the user IS looking at. Subscribing only to
   * enabled kinds restores accurate per-channel cadence.
   *
   * `phoenix-ws-all-mids` is implicitly always subscribed (it's a
   * single global heartbeat with negligible bandwidth) — listing it
   * explicitly is fine but not required.
   */
  enabledPhoenixKinds: Set<SourceKind>;
}

function pickPercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Health classifier — adapted per source's expected cadence so that
 * fast WS streams (1Hz) and slow REST polls (every 30s) don't both
 * get measured against the same threshold. A REST endpoint polled
 * every 30s SHOULD have a 30s inter-arrival — that's healthy, not
 * degraded.
 *
 * Thresholds, where E = expectedCadenceMs:
 *   stale     → age > max(30s, 6×E)
 *   degraded  → age > max(5s, 2×E)  OR  p95 > max(2s, 3×E)
 *   healthy   → otherwise
 */
function classifyHealth(
  lastUpdateAtMs: number | null,
  nowMs: number,
  p95: number | null,
  count: number,
  errorCount: number,
  hadActivity: boolean,
  expectedCadenceMs: number | undefined,
): SourceStatus {
  if (count === 0 && !hadActivity) {
    return errorCount > 0 ? "error" : "idle";
  }
  if (lastUpdateAtMs == null) return "idle";
  const ageMs = nowMs - lastUpdateAtMs;
  const E = expectedCadenceMs ?? 1_000;
  const staleAge    = Math.max(30_000, 6 * E);
  const degradedAge = Math.max(5_000,  2 * E);
  const degradedP95 = Math.max(2_000,  3 * E);
  if (ageMs > staleAge) return "stale";
  if (ageMs > degradedAge || (p95 != null && p95 > degradedP95)) return "degraded";
  return "healthy";
}

// Compose a deterministic source id so localStorage keys are stable.
function sourceId(kind: SourceKind, symbol?: string): string {
  return symbol ? `${kind}:${symbol}` : kind;
}

function makeDescriptor(kind: SourceKind, symbol?: string): SourceDescriptor {
  const id = sourceId(kind, symbol);
  const symLabel = symbol ?? "";
  switch (kind) {
    case "phoenix-ws-market":
      return {
        id, kind, category: "phoenix-ws", symbol,
        label: `${symLabel} · market`,
        description: "Phoenix WS subscribe_to_market stream: oracle_price, mark_price, mid_price, funding rate, open interest, 24h volume. Event-driven (no guaranteed cadence). The primary oracle feed.",
        endpoint: PHOENIX_WS_URL,
        // Empirically Phoenix publishes ~1s for this channel even on liquid
        // markets. Healthy if we stay within 2× that window.
        expectedCadenceMs: 1_000,
      };
    case "phoenix-ws-all-mids":
      return {
        id, kind, category: "phoenix-ws",
        label: "allMids",
        description: "Phoenix WS subscribe_to_all_mids: every market's mid price + slot, in one message. Useful as a heartbeat — if this flows but per-market market is silent, Phoenix is just deliberately quiet on that market (no oracle ticks).",
        endpoint: PHOENIX_WS_URL,
        expectedCadenceMs: 1_000,
      };
    case "phoenix-ws-funding":
      return {
        id, kind, category: "phoenix-ws", symbol,
        label: `${symLabel} · funding`,
        description: "Phoenix WS subscribe_to_funding_rate: per-market funding rate updates. Very low frequency (settlements happen on 8h boundaries; intra-epoch updates are sparse).",
        endpoint: PHOENIX_WS_URL,
        // Funding can be silent for many minutes between epoch boundaries —
        // use a generous threshold so we don't flag healthy markets as stale.
        expectedCadenceMs: 300_000,
      };
    case "phoenix-ws-orderbook":
      return {
        id, kind, category: "phoenix-ws", symbol,
        label: `${symLabel} · orderbook`,
        description: "Phoenix WS subscribe_to_orderbook: L2 book snapshots. Pushed on every book change so cadence tracks market activity. Highest-volume channel — recentPayloads cap kept small to bound memory.",
        endpoint: PHOENIX_WS_URL,
        expectedCadenceMs: 500,
      };
    case "phoenix-ws-trades":
      return {
        id, kind, category: "phoenix-ws", symbol,
        label: `${symLabel} · trades`,
        description: "Phoenix WS subscribe_to_trades: print stream of executed fills. Cadence is liquidity-bound — illiquid markets can be silent for minutes.",
        endpoint: PHOENIX_WS_URL,
        // Trades come whenever there's volume; some markets are quiet.
        expectedCadenceMs: 30_000,
      };
    case "phoenix-ws-candles":
      return {
        id, kind, category: "phoenix-ws", symbol, timeframe: "1m",
        label: `${symLabel} · candles 1m`,
        description: "Phoenix WS subscribe_to_candles: 1-minute candle updates. Closes at minute boundaries and updates in-flight as trades arrive.",
        endpoint: PHOENIX_WS_URL,
        expectedCadenceMs: 60_000,
      };
    case "ember-rest-markets":
      return {
        id, kind, category: "ember-rest",
        label: "GET /api/markets",
        description: "Ember backend's market list. Polled every 30s; auto-discovers new Phoenix markets so they show up in the observability page without a manual update.",
        endpoint: `${EMBER_REST_URL}/api/markets`,
        expectedCadenceMs: 30_000,
      };
    case "ember-rest-health-memory":
      return {
        id, kind, category: "ember-rest",
        label: "GET /health/memory",
        description: "Ember backend's process memory + DashMap sizes + per-channel subscriber counts. Lets us see if the backend's RSS is growing or if any in-memory structure is leaking.",
        endpoint: `${EMBER_REST_URL}/health/memory`,
        expectedCadenceMs: 30_000,
      };
    case "ember-rest-health-relay":
      return {
        id, kind, category: "ember-rest",
        label: "GET /health/relay",
        description: "Ember backend's per-channel relay status — which symbol/channels are receiving fresh data from Phoenix and which have stalled.",
        endpoint: `${EMBER_REST_URL}/health/relay`,
        expectedCadenceMs: 30_000,
      };
    case "ember-rest-health-ws":
      return {
        id, kind, category: "ember-rest",
        label: "GET /health/ws",
        description: "Ember backend's WebSocket health summary.",
        endpoint: `${EMBER_REST_URL}/health/ws`,
        expectedCadenceMs: 30_000,
      };
    case "pyth-hermes":
      return {
        id, kind, category: "external-oracle", symbol,
        label: `${symLabel} · pyth`,
        description: "Pyth Network price feed via the Hermes streaming endpoint (https://hermes.pyth.network/v2/updates/price/stream). Independent of Phoenix; updates at the Pyth publish cadence (~50–200 ms per feed). Used as a cross-validation reference for Phoenix's oracle/mark prices on the Live Comparison Chart.",
        endpoint: "https://hermes.pyth.network",
        expectedCadenceMs: 200,
      };
    default:
      return {
        id, kind, category: "phoenix-ws", symbol,
        label: `${kind}${symbol ? ` · ${symbol}` : ""}`,
        description: "",
        endpoint: PHOENIX_WS_URL,
      };
  }
}

/**
 * Channel-name conversion between our internal SourceKind and the
 * channel string Phoenix's WS protocol expects.
 */
function phoenixChannelFor(kind: SourceKind): { channel: string; needsSymbol: boolean; timeframe?: string } | null {
  switch (kind) {
    case "phoenix-ws-market":     return { channel: "market",      needsSymbol: true  };
    case "phoenix-ws-all-mids":   return { channel: "allMids",     needsSymbol: false };
    case "phoenix-ws-funding":    return { channel: "fundingRate", needsSymbol: true  };
    case "phoenix-ws-orderbook":  return { channel: "orderbook",   needsSymbol: true  };
    case "phoenix-ws-trades":     return { channel: "trades",      needsSymbol: true  };
    case "phoenix-ws-candles":    return { channel: "candles",     needsSymbol: true, timeframe: "1m" };
    default:                      return null;
  }
}

const PHOENIX_WS_KINDS: SourceKind[] = [
  "phoenix-ws-market",
  "phoenix-ws-all-mids",
  "phoenix-ws-funding",
  "phoenix-ws-orderbook",
  "phoenix-ws-trades",
  "phoenix-ws-candles",
];

/** Stable string key for a (kind, symbol) pair used in the subscription set. */
function subKey(kind: SourceKind, symbol?: string): string {
  return symbol ? `${kind}::${symbol}` : kind;
}

export function useObservability(options: UseObservabilityOptions) {
  const { symbols, paused, enabledPhoenixKinds } = options;
  const sourcesRef = useRef<Map<string, RawSource>>(new Map());
  const phoenixWsRef = useRef<WebSocket | null>(null);
  const phoenixStateRef = useRef<ConnectionRecord>({
    state: "connecting",
    url: PHOENIX_WS_URL,
    connectedAtMs: null,
    reconnects: 0,
    totalUpdates: 0,
    lastErrorMessage: null,
  });
  const emberStateRef = useRef<ConnectionRecord>({
    state: "idle",
    url: "",
    connectedAtMs: null,
    reconnects: 0,
    totalUpdates: 0,
    lastErrorMessage: null,
  });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;
  const enabledKindsRef = useRef(enabledPhoenixKinds);
  enabledKindsRef.current = enabledPhoenixKinds;
  /**
   * Subscriptions currently held on the live Phoenix WS, keyed by
   * subKey(kind, symbol). Reconciled on connect, symbol-list change,
   * and chip toggle. On WS close this is reset (subscriptions don't
   * survive a reconnect on Phoenix's side).
   */
  const currentSubsRef = useRef<Set<string>>(new Set());
  /**
   * Stable handle to the in-effect `reconcile(ws)` function. Set inside
   * the Phoenix WS effect (where the closure has access to the local
   * helpers); read by the outer effect that watches symbols + enabled
   * kinds so it can re-fire reconciliation without tearing the WS down.
   */
  const reconcileRef = useRef<((ws: WebSocket) => void) | null>(null);
  const recentMsgTimestampsRef = useRef<number[]>([]);

  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot>(() => ({
    sources: {},
    categoryHealth: {
      "phoenix-ws": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
      "phoenix-rest": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
      "ember-ws": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
      "ember-rest": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
      "external-oracle": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
    },
    phoenixWs: phoenixStateRef.current,
    emberWs: emberStateRef.current,
    global: { paused: false, totalMessages: 0, msgsPerSec60s: 0, uptimeSec: 0 },
  }));

  // ── Register sources lazily so adding a new market = adding rows.
  const ensureSource = useCallback((kind: SourceKind, symbol?: string): RawSource => {
    const id = sourceId(kind, symbol);
    const existing = sourcesRef.current.get(id);
    if (existing) return existing;
    const fresh: RawSource = {
      descriptor: makeDescriptor(kind, symbol),
      latestPayload: null,
      recentPayloads: [],
      count: 0,
      errorCount: 0,
      lastUpdateAtMs: null,
      lastErrorAtMs: null,
      lastErrorMessage: null,
      arrivals: [],
    };
    sourcesRef.current.set(id, fresh);
    return fresh;
  }, []);

  const recordEvent = useCallback((id: string, payload: unknown) => {
    if (pausedRef.current) return;
    const s = sourcesRef.current.get(id);
    if (!s) return;
    const nowMs = performance.now();
    if (s.lastUpdateAtMs != null) {
      const delta = nowMs - s.lastUpdateAtMs;
      s.arrivals.push(delta);
      if (s.arrivals.length > ARRIVAL_SAMPLE_LIMIT) s.arrivals.shift();
    }
    s.lastUpdateAtMs = nowMs;
    s.count += 1;
    s.latestPayload = payload;
    s.recentPayloads.push({ tMs: nowMs, payload });
    // Per-kind cap so high-volume channels (orderbook, trades) don't
    // blow up memory. Most kinds keep the full 100-message tail.
    const cap = historyLimitFor(s.descriptor.kind);
    if (s.recentPayloads.length > cap) {
      s.recentPayloads.splice(0, s.recentPayloads.length - cap);
    }
    recentMsgTimestampsRef.current.push(nowMs);
  }, []);

  const recordError = useCallback((id: string, message: string) => {
    const s = sourcesRef.current.get(id);
    if (!s) return;
    s.errorCount += 1;
    s.lastErrorAtMs = performance.now();
    s.lastErrorMessage = message;
  }, []);

  // ── Restore from localStorage on mount.
  useEffect(() => {
    const persisted = loadPersisted();
    if (!persisted) return;
    for (const slice of Object.values(persisted.sources)) {
      // Recreate the descriptor from the id (best-effort — the id encodes
      // kind + symbol). We don't trust types from disk; treat as opaque.
      const [kind, symbol] = slice.id.split(":") as [SourceKind, string | undefined];
      const s = ensureSource(kind, symbol);
      s.count = slice.count;
      s.errorCount = slice.errorCount;
      s.recentPayloads = slice.recentPayloads;
      // We don't restore lastUpdateAtMs because performance.now() resets on
      // page reload; the next live arrival will set a fresh timestamp.
    }
  }, [ensureSource]);

  // ── Phoenix WS connection.
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    /**
     * Compute the desired (kind, symbol) subscription set from the
     * current symbol list + the user's enabled-kinds preference.
     * allMids is ALWAYS desired (one global heartbeat, negligible cost,
     * useful even when per-symbol market is disabled).
     */
    const computeDesired = (): Set<string> => {
      const desired = new Set<string>();
      desired.add(subKey("phoenix-ws-all-mids"));
      for (const sym of symbolsRef.current) {
        for (const kind of PHOENIX_WS_KINDS) {
          if (kind === "phoenix-ws-all-mids") continue;
          if (!enabledKindsRef.current.has(kind)) continue;
          desired.add(subKey(kind, sym));
        }
      }
      return desired;
    };

    /**
     * Bring the live subscription set in sync with `computeDesired()`.
     * Sends subscribes for newly-desired (kind, symbol) pairs and
     * unsubscribes for ones the user has just disabled. Phoenix
     * de-dupes subscribes server-side so we don't bother filtering
     * "already-subscribed" — but we DO bother filtering for unsubscribe
     * because the protocol expects matched pairs.
     *
     * Newly-added subscribes are staggered in three small batches so
     * the very first market data lands quickly even on cold connects
     * (the alternative — flooding 60+ subscribes into Phoenix's WS at
     * once — has been measured to delay first-data by several seconds).
     */
    const reconcile = (ws: WebSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const safeSend = (msg: object) => { try { ws.send(JSON.stringify(msg)); } catch { /* socket closed mid-burst */ } };
      const desired = computeDesired();
      const current = currentSubsRef.current;

      // Group additions by stagger phase. allMids + market first
      // (visible by default), funding next, then any high-volume kinds.
      const phaseA: string[] = []; // market + allMids
      const phaseB: string[] = []; // funding
      const phaseC: string[] = []; // orderbook + trades + candles
      for (const key of desired) {
        if (current.has(key)) continue;
        if (key === "phoenix-ws-all-mids" || key.startsWith("phoenix-ws-market::")) phaseA.push(key);
        else if (key.startsWith("phoenix-ws-funding::")) phaseB.push(key);
        else phaseC.push(key);
      }

      const sendSubscribe = (key: string) => {
        const [kind, symbol] = key.includes("::") ? key.split("::") as [SourceKind, string] : [key as SourceKind, undefined];
        const chan = phoenixChannelFor(kind);
        if (!chan) return;
        ensureSource(kind, symbol);
        const sub: Record<string, unknown> = { channel: chan.channel };
        if (chan.needsSymbol && symbol) sub.symbol = symbol;
        if (chan.timeframe) sub.timeframe = chan.timeframe;
        safeSend({ type: "subscribe", subscription: sub });
        current.add(key);
      };

      for (const k of phaseA) sendSubscribe(k);
      if (phaseB.length > 0) {
        setTimeout(() => { if (ws.readyState === WebSocket.OPEN) for (const k of phaseB) sendSubscribe(k); }, 250);
      }
      if (phaseC.length > 0) {
        setTimeout(() => { if (ws.readyState === WebSocket.OPEN) for (const k of phaseC) sendSubscribe(k); }, 500);
      }

      // Unsubscribes — send immediately, no need to stagger.
      for (const key of Array.from(current)) {
        if (desired.has(key)) continue;
        const [kind, symbol] = key.includes("::") ? key.split("::") as [SourceKind, string] : [key as SourceKind, undefined];
        const chan = phoenixChannelFor(kind);
        if (!chan) { current.delete(key); continue; }
        const sub: Record<string, unknown> = { channel: chan.channel };
        if (chan.needsSymbol && symbol) sub.symbol = symbol;
        if (chan.timeframe) sub.timeframe = chan.timeframe;
        safeSend({ type: "unsubscribe", subscription: sub });
        current.delete(key);
      }
    };
    // Used by the WS event handler below and (via reconcileRef) by the
    // effect that watches enabledKinds / symbols.
    reconcileRef.current = reconcile;

    const scheduleReconnect = (errorMessage?: string) => {
      if (cancelled) return;
      attempts += 1;
      phoenixStateRef.current = {
        ...phoenixStateRef.current,
        state: "reconnecting",
        reconnects: phoenixStateRef.current.reconnects + 1,
        connectedAtMs: null,
        lastErrorMessage: errorMessage ?? phoenixStateRef.current.lastErrorMessage,
      };
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(8, attempts));
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, backoff);
    };

    const connect = () => {
      if (cancelled) return;
      phoenixStateRef.current = {
        ...phoenixStateRef.current,
        state: "connecting",
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(PHOENIX_WS_URL);
      } catch (err) {
        scheduleReconnect(`new WebSocket() threw: ${String(err)}`);
        return;
      }
      phoenixWsRef.current = ws;

      // Connect-timeout guard — surfaces silent CSP/network blocks that
      // never fire onopen or onclose.
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          phoenixStateRef.current = {
            ...phoenixStateRef.current,
            state: "error",
            lastErrorMessage: `WebSocket stuck in CONNECTING for ${CONNECT_TIMEOUT_MS / 1000}s — likely blocked by CSP, firewall, or network. Check the page's Content-Security-Policy connect-src directive.`,
          };
          try { ws.close(); } catch { /* ignore */ }
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch {} return; }
        if (connectTimer) clearTimeout(connectTimer);
        attempts = 0;
        phoenixStateRef.current = {
          ...phoenixStateRef.current,
          state: "connected",
          connectedAtMs: performance.now(),
          lastErrorMessage: null,
        };
        // A reconnected WS starts with zero server-side subscriptions —
        // forget what we thought we had and reconcile from scratch.
        currentSubsRef.current.clear();
        reconcile(ws);
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(typeof event.data === "string" ? event.data : "");
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        switch (msg.channel) {
          case "market":
            if (typeof msg.symbol === "string") {
              ensureSource("phoenix-ws-market", msg.symbol);
              recordEvent(sourceId("phoenix-ws-market", msg.symbol), msg);
              phoenixStateRef.current.totalUpdates += 1;
            }
            break;
          case "allMids":
            ensureSource("phoenix-ws-all-mids");
            recordEvent(sourceId("phoenix-ws-all-mids"), msg);
            phoenixStateRef.current.totalUpdates += 1;
            break;
          case "fundingRate":
            if (typeof msg.symbol === "string") {
              ensureSource("phoenix-ws-funding", msg.symbol);
              recordEvent(sourceId("phoenix-ws-funding", msg.symbol), msg);
              phoenixStateRef.current.totalUpdates += 1;
            }
            break;
          case "orderbook":
            if (typeof msg.symbol === "string") {
              ensureSource("phoenix-ws-orderbook", msg.symbol);
              recordEvent(sourceId("phoenix-ws-orderbook", msg.symbol), msg);
              phoenixStateRef.current.totalUpdates += 1;
            }
            break;
          case "trades":
            if (typeof msg.symbol === "string") {
              ensureSource("phoenix-ws-trades", msg.symbol);
              recordEvent(sourceId("phoenix-ws-trades", msg.symbol), msg);
              phoenixStateRef.current.totalUpdates += 1;
            }
            break;
          case "candle":
          case "candles":
            if (typeof msg.symbol === "string") {
              ensureSource("phoenix-ws-candles", msg.symbol);
              recordEvent(sourceId("phoenix-ws-candles", msg.symbol), msg);
              phoenixStateRef.current.totalUpdates += 1;
            }
            break;
          // subscriptionConfirmed / subscriptionError / error fall through.
        }
      };

      ws.onerror = (event) => {
        phoenixStateRef.current = {
          ...phoenixStateRef.current,
          lastErrorMessage: `WebSocket error event (browser DevTools console has details). url=${PHOENIX_WS_URL}`,
        };
        void event;
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        if (connectTimer) clearTimeout(connectTimer);
        const code = event?.code;
        const reason = event?.reason ? `: ${event.reason}` : "";
        scheduleReconnect(`WebSocket closed (code=${code}${reason})`);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (connectTimer) clearTimeout(connectTimer);
      try { phoenixWsRef.current?.close(); } catch {}
    };
  }, [ensureSource, recordEvent]);

  // ── Re-reconcile subscriptions when the symbol list or the user's
  //    enabled-kinds set changes. The reconciler diffs desired vs
  //    current and sends only the deltas, so toggling a chip OFF sends
  //    unsubscribes (freeing wire bandwidth) while toggling ON sends
  //    only the newly-needed subscribes.
  useEffect(() => {
    const ws = phoenixWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    reconcileRef.current?.(ws);
  }, [symbols, enabledPhoenixKinds]);

  // ── Pyth Hermes SSE stream.
  //
  // Originally aimed at MagicBlock's on-chain Pyth Lazer feeds — but
  // empirical check showed the magicblock-labs/real-time-pricing-oracle
  // program (PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd) is deployed
  // on mainnet with ZERO price-feed accounts under it. So we go to
  // Pyth's own Hermes endpoint directly — same upstream signal,
  // simpler architecture (HTTPS SSE instead of Solana WS + on-chain
  // account decoding), and the data is actually live.
  //
  // EventSource reconnects automatically on transient drops; the
  // browser handles `retry:` directives Hermes sends. We just track
  // open/close for diagnostics + clean up on unmount.
  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const coverage = pythCoveredPhoenixSymbols();
    if (coverage.length === 0) return;

    // feedId (lowercase hex) → Phoenix symbol — for the reverse lookup
    // when Hermes pushes a batched update.
    const idToSymbol = new Map<string, string>();
    const idsToRequest: string[] = [];
    for (const symbol of coverage) {
      const id = PYTH_FEED_IDS[symbol];
      if (!id) continue;
      ensureSource("pyth-hermes", symbol);
      idToSymbol.set(id.toLowerCase(), symbol);
      idsToRequest.push(id);
    }
    if (idsToRequest.length === 0) return;

    const connect = () => {
      if (cancelled) return;
      const url = buildHermesStreamUrl(idsToRequest);
      try {
        es = new EventSource(url);
      } catch (err) {
        scheduleRetry(`EventSource threw: ${String(err)}`);
        return;
      }
      es.onopen = () => {
        if (cancelled) { try { es?.close(); } catch {} return; }
        attempts = 0;
      };
      es.onmessage = (event) => {
        const updates = parseHermesEvent(event.data);
        for (const u of updates) {
          const symbol = idToSymbol.get(u.id);
          if (!symbol) continue;
          recordEvent(sourceId("pyth-hermes", symbol), {
            channel: "pyth-hermes",
            symbol,
            price: u.price,
            publishTime: u.publishTime,
            feedId: u.id,
          });
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; if it stays in CLOSED for too
        // long, we'll do an explicit retry on top.
        if (es?.readyState === EventSource.CLOSED) {
          for (const sym of idToSymbol.values()) {
            recordError(sourceId("pyth-hermes", sym), "Hermes SSE closed");
          }
          scheduleRetry("readyState=CLOSED");
        }
      };
    };

    const scheduleRetry = (reason: string) => {
      void reason;
      if (cancelled) return;
      attempts += 1;
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(8, attempts));
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        try { es?.close(); } catch {}
        connect();
      }, backoff);
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { es?.close(); } catch {}
    };
  }, [ensureSource, recordEvent, recordError]);

  // ── REST pollers for ember backend health endpoints.
  useEffect(() => {
    const pollers: Array<{ kind: SourceKind; url: string; intervalMs: number }> = [
      { kind: "ember-rest-markets",       url: `${EMBER_REST_URL}/api/markets`,    intervalMs: 30_000 },
      { kind: "ember-rest-health-memory", url: `${EMBER_REST_URL}/health/memory`,  intervalMs: 30_000 },
      { kind: "ember-rest-health-relay",  url: `${EMBER_REST_URL}/health/relay`,   intervalMs: 30_000 },
      { kind: "ember-rest-health-ws",     url: `${EMBER_REST_URL}/health/ws`,      intervalMs: 30_000 },
    ];
    const timers: Array<ReturnType<typeof setInterval>> = [];
    for (const p of pollers) {
      ensureSource(p.kind);
      const id = sourceId(p.kind);
      const poll = async () => {
        if (pausedRef.current) return;
        try {
          const res = await fetch(p.url);
          const json = await res.json().catch(() => null);
          if (!res.ok) {
            recordError(id, `HTTP ${res.status}`);
            return;
          }
          recordEvent(id, json);
        } catch (e: any) {
          recordError(id, e?.message ?? String(e));
        }
      };
      poll();
      timers.push(setInterval(poll, p.intervalMs));
    }
    return () => {
      for (const t of timers) clearInterval(t);
    };
  }, [ensureSource, recordEvent, recordError]);

  // ── Periodic aggregate flush — refs → React state for paint.
  useEffect(() => {
    const flush = () => {
      const nowMs = performance.now();
      const tsLog = recentMsgTimestampsRef.current;
      const cutoff = nowMs - 60_000;
      while (tsLog.length > 0 && tsLog[0] < cutoff) tsLog.shift();
      const msgsPerSec60s = tsLog.length / 60;

      const sources: Record<string, DataSource> = {};
      const cat: ObservabilitySnapshot["categoryHealth"] = {
        "phoenix-ws": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
        "phoenix-rest": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
        "ember-ws": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
        "ember-rest": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
        "external-oracle": { healthy: 0, degraded: 0, stale: 0, error: 0, idle: 0, total: 0 },
      };
      for (const [id, raw] of sourcesRef.current.entries()) {
        const sorted = [...raw.arrivals].sort((a, b) => a - b);
        const p50 = pickPercentile(sorted, 0.5);
        const p95 = pickPercentile(sorted, 0.95);
        const p99 = pickPercentile(sorted, 0.99);
        const max = sorted.length ? sorted[sorted.length - 1] : null;
        const ageSec = raw.lastUpdateAtMs != null ? (nowMs - raw.lastUpdateAtMs) / 1000 : null;
        const status = classifyHealth(
          raw.lastUpdateAtMs,
          nowMs,
          p95,
          raw.count,
          raw.errorCount,
          raw.recentPayloads.length > 0,
          raw.descriptor.expectedCadenceMs,
        );
        const stats: SourceStats = {
          count: raw.count,
          count60s: raw.arrivals.length,
          rate60s: raw.arrivals.length / 60,
          lastUpdateAtMs: raw.lastUpdateAtMs,
          ageSec,
          p50Ms: p50,
          p95Ms: p95,
          p99Ms: p99,
          maxMs: max,
          // Expose the last ~60 samples (newest last) so the detail tray
          // can show what's feeding the percentiles.
          recentArrivals: raw.arrivals.slice(-60),
          errorCount: raw.errorCount,
          lastErrorAtMs: raw.lastErrorAtMs,
          lastErrorMessage: raw.lastErrorMessage,
        };
        sources[id] = {
          ...raw.descriptor,
          stats,
          status,
          latestPayload: raw.latestPayload,
          recentPayloads: raw.recentPayloads,
        };
        const c = cat[raw.descriptor.category];
        c.total += 1;
        c[status] = (c[status] ?? 0) + 1;
      }

      const phoenix = phoenixStateRef.current;
      const uptimeSec = phoenix.connectedAtMs != null ? (nowMs - phoenix.connectedAtMs) / 1000 : 0;

      setSnapshot({
        sources,
        categoryHealth: cat,
        phoenixWs: { ...phoenix },
        emberWs: { ...emberStateRef.current },
        global: {
          paused: pausedRef.current,
          totalMessages: phoenix.totalUpdates + emberStateRef.current.totalUpdates,
          msgsPerSec60s,
          uptimeSec,
        },
      });
    };

    const id = setInterval(flush, TICK_MS);
    flush();
    return () => clearInterval(id);
  }, []);

  // ── Persistence.
  useEffect(() => {
    const prefs = loadPreferences();
    const id = setInterval(() => {
      // Snapshot the registry to plain objects for save. High-volume
      // kinds (orderbook, trades) are excluded so 3MB localStorage
      // budget doesn't blow up — full L2 books are too big to persist
      // and stats survive across reloads in-memory either way.
      const sources: Record<string, DataSource> = {};
      for (const [k, raw] of sourcesRef.current.entries()) {
        if (NO_PERSIST_KINDS.has(raw.descriptor.kind)) continue;
        sources[k] = {
          ...raw.descriptor,
          stats: {
            count: raw.count,
            count60s: raw.arrivals.length,
            rate60s: raw.arrivals.length / 60,
            lastUpdateAtMs: raw.lastUpdateAtMs,
            ageSec: null,
            p50Ms: null,
            p95Ms: null,
            p99Ms: null,
            maxMs: null,
            recentArrivals: [],
            errorCount: raw.errorCount,
            lastErrorAtMs: raw.lastErrorAtMs,
            lastErrorMessage: raw.lastErrorMessage,
          },
          status: "idle",
          latestPayload: raw.latestPayload,
          recentPayloads: raw.recentPayloads,
        };
      }
      savePersisted(sources, prefs);
    }, PERSIST_MS);
    return () => clearInterval(id);
  }, []);

  const resetAll = useCallback(() => {
    for (const s of sourcesRef.current.values()) {
      s.count = 0;
      s.errorCount = 0;
      s.arrivals = [];
      s.recentPayloads = [];
      s.lastErrorAtMs = null;
      s.lastErrorMessage = null;
    }
    recentMsgTimestampsRef.current = [];
    phoenixStateRef.current = { ...phoenixStateRef.current, totalUpdates: 0, reconnects: 0 };
    emberStateRef.current = { ...emberStateRef.current, totalUpdates: 0, reconnects: 0 };
  }, []);

  const sourcesById = snapshot.sources;
  const allSources = useMemo(() => Object.values(sourcesById).sort((a, b) => a.id.localeCompare(b.id)), [sourcesById]);

  return { snapshot, sources: allSources, resetAll };
}
