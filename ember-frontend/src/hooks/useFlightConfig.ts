"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface FlightConfig {
  active: boolean;
  feeBps: number;
  builderAuthority: string | null;
  builderTraderAccount: string | null;
}

// Short-TTL cache: the config rarely changes (per backend deploy), but a TTL
// lets it self-refresh after a builder is registered / fee changed without a
// hard reload, and avoids a permanently-stale module value.
let cache: FlightConfig | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

/** Drop the cache so the next consumer refetches (call after builder ops). */
export function invalidateFlightConfig() {
  cache = null;
  cachedAt = 0;
}

/**
 * Returns the active Flight builder-fee config (or null until loaded / on
 * error). When `active` is false, no builder fee applies — callers should hide
 * any fee disclosure.
 */
export function useFlightConfig(): FlightConfig | null {
  const fresh = cache && Date.now() - cachedAt < TTL_MS ? cache : null;
  const [cfg, setCfg] = useState<FlightConfig | null>(fresh);
  useEffect(() => {
    if (fresh) return;
    let cancelled = false;
    api
      .getFlightConfig()
      .then((c) => {
        if (cancelled) return;
        cache = c;
        cachedAt = Date.now();
        setCfg(c);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fresh]);
  return cfg;
}
