"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/api";
import { BuilderEcosystem } from "@/components/profile/BuilderEcosystem";
import { shortAddr, accountUrl } from "@/lib/explorer";

interface BuilderInfo {
  builderAuthority: string;
  builderTraderAccount: string;
  registered: boolean;
  feeBps: number | null;
}

/**
 * Builder-codes tab on /stats — a generic explorer for Phoenix Flight builder
 * codes, useful to anyone (not an ad for this deployment's fee). It has two
 * parts:
 *
 *  1. **Your builder code** — context-specific: only when a wallet is
 *     connected do we look up whether *that* wallet has a builder code and
 *     surface its stats + a link to manage it in profile. With no wallet
 *     connected we don't prompt anyone to manage anything.
 *  2. **Flight ecosystem** — every registered builder code on Phoenix (read
 *     from chain): adoption, fee distribution, directory. Wallet-agnostic.
 */
export function BuilderCodesPanel() {
  const { publicKey } = useWallet();
  const authority = publicKey?.toBase58();
  const [info, setInfo] = useState<BuilderInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authority) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getFlightBuilder(authority)
      .then((b) => { if (!cancelled) setInfo(b); })
      .catch(() => { if (!cancelled) setInfo(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authority]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <YourBuilderCode authority={authority} info={info} loading={loading} />
      <BuilderEcosystem yourFeeBps={info?.feeBps} yourAuthority={authority} />
      <p className="px-1 font-mono text-[10px] leading-relaxed text-text-secondary/45">
        Builder codes (Phoenix Flight) let a wallet charge a fee on the notional of orders routed
        through it, credited to that wallet&apos;s Phoenix account. Rates + adoption below are read
        live from the Flight program.
      </p>
    </div>
  );
}

/**
 * The connected wallet's own builder-code status — or, with no wallet, a
 * neutral hint (no manage prompt).
 */
function YourBuilderCode({
  authority,
  info,
  loading,
}: {
  authority: string | undefined;
  info: BuilderInfo | null;
  loading: boolean;
}) {
  if (!authority) {
    return (
      <div className="border border-dashed border-ember-border/60 bg-surface-l1/40 px-4 py-3 font-mono text-[11px] text-text-secondary/55">
        Connect a wallet to check whether it has a builder code and see its setup.
      </div>
    );
  }

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
          Your builder code
        </span>
        <span className="font-mono text-[10px] text-text-secondary/50">{shortAddr(authority, 4, 4)}</span>
      </div>
      <div className="px-4 py-3 font-mono text-[11px] text-text-secondary/80">
        {loading ? (
          <span className="text-text-secondary/40">checking on-chain…</span>
        ) : info?.registered ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span>
              This wallet has a builder code charging{" "}
              <span className="text-ember-orange">{info.feeBps} bps</span>
              {info.feeBps != null && <span className="text-text-secondary/50"> ({(info.feeBps / 100).toFixed(2)}%)</span>}
              {" "}on routed orders.
            </span>
            <a
              href={accountUrl(info.builderTraderAccount)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary/50 hover:text-ember-orange"
            >
              fee account {shortAddr(info.builderTraderAccount, 4, 4)} ↗
            </a>
            <Link href="/profile/builder" className="text-ember-orange/80 hover:text-ember-orange uppercase tracking-wider text-[10px]">
              Manage in profile →
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-text-secondary/60">This wallet doesn&apos;t have a builder code.</span>
            <Link href="/profile/builder" className="text-ember-orange/80 hover:text-ember-orange uppercase tracking-wider text-[10px]">
              Set one up in profile →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
