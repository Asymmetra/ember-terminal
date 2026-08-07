"use client";

import { useState } from "react";
import { type Period } from "@/lib/tradeStats";
import { SUGGESTED_PROFILES } from "@/lib/compareProfiles";
import { shortAddr } from "@/lib/explorer";
import clsx from "clsx";

const PERIODS: Period[] = ["24h", "7d", "30d", "all"];
const PERIOD_LABELS: Record<Period, string> = { "24h": "24h", "7d": "7d", "30d": "30d", all: "All time" };

const truncate = (addr: string) => shortAddr(addr, 6, 4);

function looksLikePubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

interface Props {
  authority: string;
  viewingOther: boolean;
  period: Period;
  onPeriodChange: (p: Period) => void;
  compareAddr: string | null;
  compareLabel: string | null;
  onCompareChange: (addr: string | null, label: string | null) => void;
}

export function ProfileHeader({
  authority, viewingOther, period, onPeriodChange, compareAddr, compareLabel, onCompareChange,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const copy = () => {
    navigator.clipboard?.writeText(authority).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  const applyInput = () => {
    const v = input.trim();
    if (!looksLikePubkey(v)) return;
    onCompareChange(v, truncate(v));
    setInput("");
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-ember-border bg-surface-l1 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <button onClick={copy} title="Copy full address" className="group flex items-center gap-2 font-mono text-[11px] text-text-primary transition-colors hover:text-ember-orange">
          <span>{truncate(authority)}</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/40 group-hover:text-ember-orange">{copied ? "copied" : "copy"}</span>
        </button>
        {viewingOther && (
          <span className="border border-ember-orange/40 bg-ember-orange/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ember-orange">viewing</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Compare control */}
        <div className="relative">
          {compareAddr ? (
            <button
              onClick={() => onCompareChange(null, null)}
              className="flex items-center gap-1 border border-ember-orange/50 bg-ember-orange/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ember-orange hover:bg-ember-orange/20 transition-colors"
            >
              vs {compareLabel} <span className="text-ember-orange/70">✕</span>
            </button>
          ) : (
            <button
              onClick={() => setOpen((v) => !v)}
              className="border border-ember-border/60 bg-ember-black px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:text-ember-orange transition-colors"
            >
              Compare ▾
            </button>
          )}
          {open && !compareAddr && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 border border-ember-border bg-surface-l2 p-3 shadow-xl">
              <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">Compare against a wallet</div>
              <div className="flex gap-1">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyInput(); }}
                  placeholder="paste pubkey"
                  className="min-w-0 flex-1 border border-ember-border bg-ember-black px-2 py-1 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/30 focus:border-ember-orange/50 focus:outline-none"
                />
                <button
                  onClick={applyInput}
                  disabled={!looksLikePubkey(input)}
                  className="border border-ember-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:text-ember-orange disabled:opacity-30 transition-colors"
                >
                  go
                </button>
              </div>
              {SUGGESTED_PROFILES.length > 0 && (
                <>
                  <div className="mb-1.5 mt-3 font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">Suggested</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_PROFILES.map((p) => (
                      <button
                        key={p.address}
                        onClick={() => { onCompareChange(p.address, p.label); setOpen(false); }}
                        className="border border-ember-border bg-ember-black px-2 py-0.5 font-mono text-[10px] text-text-secondary/80 hover:border-ember-orange/50 hover:text-ember-orange transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <PeriodSelector period={period} onChange={onPeriodChange} />
      </div>
    </div>
  );
}

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex items-center gap-px border border-ember-border/60 bg-ember-black">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={clsx(
            "px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
            period === p ? "bg-ember-orange/15 text-ember-orange" : "text-text-secondary/60 hover:text-text-secondary",
          )}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}
