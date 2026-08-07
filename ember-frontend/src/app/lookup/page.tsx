"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageNav } from "@/components/shared/PageNav";
import { WalletInput } from "@/components/lookup/WalletInput";
import { WalletOverviewCard } from "@/components/lookup/WalletOverviewCard";
import { SubaccountsTable } from "@/components/lookup/SubaccountsTable";
import { ActivityTimeline, type UnifiedEvent } from "@/components/lookup/ActivityTimeline";
import { EventDetailPanel } from "@/components/lookup/EventDetailPanel";
import { useLookupData } from "@/hooks/useLookupData";

/**
 * Wallet Lookup — debug-tool page that takes any Solana wallet
 * address and surfaces its complete Phoenix activity:
 *   - onboarding state (activated? invite code used?)
 *   - all subaccounts (cross + isolated), each expandable to show
 *     positions + open orders
 *   - unified activity timeline merging fills, deposits/withdraws,
 *     transfers, and funding payments — one chronological feed,
 *     each row clickable for a detail panel, each row links to
 *     Solscan
 *
 * Designed for support staff: "user gave us their wallet, what have
 * they done on Phoenix?" — one page, one input, every relevant
 * artifact one click away.
 */
export default function LookupPage() {
  // useSearchParams() requires a Suspense boundary for static
  // prerendering — wrap the actual content + bail out cleanly while
  // the route loads on the client.
  return (
    <Suspense fallback={<LookupSkeleton />}>
      <LookupContent />
    </Suspense>
  );
}

function LookupSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-ember-black text-text-primary">
      <PageNav currentPath="/lookup" pageLabel="Wallet Lookup" />
      <div className="px-4 py-6 font-mono text-[11px] text-text-secondary/40">Loading…</div>
    </div>
  );
}

function LookupContent() {
  const searchParams = useSearchParams();
  const initial = searchParams?.get("wallet") ?? "";
  const [wallet, setWallet] = useState<string | null>(initial || null);
  const [selectedEvent, setSelectedEvent] = useState<UnifiedEvent | null>(null);
  const [filterSub, setFilterSub] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { snapshot, loading, refresh } = useLookupData(wallet);

  // Keep the URL in sync with the focused wallet so the page is
  // shareable + the back button works as expected.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (wallet) url.searchParams.set("wallet", wallet);
    else url.searchParams.delete("wallet");
    window.history.replaceState({}, "", url.toString());
  }, [wallet]);

  const onSubmit = useCallback((w: string) => {
    setWallet(w);
    setSelectedEvent(null);
    setFilterSub(null);
  }, []);

  const onRefresh = useCallback(() => {
    refresh();
    setRefreshKey((k) => k + 1);
  }, [refresh]);

  return (
    <div className="flex min-h-screen flex-col bg-ember-black text-text-primary">
      <PageNav currentPath="/lookup" pageLabel="Wallet Lookup" />

      <div className="flex flex-col gap-2 px-4 pt-4">
        <h1 className="font-mono text-sm uppercase tracking-wider text-text-primary">Wallet Lookup</h1>
        <p className="max-w-4xl font-mono text-[10px] leading-relaxed text-text-secondary/60">
          Paste any Solana wallet address to inspect every Phoenix-related interaction it has had — onboarding state,
          subaccounts, open positions and orders, fills, deposits, withdraws, transfers, and funding payments.
          Designed for support / debugging: one page, every relevant artifact one click away on Solscan.
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <WalletInput initial={initial} onSubmit={onSubmit} />

        {wallet && snapshot && (
          <>
            <WalletOverviewCard snapshot={snapshot} onRefresh={onRefresh} />
            <SubaccountsTable
              accounts={snapshot.trader?.accounts ?? []}
              onFilterSubaccount={(idx) => setFilterSub(idx)}
            />
            <ActivityTimeline
              wallet={wallet}
              refreshKey={refreshKey}
              selectedEventId={selectedEvent?.id ?? null}
              onSelectEvent={(e) => setSelectedEvent(e)}
              filterSub={filterSub}
              onClearFilterSub={() => setFilterSub(null)}
            />
          </>
        )}

        {wallet && !snapshot && loading && (
          <div className="border border-ember-border bg-surface-l1 px-4 py-6 font-mono text-[11px] text-text-secondary/50">
            Loading wallet data…
          </div>
        )}

        {!wallet && (
          <div className="border border-dashed border-ember-border/60 bg-surface-l1/40 px-4 py-8 font-mono text-[11px] text-text-secondary/50">
            Paste a wallet address above to inspect its Phoenix activity.
          </div>
        )}
      </div>

      <EventDetailPanel
        event={selectedEvent}
        wallet={wallet ?? ""}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
