"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { sdkNum } from "@/lib/tradeStats";
import { ESTIMATED_TAKER_FEE_RATE } from "@/lib/constants";
import { hydrateMap, makeMapPersister } from "@/lib/persistentMapCache";

/**
 * Lazy per-row enrichment for the leaderboard.
 *
 * The backend pre-enriches only the top leaders (equity / uPnL / positions) to
 * keep the refresh cheap. Everyone below that shows account value only — so as
 * the user scrolls, each visible row that lacks stats fetches its own detail
 * (the same `/api/trader` call the row-expand uses), filling the columns
 * on-demand. Results are cached for the session and requests are
 * concurrency-limited so deep scrolling doesn't burst the REST API.
 */

export interface RowEnrich {
  equityUsd: number;
  unrealizedPnlUsd: number;
  openPositions: number;
  /** Rough estimated lifetime volume (USD); undefined if the PnL fetch failed. */
  volumeUsd?: number;
}

// Persisted across reloads so a refresh reuses recent per-row stats instead of
// re-fetching every wallet one at a time. Short TTL since equity/uPnL/volume drift.
const ENRICH_LS_KEY = "ember:lb-enrich:v1";
const ENRICH_TTL_MS = 5 * 60_000;
const cache = new Map<string, RowEnrich | null>(); // null = fetched, errored/none
hydrateMap(cache, ENRICH_LS_KEY, ENRICH_TTL_MS);
const persist = makeMapPersister(cache, ENRICH_LS_KEY);
const inflight = new Set<string>();
const queue: string[] = [];
let activeCount = 0;
const MAX_CONCURRENT = 5;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function pump() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const authority = queue.shift() as string;
    if (cache.has(authority) || inflight.has(authority)) continue;
    inflight.add(authority);
    activeCount++;
    Promise.all([
      api.getTrader(authority),
      // Rough lifetime-volume proxy: coarse, full-history PnL → cumulative taker
      // fees. Best-effort; a failure just leaves volume blank for the row.
      api.getTraderPnl(authority, "1d", 400).catch(() => null),
    ])
      .then(([res, pnl]: [{ accounts?: unknown[] }, { data?: unknown[] } | null]) => {
        let equityUsd = 0;
        let unrealizedPnlUsd = 0;
        let openPositions = 0;
        for (const s of (res?.accounts ?? []) as Array<Record<string, unknown>>) {
          equityUsd += sdkNum(s.portfolioValue);
          unrealizedPnlUsd += sdkNum(s.unrealizedPnl);
          openPositions += Array.isArray(s.positions) ? s.positions.length : 0;
        }
        let volumeUsd: number | undefined;
        const points = (pnl?.data ?? []) as Array<Record<string, unknown>>;
        if (points.length > 0) {
          // cumulative_taker_fee is monotonic from inception → max = lifetime total.
          const maxFee = points.reduce((m, p) => Math.max(m, Number(p.cumulativeTakerFee) || 0), 0);
          volumeUsd = maxFee > 0 ? maxFee / ESTIMATED_TAKER_FEE_RATE : 0;
        }
        cache.set(authority, { equityUsd, unrealizedPnlUsd, openPositions, volumeUsd });
      })
      .catch(() => cache.set(authority, null))
      .finally(() => {
        inflight.delete(authority);
        activeCount--;
        persist();
        notify();
        pump();
      });
  }
}

/** Queue a wallet for enrichment (no-op if already cached / in-flight / queued). */
export function requestEnrich(authority: string) {
  if (cache.has(authority) || inflight.has(authority) || queue.includes(authority)) return;
  queue.push(authority);
  pump();
}

/** Synchronous peek at a wallet's enriched stats (`undefined` if not fetched). */
export function getEnrich(authority: string): RowEnrich | null | undefined {
  return cache.get(authority);
}

/** Bumps whenever new enrichment lands, so consumers re-render + re-merge. */
export function useEnrichVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}
