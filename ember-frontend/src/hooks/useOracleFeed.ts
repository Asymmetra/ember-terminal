"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Direct-from-Phoenix oracle feed observability hook.
 *
 * Opens ONE WebSocket from the browser straight to
 * `wss://perp-api.phoenix.trade/ws` (NOT through the ember-backend relay),
 * subscribes to the per-market stats channel for every passed symbol,
 * and exposes per-symbol rolling latency stats so we can characterize
 * Phoenix's oracle stream the same way the React-Native client will see
 * it. The whole point of this hook is to be faithful to a thin-client's
 * view of Phoenix; routing through a server-side relay would mask the
 * exact reliability issues we're measuring.
 *
 * Architecture notes:
 *  - High-frequency state (per-message timestamps + last prices) lives
 *    in a `useRef` so React doesn't re-render on every server message.
 *    A 500ms tick interval recomputes aggregates and pushes them into
 *    React state for paint.
 *  - The wire protocol was extracted from the public phoenix-rise SDK
 *    (rust/types/src/ws.rs `ClientMessage` + `ServerMessage` enums and
 *    rust/types/src/market.rs `MarketStatsUpdate` serde renames).
 *    Field names are Hyperliquid-style abbreviated: markPx, oraclePx,
 *    midPx, openInterest, prevDayPx, dayNtlVlm, funding.
 *  - Reconnect: exponential backoff 500ms → 30s, reset on any
 *    successful message. Cumulative counters (totalUpdates, reconnects)
 *    survive reconnects; uptime resets to the latest connection.
 */

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type FeedHealth = "healthy" | "degraded" | "stale" | "no-data";

export interface SymbolStats {
  symbol: string;
  oraclePrice: number | null;
  markPrice: number | null;
  midPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  /** performance.now() timestamp of the last message; null if never */
  lastUpdateAtMs: number | null;
  /** Total messages received for this symbol since stream start */
  totalUpdates: number;
  /** Inter-arrival deltas in ms over the last 60s window */
  count60s: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  /** Computed at tick time from lastUpdateAtMs + p95 */
  health: FeedHealth;
  /** Seconds since last update, computed at tick time for display */
  ageSec: number | null;
}

export interface ConnectionStats {
  state: ConnectionState;
  url: string;
  connectedAtMs: number | null;
  uptimeSec: number;
  reconnects: number;
  totalUpdates: number;
  rateMsgsPerSec60s: number;
  allMidsLastUpdateAtMs: number | null;
  allMidsSlot: number | null;
}

export interface OracleFeedState {
  connection: ConnectionStats;
  bySymbol: Record<string, SymbolStats>;
}

export interface UseOracleFeedOptions {
  /** Default: wss://perp-api.phoenix.trade/ws */
  url?: string;
  /** Subscribe to allMids in parallel as a heartbeat reference (default false) */
  enableAllMids?: boolean;
}

const DEFAULT_URL = "wss://perp-api.phoenix.trade/ws";
const TICK_MS = 500;             // Aggregate-recompute cadence
const ARRIVAL_BUFFER = 256;      // Per-symbol ring of inter-arrival deltas
const RAW_LOG_LIMIT = 10_000;    // Cap raw per-message log to bound memory
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 30_000;

interface RawSymbolState {
  oraclePrice: number | null;
  markPrice: number | null;
  midPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  lastUpdateAtMs: number | null;
  totalUpdates: number;
  /** Newest-last ring buffer of inter-arrival gaps (ms) */
  arrivals: number[];
}

interface RawLogEntry {
  tMs: number;
  symbol: string;
  oraclePx: number;
  markPx: number;
  midPx: number;
}

function pickPercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function healthFromStats(lastUpdateAtMs: number | null, nowMs: number, p95: number | null): FeedHealth {
  if (lastUpdateAtMs == null) return "no-data";
  const ageMs = nowMs - lastUpdateAtMs;
  if (ageMs > 30_000) return "stale";
  if (ageMs > 5_000 || (p95 != null && p95 > 2_000)) return "degraded";
  return "healthy";
}

export function useOracleFeed(symbols: string[], options: UseOracleFeedOptions = {}) {
  const url = options.url ?? DEFAULT_URL;
  const enableAllMids = !!options.enableAllMids;

  // High-frequency state — mutated on every WS message, never directly
  // triggers React renders. The tick interval (`flushAggregates`) reads
  // these and writes summary numbers into React state.
  const rawRef = useRef<Record<string, RawSymbolState>>({});
  const totalUpdatesRef = useRef(0);
  const recentMsgTimestampsRef = useRef<number[]>([]); // for rolling msgs/sec
  const allMidsRef = useRef<{ lastUpdateAtMs: number | null; slot: number | null }>({
    lastUpdateAtMs: null,
    slot: null,
  });
  const rawLogRef = useRef<RawLogEntry[]>([]);

  // Lower-frequency UI state — updated by flushAggregates() every TICK_MS.
  const [state, setState] = useState<OracleFeedState>({
    connection: {
      state: "connecting",
      url,
      connectedAtMs: null,
      uptimeSec: 0,
      reconnects: 0,
      totalUpdates: 0,
      rateMsgsPerSec60s: 0,
      allMidsLastUpdateAtMs: null,
      allMidsSlot: null,
    },
    bySymbol: {},
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionStateRef = useRef<ConnectionState>("connecting");
  const connectedAtRef = useRef<number | null>(null);
  const reconnectCountRef = useRef(0);
  // Snapshot of options for the WS handler closures so we can rebuild the
  // subscribe set on reconnect.
  const subscribeListRef = useRef<{ symbols: string[]; enableAllMids: boolean }>({
    symbols,
    enableAllMids,
  });
  subscribeListRef.current = { symbols, enableAllMids };

  // Initialize per-symbol raw state for any new symbol so the table can
  // render placeholder rows immediately.
  for (const s of symbols) {
    if (!rawRef.current[s]) {
      rawRef.current[s] = {
        oraclePrice: null,
        markPrice: null,
        midPrice: null,
        fundingRate: null,
        openInterest: null,
        lastUpdateAtMs: null,
        totalUpdates: 0,
        arrivals: [],
      };
    }
  }

  const sendSubscribes = useCallback((ws: WebSocket) => {
    const { symbols: syms, enableAllMids: mids } = subscribeListRef.current;
    for (const sym of syms) {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          subscription: { channel: "market", symbol: sym },
        }),
      );
    }
    if (mids) {
      ws.send(JSON.stringify({ type: "subscribe", subscription: { channel: "allMids" } }));
    }
  }, []);

  const handleMessage = useCallback((evt: MessageEvent) => {
    const nowMs = performance.now();
    let msg: any;
    try {
      msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
    } catch {
      return;
    }

    // Phoenix may send subscription-confirmation messages prefixed with
    // `type: "subscriptionConfirmed"` etc. — we ignore those silently.
    if (typeof msg !== "object" || msg == null) return;

    if (msg.channel === "market" && typeof msg.symbol === "string") {
      const sym = msg.symbol;
      const raw = rawRef.current[sym] ?? {
        oraclePrice: null,
        markPrice: null,
        midPrice: null,
        fundingRate: null,
        openInterest: null,
        lastUpdateAtMs: null,
        totalUpdates: 0,
        arrivals: [],
      };

      if (raw.lastUpdateAtMs != null) {
        const delta = nowMs - raw.lastUpdateAtMs;
        raw.arrivals.push(delta);
        if (raw.arrivals.length > ARRIVAL_BUFFER) raw.arrivals.shift();
      }
      raw.lastUpdateAtMs = nowMs;
      raw.totalUpdates += 1;
      // Phoenix wire fields are Hyperliquid-style abbreviated.
      raw.oraclePrice = typeof msg.oraclePx === "number" ? msg.oraclePx : raw.oraclePrice;
      raw.markPrice = typeof msg.markPx === "number" ? msg.markPx : raw.markPrice;
      raw.midPrice = typeof msg.midPx === "number" ? msg.midPx : raw.midPrice;
      raw.fundingRate = typeof msg.funding === "number" ? msg.funding : raw.fundingRate;
      raw.openInterest = typeof msg.openInterest === "number" ? msg.openInterest : raw.openInterest;
      rawRef.current[sym] = raw;

      // Append to raw log for CSV export. Capped.
      const log = rawLogRef.current;
      log.push({
        tMs: nowMs,
        symbol: sym,
        oraclePx: raw.oraclePrice ?? 0,
        markPx: raw.markPrice ?? 0,
        midPx: raw.midPrice ?? 0,
      });
      if (log.length > RAW_LOG_LIMIT) log.splice(0, log.length - RAW_LOG_LIMIT);

      totalUpdatesRef.current += 1;
      recentMsgTimestampsRef.current.push(nowMs);
    } else if (msg.channel === "allMids" && typeof msg.mids === "object") {
      allMidsRef.current = {
        lastUpdateAtMs: nowMs,
        slot: typeof msg.slot === "number" ? msg.slot : allMidsRef.current.slot,
      };
      totalUpdatesRef.current += 1;
      recentMsgTimestampsRef.current.push(nowMs);
    }
    // Other channels: ignored. Phoenix may push `error` /
    // `subscriptionConfirmed` / `subscriptionError` — we silently drop.
  }, []);

  // Connection lifecycle — one effect that owns the WS for the page's
  // lifetime. Rebuilds the socket on reconnect; the subscription set is
  // resent from a ref so reconnects honor the latest enableAllMids flag.
  useEffect(() => {
    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const backoff = Math.min(
        BACKOFF_MAX_MS,
        BACKOFF_MIN_MS * 2 ** Math.min(8, reconnectAttemptsRef.current),
      );
      reconnectAttemptsRef.current += 1;
      reconnectCountRef.current += 1;
      connectionStateRef.current = "reconnecting";
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, backoff);
    };

    const connect = () => {
      if (cancelled) return;
      connectionStateRef.current = "connecting";
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled) {
          try { ws.close(); } catch {}
          return;
        }
        reconnectAttemptsRef.current = 0;
        connectedAtRef.current = performance.now();
        connectionStateRef.current = "connected";
        sendSubscribes(ws);
      };
      ws.onmessage = handleMessage;
      ws.onerror = () => {
        // Don't surface — onclose will fire next and trigger reconnect.
      };
      ws.onclose = () => {
        if (cancelled) return;
        connectionStateRef.current = "disconnected";
        connectedAtRef.current = null;
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
    // Intentionally exclude `symbols`/`enableAllMids` from deps — they
    // are read from subscribeListRef each connect so toggling them
    // re-sends subscriptions on the next reconnect rather than tearing
    // down a healthy WS. To force a fresh subscription set, call
    // resubscribe() (returned from the hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, sendSubscribes, handleMessage]);

  // Imperative resubscribe (used when toggles flip on-the-fly).
  const resubscribe = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    sendSubscribes(ws);
  }, [sendSubscribes]);

  // Periodic aggregate flush — copies ref state into React state for paint.
  useEffect(() => {
    const tick = () => {
      const nowMs = performance.now();
      // Trim recent-message log to the 60s window
      const tsLog = recentMsgTimestampsRef.current;
      const cutoff = nowMs - 60_000;
      while (tsLog.length > 0 && tsLog[0] < cutoff) tsLog.shift();
      const rateMsgsPerSec60s = tsLog.length / 60;

      const bySymbol: Record<string, SymbolStats> = {};
      for (const sym of Object.keys(rawRef.current)) {
        const raw = rawRef.current[sym];
        const sorted = [...raw.arrivals].sort((a, b) => a - b);
        // Count inter-arrivals whose timestamps fall in the last 60s by
        // approximating: take samples whose cumulative-from-now estimate
        // is within 60s. Simpler proxy: count of arrivals in the buffer
        // capped at 60 (≈ at the typical cadence). Use totalUpdates window
        // instead for precision:
        const lastIdxIn60s = raw.lastUpdateAtMs != null && nowMs - raw.lastUpdateAtMs <= 60_000
          ? sorted.length
          : 0;
        bySymbol[sym] = {
          symbol: sym,
          oraclePrice: raw.oraclePrice,
          markPrice: raw.markPrice,
          midPrice: raw.midPrice,
          fundingRate: raw.fundingRate,
          openInterest: raw.openInterest,
          lastUpdateAtMs: raw.lastUpdateAtMs,
          totalUpdates: raw.totalUpdates,
          count60s: lastIdxIn60s,
          p50Ms: pickPercentile(sorted, 0.5),
          p95Ms: pickPercentile(sorted, 0.95),
          p99Ms: pickPercentile(sorted, 0.99),
          maxMs: sorted.length ? sorted[sorted.length - 1] : null,
          health: healthFromStats(raw.lastUpdateAtMs, nowMs, pickPercentile(sorted, 0.95)),
          ageSec: raw.lastUpdateAtMs != null ? (nowMs - raw.lastUpdateAtMs) / 1000 : null,
        };
      }

      const connectedAt = connectedAtRef.current;
      const uptimeSec = connectedAt != null ? (nowMs - connectedAt) / 1000 : 0;
      const mids = allMidsRef.current;
      setState({
        connection: {
          state: connectionStateRef.current,
          url,
          connectedAtMs: connectedAt,
          uptimeSec,
          reconnects: reconnectCountRef.current,
          totalUpdates: totalUpdatesRef.current,
          rateMsgsPerSec60s,
          allMidsLastUpdateAtMs: mids.lastUpdateAtMs,
          allMidsSlot: mids.slot,
        },
        bySymbol,
      });
    };

    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [url]);

  const exportCsv = useCallback(() => {
    const log = rawLogRef.current;
    if (log.length === 0) return;
    const header = "tMs,symbol,oraclePx,markPx,midPx\n";
    const rows = log
      .map((r) => `${r.tMs.toFixed(3)},${r.symbol},${r.oraclePx},${r.markPx},${r.midPx}`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `oracle-feed-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const resetStats = useCallback(() => {
    for (const sym of Object.keys(rawRef.current)) {
      const raw = rawRef.current[sym];
      raw.arrivals = [];
      raw.totalUpdates = 0;
    }
    totalUpdatesRef.current = 0;
    recentMsgTimestampsRef.current = [];
    rawLogRef.current = [];
    reconnectCountRef.current = 0;
  }, []);

  return { state, exportCsv, resetStats, resubscribe };
}
