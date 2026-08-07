"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { WalletButton } from "@/components/shared/WalletButton";
import { PageNav } from "@/components/shared/PageNav";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { HeadlineTiles } from "@/components/profile/HeadlineTiles";
import { ScoreCard } from "@/components/profile/ScoreCard";
import { ComparePanel } from "@/components/profile/ComparePanel";
import { EquityChart } from "@/components/profile/EquityChart";
import { WindowStats } from "@/components/profile/WindowStats";
import { BenchmarkPanel } from "@/components/profile/BenchmarkPanel";
import { PnlDistribution } from "@/components/profile/PnlDistribution";
import { PnlCalendar } from "@/components/profile/PnlCalendar";
import { MarketBreakdownGrid } from "@/components/profile/MarketBreakdownGrid";
import { ActivityByHour } from "@/components/profile/ActivityByHour";
import { OpenPositions } from "@/components/profile/OpenPositions";
import { HistoryTabs } from "@/components/profile/HistoryTabs";
import { BuilderPanel } from "@/components/profile/BuilderPanel";
import { ProfileDetailPanel } from "@/components/profile/ProfileDetailPanel";
import clsx from "clsx";
import { useTraderProfile } from "@/hooks/useTraderProfile";
import { widestWindowWithData, type Period } from "@/lib/tradeStats";

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-ember-black">
          <span className="font-mono text-[10px] text-text-secondary/40 animate-pulse">Loading…</span>
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}

function ProfileContent() {
  const { publicKey } = useWallet();
  const params = useSearchParams();
  const traderParam = params.get("trader");
  const authority = traderParam || publicKey?.toBase58() || null;
  const viewingOther = !!traderParam && traderParam !== publicKey?.toBase58();

  const [period, setPeriod] = useState<Period>("7d");
  const [periodTouched, setPeriodTouched] = useState(false);
  const [compareAddr, setCompareAddr] = useState<string | null>(null);
  const [compareLabel, setCompareLabel] = useState<string | null>(null);

  // Tab is derived from the URL path (/profile, /profile/builder) so it's
  // deep-linkable. Navigation preserves the ?trader query so a shared link
  // like /profile/builder?trader=<pubkey> lands on the right tab + wallet.
  const router = useRouter();
  const routeParams = useParams();
  const tabSeg = Array.isArray(routeParams.tab) ? routeParams.tab[0] : undefined;
  const tab = tabSeg === "builder" ? "builder" : "dashboard";
  const setTab = (t: "dashboard" | "builder") => {
    const qs = traderParam ? `?trader=${traderParam}` : "";
    router.push(`${t === "builder" ? "/profile/builder" : "/profile"}${qs}`, { scroll: false });
  };

  const main = useTraderProfile(authority);
  const cmp = useTraderProfile(compareAddr);

  // Smart-default: once the full trade set lands, snap the window to the
  // narrowest one that actually contains trades (unless the user picked one).
  useEffect(() => {
    if (periodTouched || main.loading || main.trades.length === 0) return;
    setPeriod(widestWindowWithData(main.trades));
  }, [main.trades, main.loading, periodTouched]);

  // New trader from the URL resets the manual override + comparison.
  useEffect(() => {
    setPeriodTouched(false);
    setCompareAddr(null);
    setCompareLabel(null);
  }, [authority]);

  const equityBase = useMemo(
    () => (main.metrics ? Math.max(main.metrics.equity, main.metrics.netDeposits, 1) : 1),
    [main.metrics],
  );

  if (!authority) return <DisconnectedState />;

  return (
    <div className="min-h-screen bg-ember-black pb-16">
      <PageNav currentPath="/profile" pageLabel="Profile" />

      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 pt-4">
        <ProfileHeader
          authority={authority}
          viewingOther={viewingOther}
          period={period}
          onPeriodChange={(p) => { setPeriod(p); setPeriodTouched(true); }}
          compareAddr={compareAddr}
          compareLabel={compareLabel}
          onCompareChange={(addr, label) => { setCompareAddr(addr); setCompareLabel(label); }}
        />

        <div className="flex items-center gap-1 border-b border-ember-border/60">
          {(["dashboard", "builder"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                tab === t ? "border-b border-ember-orange text-ember-orange" : "text-text-secondary/60 hover:text-text-secondary",
              )}
            >
              {t === "dashboard" ? "Dashboard" : "Builder code"}
            </button>
          ))}
        </div>

        {tab === "builder" ? (
          <BuilderPanel authority={authority} />
        ) : main.notFound ? (
          <NoAccountState viewingOther={viewingOther} />
        ) : main.error ? (
          <div className="border border-ember-red/40 bg-ember-red/10 px-4 py-6 font-mono text-[11px] text-ember-red">
            {main.error}
          </div>
        ) : (
          <>
            <HeadlineTiles metrics={main.metrics} loading={main.loading} />

            <ScoreCard
              metrics={main.metrics}
              loading={main.loading}
              compareMetrics={compareAddr ? cmp.metrics : null}
              compareLabel={compareLabel ?? undefined}
            />

            {compareAddr && (
              <ComparePanel
                label={compareLabel ?? "them"}
                you={main.metrics}
                them={cmp.metrics}
                loading={cmp.loading}
                onClear={() => { setCompareAddr(null); setCompareLabel(null); }}
              />
            )}

            <EquityChart trades={main.trades} period={period} loading={main.loading} />

            <WindowStats trades={main.trades} period={period} loading={main.loading} />

            <BenchmarkPanel dailyPnl={main.dailyPnl} equityBase={equityBase} period={period} loading={main.loading} />

            <PnlCalendar dailyPnl={main.dailyPnl} loading={main.loading} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PnlDistribution trades={main.trades} loading={main.loading} />
              <ActivityByHour trades={main.trades} metrics={main.metrics} loading={main.loading} />
            </div>

            <MarketBreakdownGrid trades={main.trades} period={period} loading={main.loading} />

            <OpenPositions authority={authority} />

            <HistoryTabs authority={authority} />
          </>
        )}
      </div>

      <ProfileDetailPanel />
    </div>
  );
}

function NoAccountState({ viewingOther }: { viewingOther: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-ember-border/60 bg-surface-l1/40 px-4 py-16 text-center">
      <span className="font-mono text-sm uppercase tracking-wider text-text-primary">
        No Phoenix trading account
      </span>
      <p className="max-w-md font-mono text-[11px] leading-relaxed text-text-secondary/60">
        {viewingOther
          ? "This wallet has never traded on Phoenix — there's no account, position, or trade history to show. Double-check the address."
          : "This wallet hasn't traded on Phoenix yet. Once you place your first trade, your performance dashboard will populate here."}
      </p>
      <Link
        href="/lookup"
        className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ember-orange/80 transition-colors hover:text-ember-orange"
      >
        Inspect any wallet in Lookup →
      </Link>
    </div>
  );
}

/**
 * Not connected (and no ?trader=). Keep the full page chrome — nav + container
 * — and show an integrated connect prompt in the content area so it feels like
 * the profile page in a signed-out state, not a separate jarring screen.
 */
function DisconnectedState() {
  return (
    <div className="min-h-screen bg-ember-black pb-16">
      <PageNav currentPath="/profile" pageLabel="Profile" />
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 pt-4">
        <div className="flex flex-col items-center gap-5 border border-dashed border-ember-border/60 bg-surface-l1/40 px-4 py-20 text-center">
          <span className="font-mono text-sm uppercase tracking-wider text-text-primary">
            Your trading profile
          </span>
          <p className="max-w-md font-mono text-[11px] leading-relaxed text-text-secondary/60">
            Connect your wallet to see your Phoenix performance — equity, PnL, open positions, and
            your builder code.
          </p>
          <WalletButton />
          <p className="font-mono text-[10px] leading-relaxed text-text-secondary/45">
            Or inspect any wallet in{" "}
            <Link href="/lookup" className="text-ember-orange/80 hover:text-ember-orange">Lookup</Link>
            {" "}· pass <span className="text-ember-orange/70">?trader=&lt;pubkey&gt;</span> to view someone else&apos;s.
          </p>
        </div>
      </div>
    </div>
  );
}
