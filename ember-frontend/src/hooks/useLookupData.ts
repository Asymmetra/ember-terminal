"use client";

/**
 * Aggregate data hook for the /lookup page.
 *
 * Fetches onboarding + trader + subaccounts in parallel for a given
 * wallet and exposes a normalized shape the page can consume. Polls
 * every 15s while a wallet is loaded (account state changes when the
 * user trades on Phoenix; refreshing keeps the lookup view live for
 * support staff).
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface OnboardingState {
  activated: boolean;
  invite_code_used: string | null;
  whitelisted_at: string | null;
}

export interface SubaccountRow {
  authority: string;
  traderKey: string;
  traderSubaccountIndex: number;
  traderPdaIndex: number;
  state: string;
  riskState: string;
  riskTier?: string;
  collateralBalance: number;
  effectiveCollateral: number;
  initialMargin: number;
  maintenanceMargin: number;
  unrealizedPnl: number;
  portfolioValue: number;
  accumulatedFunding: number;
  positions: Array<Record<string, unknown>>;
  limitOrders: Array<Record<string, unknown>>;
  flags: number;
  lastDepositSlot?: number;
}

interface RawTraderResponse {
  authority: string;
  accounts: SubaccountRow[];
}

export interface LookupSnapshot {
  wallet: string;
  loadedAt: number;
  onboarding: OnboardingState | null;
  trader: RawTraderResponse | null;
  errors: { onboarding?: string; trader?: string };
}

export interface LookupHookResult {
  snapshot: LookupSnapshot | null;
  loading: boolean;
  refresh: () => void;
}

const REFRESH_MS = 15_000;

export function useLookupData(wallet: string | null): LookupHookResult {
  const [snapshot, setSnapshot] = useState<LookupSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async (w: string) => {
    setLoading(true);
    const errors: LookupSnapshot["errors"] = {};
    const [onboarding, trader] = await Promise.allSettled([
      api.checkOnboardingStatus(w),
      api.getTrader(w),
    ]);
    if (onboarding.status === "rejected") errors.onboarding = String(onboarding.reason?.message ?? onboarding.reason);
    if (trader.status === "rejected") errors.trader = String(trader.reason?.message ?? trader.reason);
    setSnapshot({
      wallet: w,
      loadedAt: Date.now(),
      onboarding: onboarding.status === "fulfilled" ? (onboarding.value as OnboardingState) : null,
      trader: trader.status === "fulfilled" ? (trader.value as RawTraderResponse) : null,
      errors,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!wallet) { setSnapshot(null); return; }
    fetchAll(wallet);
    const id = setInterval(() => fetchAll(wallet), REFRESH_MS);
    return () => clearInterval(id);
  }, [wallet, fetchAll]);

  const refresh = useCallback(() => { if (wallet) fetchAll(wallet); }, [wallet, fetchAll]);

  return { snapshot, loading, refresh };
}
