"use client";

import { useEffect, useState } from "react";
import { api, fetchAllTrades, isTraderNotFoundError } from "@/lib/api";
import {
  normalizeTrade,
  normalizePnlSeries,
  sdkNum,
  type NormalizedTrade,
  type PnlPoint,
} from "@/lib/tradeStats";
import { computeTraderMetrics, type TraderMetrics } from "@/lib/traderMetrics";

export interface TraderProfileData {
  trades: NormalizedTrade[];
  dailyPnl: PnlPoint[];
  collateral: Record<string, unknown>[];
  equity: number;
  unrealizedPnl: number;
  metrics: TraderMetrics | null;
  loading: boolean;
  error: string | null;
  /** Wallet has never had a Phoenix account (404 "User not found"). */
  notFound: boolean;
}

const EMPTY: TraderProfileData = {
  trades: [],
  dailyPnl: [],
  collateral: [],
  equity: 0,
  unrealizedPnl: 0,
  metrics: null,
  loading: false,
  error: null,
  notFound: false,
};

/**
 * One fetch for the whole profile: full trade history (cursor-paged), the
 * daily cumulative-PnL series, collateral movements, and current account
 * state — then the derived metric bundle. Shared by the viewed trader and
 * any head-to-head comparison target so both use identical methodology.
 */
export function useTraderProfile(authority: string | null): TraderProfileData {
  const [data, setData] = useState<TraderProfileData>(EMPTY);

  useEffect(() => {
    if (!authority) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, error: null }));

    Promise.allSettled([
      fetchAllTrades(authority),
      api.getTraderPnl(authority, "1d", 1000),
      api.getTraderCollateralHistory(authority, 1000),
      api.getTrader(authority),
    ]).then((results) => {
      if (cancelled) return;
      const [tradesR, pnlR, collR, stateR] = results;

      const trades: NormalizedTrade[] =
        tradesR.status === "fulfilled" ? tradesR.value.map(normalizeTrade) : [];
      const dailyPnl: PnlPoint[] =
        pnlR.status === "fulfilled" ? normalizePnlSeries((pnlR.value as any)?.data ?? []) : [];
      const collateral: Record<string, unknown>[] =
        collR.status === "fulfilled" ? ((collR.value as any)?.data ?? []) : [];

      let equity = 0;
      let unrealizedPnl = 0;
      if (stateR.status === "fulfilled") {
        const accounts: any[] = (stateR.value as any)?.accounts ?? [];
        for (const a of accounts) {
          equity += sdkNum(a.portfolioValue);
          unrealizedPnl += sdkNum(a.unrealizedPnl);
        }
      }

      // No Phoenix account at all: the trades endpoint 404s "User not found"
      // and nothing else loaded. Treat as a clean empty state, not an error.
      const tradesNotFound = tradesR.status === "rejected" && isTraderNotFoundError(tradesR.reason);
      const hasData = trades.length > 0 || dailyPnl.length > 0 || equity !== 0;
      const notFound = tradesNotFound && !hasData;

      const error =
        !notFound && tradesR.status === "rejected" && pnlR.status === "rejected"
          ? "Failed to load trader data"
          : null;

      setData({
        trades,
        dailyPnl,
        collateral,
        equity,
        unrealizedPnl,
        metrics: computeTraderMetrics({ trades, dailyPnl, collateral, equity, unrealizedPnl }),
        loading: false,
        error,
        notFound,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [authority]);

  return data;
}
