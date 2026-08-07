"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice, formatUsd } from "@/lib/format";
import { sdkNum } from "@/lib/tradeStats";
import { useProfileDetailStore } from "@/stores/profileDetailStore";
import clsx from "clsx";

interface Props {
  authority: string;
}

interface Subaccount {
  index: number;
  isolated: boolean;
  collateral: number;
  portfolioValue: number;
  unrealizedPnl: number;
  initialMargin: number;
  maintenanceMargin: number;
  riskState: string;
  positions: Position[];
}

interface Position {
  symbol: string;
  size: number; // signed
  entry: number;
  positionValue: number;
  unrealizedPnl: number;
  liqPrice: number | null;
  initialMargin: number;
  tp: number | null;
  sl: number | null;
}

// Current open state across all subaccounts (cross + isolated). Each
// subaccount card shows collateral, margin usage bar, risk tier, then the
// positions inside it. Empty subaccounts are skipped entirely.
export function OpenPositions({ authority }: Props) {
  const [accounts, setAccounts] = useState<Subaccount[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getTrader(authority)
      .then((res: any) => {
        if (cancelled) return;
        const raw: any[] = res?.accounts ?? [];
        const mapped: Subaccount[] = raw.map((a) => ({
          index: a.traderSubaccountIndex ?? 0,
          isolated: (a.traderSubaccountIndex ?? 0) !== 0,
          collateral: sdkNum(a.effectiveCollateral),
          portfolioValue: sdkNum(a.portfolioValue),
          unrealizedPnl: sdkNum(a.unrealizedPnl),
          initialMargin: sdkNum(a.initialMargin),
          maintenanceMargin: sdkNum(a.maintenanceMargin),
          riskState: String(a.riskState ?? "unknown"),
          positions: (a.positions ?? []).map((p: any): Position => ({
            symbol: String(p.symbol ?? ""),
            size: sdkNum(p.positionSize),
            entry: sdkNum(p.entryPrice),
            positionValue: sdkNum(p.positionValue),
            unrealizedPnl: sdkNum(p.unrealizedPnl),
            liqPrice: p.liquidationPrice != null ? sdkNum(p.liquidationPrice) : null,
            initialMargin: sdkNum(p.positionInitialMargin ?? p.initialMargin),
            tp: p.takeProfitPrice != null ? sdkNum(p.takeProfitPrice) : null,
            sl: p.stopLossPrice != null ? sdkNum(p.stopLossPrice) : null,
          })),
        }));
        const nonEmpty = mapped.filter(
          (a) => a.collateral > 0 || a.portfolioValue > 0 || a.positions.length > 0
        );
        setAccounts(nonEmpty);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAccounts([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authority]);

  return (
    <div className="border border-ember-border bg-surface-l1">
      <SectionHeader title="Open state" count={accounts?.length ?? null} />
      <div className="flex flex-col gap-px">
        {loading && (
          <div className="flex items-center justify-center py-8 font-mono text-[10px] text-text-secondary/40">
            Loading…
          </div>
        )}
        {!loading && accounts && accounts.length === 0 && (
          <div className="flex items-center justify-center py-8 font-mono text-[10px] text-text-secondary/40">
            No open subaccounts.
          </div>
        )}
        {!loading &&
          accounts?.map((a) => <SubaccountCard key={a.index} account={a} />)}
      </div>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number | null }) {
  return (
    <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
        {title}
      </span>
      {count != null && (
        <span className="font-mono text-[10px] text-text-secondary/40">
          {count} {count === 1 ? "subaccount" : "subaccounts"}
        </span>
      )}
    </div>
  );
}

function SubaccountCard({ account }: { account: Subaccount }) {
  const marginUsage =
    account.collateral > 0 ? (account.initialMargin / account.collateral) * 100 : 0;
  const risky = marginUsage >= 85 || account.riskState.toLowerCase().includes("risk");
  const upnlPositive = account.unrealizedPnl >= 0;
  const openDetail = useProfileDetailStore((s) => s.openPosition);

  return (
    <div className="bg-surface-l1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ember-border/40 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
              account.isolated
                ? "border-ember-orange/40 bg-ember-orange/10 text-ember-orange"
                : "border-ember-border bg-surface-l2 text-text-secondary/60"
            )}
          >
            {account.isolated ? `iso #${account.index}` : "cross"}
          </span>
          <span className="font-mono text-[11px] text-text-primary">
            {formatUsd(account.portfolioValue)}
          </span>
          <span
            className={clsx(
              "font-mono text-[10px]",
              upnlPositive ? "text-ember-green" : "text-ember-red"
            )}
          >
            {upnlPositive ? "+" : ""}{formatUsd(account.unrealizedPnl)} uPnL
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">
              Margin
            </span>
            <div className="h-1 w-20 bg-ember-border/40">
              <div
                className={clsx("h-full", risky ? "bg-ember-red" : "bg-ember-green")}
                style={{ width: `${Math.min(marginUsage, 100)}%` }}
              />
            </div>
            <span
              className={clsx(
                "font-mono text-[10px] tabular-nums",
                risky ? "text-ember-red" : "text-text-secondary"
              )}
            >
              {marginUsage.toFixed(1)}%
            </span>
          </div>
          <RiskPill state={account.riskState} />
        </div>
      </div>

      {account.positions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-text-secondary/50">
                <th className="px-4 py-1.5 text-left font-mono font-normal uppercase tracking-wider">Symbol</th>
                <th className="px-4 py-1.5 text-left font-mono font-normal uppercase tracking-wider">Side</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Size</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Entry</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Notional</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">uPnL</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">Liq. Price</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">TP</th>
                <th className="px-4 py-1.5 text-right font-mono font-normal uppercase tracking-wider">SL</th>
              </tr>
            </thead>
            <tbody>
              {account.positions.map((p) => {
                const isLong = p.size >= 0;
                const upnl = p.unrealizedPnl;
                return (
                  <tr
                    key={`${account.index}-${p.symbol}`}
                    onClick={() =>
                      openDetail({
                        symbol: p.symbol,
                        size: p.size,
                        entry: p.entry,
                        positionValue: p.positionValue,
                        unrealizedPnl: p.unrealizedPnl,
                        liqPrice: p.liqPrice,
                        initialMargin: p.initialMargin,
                        tp: p.tp,
                        sl: p.sl,
                        subaccountIndex: account.index,
                        isolated: account.isolated,
                      })
                    }
                    className="cursor-pointer border-t border-ember-border/40 font-mono transition-colors hover:bg-surface-l2/40"
                  >
                    <td className="px-4 py-1.5 text-text-primary">{p.symbol}-PERP</td>
                    <td className={clsx("px-4 py-1.5 font-medium", isLong ? "text-ember-green" : "text-ember-red")}>
                      {isLong ? "LONG" : "SHORT"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-primary/90">
                      {Math.abs(p.size).toFixed(4)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary/70">
                      ${formatPrice(p.entry)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary/70">
                      {formatUsd(Math.abs(p.positionValue))}
                    </td>
                    <td className={clsx("px-4 py-1.5 text-right tabular-nums", upnl >= 0 ? "text-ember-green" : "text-ember-red")}>
                      {upnl >= 0 ? "+" : ""}{formatUsd(upnl)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-ember-red/80">
                      {p.liqPrice != null ? `$${formatPrice(p.liqPrice)}` : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-ember-green/80">
                      {p.tp != null ? `$${formatPrice(p.tp)}` : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-ember-red/80">
                      {p.sl != null ? `$${formatPrice(p.sl)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RiskPill({ state }: { state: string }) {
  const s = state.toLowerCase();
  const healthy = s.includes("healthy");
  const color = healthy
    ? "border-ember-green/40 bg-ember-green/10 text-ember-green"
    : "border-ember-red/40 bg-ember-red/10 text-ember-red";
  return (
    <span className={clsx("border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider", color)}>
      {state.replace(/([A-Z])/g, " $1").trim().toLowerCase()}
    </span>
  );
}
