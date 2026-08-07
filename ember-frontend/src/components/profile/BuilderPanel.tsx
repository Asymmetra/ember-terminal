"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/api";
import { useTransactionBuilder } from "@/hooks/useTransactionBuilder";
import { useFlightConfig, invalidateFlightConfig } from "@/hooks/useFlightConfig";
import Link from "next/link";
import { formatUsd } from "@/lib/format";
import { sdkNum } from "@/lib/tradeStats";
import { shortAddr, accountUrl } from "@/lib/explorer";
import clsx from "clsx";

interface BuilderInfo {
  builderAuthority: string;
  builderTraderAccount: string;
  registered: boolean;
  feeBps: number | null;
}

interface Props {
  /** The wallet whose builder-code setup we're viewing (connected or ?trader=). */
  authority: string;
}

/**
 * Builder-codes console — works for ANY wallet (multi-tenant). Reads the
 * connected/viewed wallet's builder setup straight from chain; when you're
 * viewing your own connected wallet, lets you register, change the fee, and
 * withdraw earned fees. All txs go through the same sign/notify flow as trades.
 */
export function BuilderPanel({ authority }: Props) {
  const { publicKey } = useWallet();
  const flight = useFlightConfig();
  const { registerBuilder, updateBuilderFee, withdraw, isPending } = useTransactionBuilder();

  const [info, setInfo] = useState<BuilderInfo | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [withdrawable, setWithdrawable] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [feeInput, setFeeInput] = useState("10");
  const [withdrawInput, setWithdrawInput] = useState("");

  const isOwn = !!publicKey && publicKey.toBase58() === authority;
  const routedHere = flight?.active && flight.builderAuthority === authority;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [b, trader] = await Promise.allSettled([
      api.getFlightBuilder(authority),
      api.getTrader(authority),
    ]);
    if (b.status === "fulfilled") {
      setInfo(b.value);
      if (b.value.feeBps != null) setFeeInput(String(b.value.feeBps));
    } else {
      setError(true);
    }
    if (trader.status === "fulfilled") {
      const acct = (trader.value?.accounts ?? [])[0];
      setBalance(acct ? sdkNum(acct.collateralBalance) : 0);
      // Free collateral that can be withdrawn now (excludes margin locked by
      // open positions). This is the "claimable" figure — it includes earned
      // fees, which Phoenix commingles into collateral.
      setWithdrawable(
        acct ? sdkNum(acct.effectiveCollateralForWithdrawals ?? acct.collateralBalance) : 0
      );
    }
    setLoading(false);
  }, [authority]);

  useEffect(() => { load(); }, [load]);

  const doRegister = async () => {
    try { await registerBuilder(clampBps(feeInput)); invalidateFlightConfig(); await load(); } catch { /* toast shown */ }
  };
  const doUpdateFee = async () => {
    try { await updateBuilderFee(clampBps(feeInput)); invalidateFlightConfig(); await load(); } catch { /* toast shown */ }
  };
  const doWithdraw = async () => {
    const amt = parseFloat(withdrawInput || "0");
    if (!(amt > 0)) return;
    try { await withdraw(amt); setWithdrawInput(""); await load(); } catch { /* toast shown */ }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Status */}
      <div className="border border-ember-border bg-surface-l1">
        <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Builder code</span>
          <div className="flex items-center gap-2">
            {routedHere && (
              <span className="border border-ember-orange/40 bg-ember-orange/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ember-orange">routes here</span>
            )}
            <span className={clsx("font-mono text-[10px] uppercase tracking-wider", info?.registered ? "text-ember-green" : "text-text-secondary/50")}>
              {loading ? "…" : info?.registered ? "registered" : "not registered"}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-ember-border/40 sm:grid-cols-3">
          <Tile label="Fee" value={info?.feeBps != null ? `${(info.feeBps / 100).toFixed(2)}%` : "—"} sub={info?.feeBps != null ? `${info.feeBps} bps · on-chain` : "register to set"} loading={loading} />
          <Tile label="Fee account balance" value={balance != null ? formatUsd(balance) : "—"} sub="total collateral (fees commingled)" loading={loading}
            href={info ? accountUrl(info.builderTraderAccount) : undefined} hrefLabel={info ? shortAddr(info.builderTraderAccount, 4, 4) : undefined} />
          <Tile label="Builder authority" value={shortAddr(authority, 6, 6)} sub={isOwn ? "your wallet" : "viewing"} loading={loading} href={accountUrl(authority)} hrefLabel="Solscan ↗" />
        </div>
        {error && !loading && (
          <div className="border-t border-ember-red/30 px-4 py-2 font-mono text-[10px] text-ember-red/80">
            Couldn&apos;t read builder status from chain — retry shortly.
          </div>
        )}
      </div>

      {/* Actions (own wallet only) */}
      {isOwn ? (
        <div className="border border-ember-border bg-surface-l1">
          <div className="border-b border-ember-border/60 px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
            {info?.registered ? "Manage builder" : "Register builder"}
          </div>
          <div className="flex flex-col gap-4 px-4 py-3">
            {!info?.registered ? (
              <Row label="Register as a Flight builder to earn a fee on routed orders. Your wallet must be an activated Phoenix trader (deposited).">
                <FeeInput value={feeInput} onChange={setFeeInput} />
                <Action label="Register" onClick={doRegister} disabled={isPending} />
              </Row>
            ) : (
              <>
                <Row label="Change your builder fee (applies to all future routed orders).">
                  <FeeInput value={feeInput} onChange={setFeeInput} />
                  <Action label="Update fee" onClick={doUpdateFee} disabled={isPending} />
                </Row>
                <Row label="Claim — builder fees accrue into this account's collateral (Phoenix has no separate fee bucket), so claiming = withdrawing available collateral to your wallet.">
                  <input
                    value={withdrawInput}
                    onChange={(e) => setWithdrawInput(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="USDC"
                    className="w-24 border border-ember-border bg-ember-black px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-secondary/30 focus:border-ember-orange/50 focus:outline-none"
                  />
                  <button
                    onClick={() => withdrawable != null && setWithdrawInput(String(Math.floor(withdrawable * 100) / 100))}
                    disabled={!withdrawable}
                    className="border border-ember-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:text-ember-orange disabled:opacity-40 transition-colors"
                  >
                    Max
                  </button>
                  <Action label="Claim" onClick={doWithdraw} disabled={isPending || !(parseFloat(withdrawInput || "0") > 0)} />
                  <span className="font-mono text-[10px] text-text-secondary/50">
                    available {withdrawable != null ? formatUsd(withdrawable) : "—"}
                  </span>
                </Row>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-ember-border/60 bg-surface-l1/40 px-4 py-4 font-mono text-[11px] text-text-secondary/60">
          Connect this wallet ({shortAddr(authority, 4, 4)}) to register or manage its builder code.
        </div>
      )}

      <p className="px-1 font-mono text-[10px] leading-relaxed text-text-secondary/45">
        Builder codes (Phoenix Flight) charge a fee on the notional of orders routed through your
        builder, credited to your Phoenix trader account. The rate is a single on-chain value
        (change it anytime via update-fee). This console works for any wallet — connect yours to set
        up builder codes for your own project. See how your fee compares to every builder on Phoenix
        in the{" "}
        <Link href="/stats/builder" className="text-ember-orange/80 hover:text-ember-orange">
          Builder codes ecosystem on /stats →
        </Link>
      </p>
    </div>
  );
}

function clampBps(s: string): number {
  return Math.max(0, Math.min(10_000, parseInt(s || "0", 10) || 0));
}

function Tile({ label, value, sub, loading, href, hrefLabel }: { label: string; value: string; sub?: string; loading: boolean; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface-l1 px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums text-text-primary">{loading ? "…" : value}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-ember-orange/80 hover:text-ember-orange">{hrefLabel}</a>
      ) : sub ? (
        <span className="font-mono text-[10px] text-text-secondary/50">{sub}</span>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] leading-relaxed text-text-secondary/60">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function FeeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        className="w-20 border border-ember-border bg-ember-black px-2 py-1 font-mono text-[11px] text-text-primary focus:border-ember-orange/50 focus:outline-none"
      />
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/40">bps</span>
    </>
  );
}

function Action({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="border border-ember-orange/50 bg-ember-orange/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ember-orange hover:bg-ember-orange/20 disabled:opacity-40 transition-colors"
    >
      {label}
    </button>
  );
}
