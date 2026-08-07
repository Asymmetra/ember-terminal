"use client";

import { useState } from "react";
import { accountUrl, shortAddr } from "@/lib/explorer";
import { asArray, toNum } from "@/lib/normalize";
import type { LookupSnapshot } from "@/hooks/useLookupData";
import { RelativeTime } from "./RelativeTime";
import clsx from "clsx";

interface Props {
  snapshot: LookupSnapshot;
  onRefresh: () => void;
}

/**
 * Top-level summary card on /lookup. Shows:
 *   - the wallet address (with copy + Solscan link)
 *   - onboarding state (Phoenix activated? invite code used?)
 *   - quick aggregates from the trader account state (total
 *     collateral, open positions, open orders, subaccount count)
 *
 * Purpose: answer "does this wallet actually use Phoenix?" in one
 * glance before the support user dives into the activity feed.
 */
export function WalletOverviewCard({ snapshot, onRefresh }: Props) {
  const { wallet, onboarding, trader, loadedAt, errors } = snapshot;
  const accounts = trader?.accounts ?? [];
  // Phoenix may return these as { value, decimals, ui } objects rather
  // than bare numbers — toNum handles both shapes plus string values.
  const totalCollateral = accounts.reduce((s, a) => s + toNum(a.effectiveCollateral), 0);
  const totalUnrealizedPnl = accounts.reduce((s, a) => s + toNum(a.unrealizedPnl), 0);
  // positions is a list, limitOrders is an object map (asArray handles both).
  const totalPositions = accounts.reduce((s, a) => s + asArray(a.positions).length, 0);
  const totalOrders = accounts.reduce((s, a) => s + asArray(a.limitOrders).length, 0);

  // Phoenix activation signal: any on-chain account exists OR the
  // off-chain invite-system says activated. The invite check returns
  // `false` for wallets that bypassed our gate (used Phoenix's own UI
  // directly) — they're still real Phoenix users.
  const onChainActivated = accounts.length > 0;
  const inviteActivated  = onboarding?.activated ?? false;
  const activated        = onChainActivated || inviteActivated;

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex flex-wrap items-center gap-3 border-b border-ember-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <CopyableAddress value={wallet} />
          <a
            href={accountUrl(wallet)}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-ember-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors"
          >
            Solscan ↗
          </a>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[10px] text-text-secondary/40">
            refreshed <RelativeTime timestampMs={loadedAt} className="text-text-secondary/40" />
          </span>
          <button
            onClick={onRefresh}
            className="border border-ember-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-ember-border/40 sm:grid-cols-3 lg:grid-cols-6">
        <Cell
          label="Phoenix activated"
          value={activated ? "Yes" : "No"}
          tone={activated ? "green" : "red"}
          sublabel={
            errors.onboarding
              ? `err: ${errors.onboarding.slice(0, 30)}`
              : !activated
              ? "never touched Phoenix"
              : !inviteActivated
              ? "via Phoenix UI (bypassed gate)"
              : undefined
          }
        />
        <Cell
          label="Invite code"
          value={onboarding?.invite_code_used ?? "—"}
          sublabel={
            onboarding?.invite_code_used && onboarding?.whitelisted_at
              ? `activated ${formatDate(onboarding.whitelisted_at)}`
              : onChainActivated && !inviteActivated
              ? "wallet bypassed invite gate"
              : undefined
          }
        />
        <Cell
          label="Subaccounts"
          value={accounts.length.toString()}
          sublabel={subaccountTypeBreakdown(accounts)}
        />
        <Cell label="Open positions" value={totalPositions.toString()} />
        <Cell label="Open orders" value={totalOrders.toString()} />
        <Cell
          label="Total collateral"
          value={`$${totalCollateral.toFixed(2)}`}
          sublabel={`Unrealized PnL: ${totalUnrealizedPnl >= 0 ? "+" : ""}$${totalUnrealizedPnl.toFixed(2)}`}
          sublabelTone={totalUnrealizedPnl >= 0 ? "green" : "red"}
        />
      </div>

      {errors.trader && (
        <div className="border-t border-ember-red/40 bg-ember-red/10 px-4 py-2 font-mono text-[10px] text-ember-red">
          Failed to load trader state: {errors.trader}
        </div>
      )}
    </div>
  );
}

function Cell({
  label, value, sublabel, tone, sublabelTone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "green" | "red" | "muted";
  sublabelTone?: "green" | "red";
}) {
  const valueColor = tone === "green" ? "text-ember-green" : tone === "red" ? "text-ember-red" : tone === "muted" ? "text-text-secondary/50" : "text-text-primary";
  const subColor = sublabelTone === "green" ? "text-ember-green/80" : sublabelTone === "red" ? "text-ember-red/80" : "text-text-secondary/45";
  return (
    <div className="flex flex-col gap-0.5 bg-surface-l1 px-3 py-2.5">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">{label}</span>
      <span className={clsx("font-mono text-sm tabular-nums", valueColor)}>{value}</span>
      {sublabel && <span className={clsx("font-mono text-[9px] tabular-nums", subColor)}>{sublabel}</span>}
    </div>
  );
}

function CopyableAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
      }}
      className="group inline-flex items-center gap-2 border border-ember-border bg-ember-black/60 px-2 py-1 font-mono text-xs text-text-primary hover:bg-surface-l2 transition-colors"
      title="Click to copy"
    >
      <span className="tabular-nums">{shortAddr(value, 6, 6)}</span>
      <span className="text-[9px] uppercase tracking-wider text-text-secondary/40 group-hover:text-text-secondary/80">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

function subaccountTypeBreakdown(accounts: Array<{ traderSubaccountIndex: number }>): string {
  const cross = accounts.filter((a) => a.traderSubaccountIndex === 0).length;
  const iso = accounts.length - cross;
  if (accounts.length === 0) return "none";
  const parts: string[] = [];
  if (cross > 0) parts.push(`${cross} cross`);
  if (iso > 0)   parts.push(`${iso} isolated`);
  return parts.join(" · ");
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}
