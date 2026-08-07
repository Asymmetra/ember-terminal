"use client";

import { useMemo, useState } from "react";
import { useTraderStore } from "@/stores/traderStore";
import { useStatsStore } from "@/stores/statsStore";
import { DepositWithdraw } from "@/components/terminal/DepositWithdraw";
import { getLivePositionPnl } from "@/hooks/useLivePositionPnl";
import { formatUsd } from "@/lib/format";
import clsx from "clsx";

export function PortfolioSummaryBar() {
  const connected = useTraderStore((s) => s.connected);
  const fetchingAccount = useTraderStore((s) => s.fetchingAccount);
  const noAccount = useTraderStore((s) => s.noAccount);
  // Don't stack the "no trading account" banner on top of the onboarding
  // modal — only surface it once the user has cleared the invite gate.
  const inviteActivated = useTraderStore((s) => s.inviteActivated);
  const collateral = useTraderStore((s) => s.collateral);
  const positions = useTraderStore((s) => s.positions);
  const initialMargin = useTraderStore((s) => s.initialMargin);
  const maintenanceMargin = useTraderStore((s) => s.maintenanceMargin);
  const riskState = useTraderStore((s) => s.riskState);
  const markPrices = useStatsStore((s) => s.markPrices);
  const [showDepositModal, setShowDepositModal] = useState(false);

  // Live unrealized PnL = sum of per-position mark-to-market via the shared
  // hook (single source of truth — see hooks/useLivePositionPnl.ts).
  const liveUnrealizedPnl = useMemo(
    () => positions.reduce((sum, pos) => sum + getLivePositionPnl(pos, markPrices[pos.symbol]).markToMarket, 0),
    [positions, markPrices],
  );

  // Live portfolio value = collateral + live unrealized PnL
  const livePortfolioValue = collateral + liveUnrealizedPnl;

  if (!connected) return null;

  // Show warning if wallet is connected but no Phoenix account exists.
  // Require inviteActivated === true so the banner doesn't double up with the
  // onboarding modal when we're still waiting on activation.
  if (noAccount && !fetchingAccount && inviteActivated === true) {
    return (
      <>
        <div className="flex items-center justify-center gap-2 border-b border-ember-orange/30 bg-ember-orange/10 px-3 py-1.5">
          <svg className="h-3.5 w-3.5 text-ember-orange" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 4v4M8 12h.01M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
          </svg>
          <span className="text-[10px] text-ember-orange">
            No trading account yet. Make your first deposit to activate trading.
          </span>
          <button
            onClick={() => setShowDepositModal(true)}
            className="ml-1 rounded border border-ember-orange/50 bg-ember-orange/20 px-2 py-0.5 font-mono text-[9px] text-ember-orange hover:bg-ember-orange/30 transition-colors"
          >
            Deposit
          </button>
        </div>
        {showDepositModal && <DepositWithdraw onClose={() => setShowDepositModal(false)} />}
      </>
    );
  }

  const marginUsage = collateral > 0 ? (initialMargin / collateral) * 100 : 0;
  const healthColor =
    riskState === "Healthy" || riskState === "ZeroCollateralNoPositions"
      ? "text-ember-green"
      : riskState === "BeingLiquidated"
        ? "text-ember-red"
        : "text-yellow-500";
  const healthLabel =
    riskState === "ZeroCollateralNoPositions" ? "No Positions" : riskState || "—";

  return (
    <div className="flex items-center gap-4 border-b border-ember-border/50 bg-surface-l1/50 px-3 py-1">
      <SummaryItem label="Collateral" value={formatUsd(collateral)} />
      <SummaryItem label="Portfolio" value={formatUsd(livePortfolioValue)} />
      <SummaryItem
        label="Unreal. PnL"
        value={`${liveUnrealizedPnl >= 0 ? "+" : ""}${formatUsd(liveUnrealizedPnl)}`}
        colorClass={liveUnrealizedPnl >= 0 ? "text-ember-green" : "text-ember-red"}
      />
      <SummaryItem
        label="Margin Usage"
        value={`${marginUsage.toFixed(1)}%`}
        colorClass={marginUsage > 80 ? "text-ember-red" : marginUsage > 50 ? "text-yellow-500" : "text-text-secondary"}
      />
      <SummaryItem
        label="Maint. Margin"
        value={formatUsd(maintenanceMargin)}
      />
      <SummaryItem label="Health" value={healthLabel} colorClass={healthColor} />
    </div>
  );
}

function SummaryItem({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-wider text-text-secondary/50">
        {label}
      </span>
      <span
        className={clsx(
          "font-mono text-[10px]",
          colorClass || "text-text-secondary"
        )}
      >
        {value}
      </span>
    </div>
  );
}
