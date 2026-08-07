"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import clsx from "clsx";

interface Props {
  initial?: string;
  onSubmit: (wallet: string) => void;
}

/**
 * Address input + validation. Uses @solana/web3.js's PublicKey
 * constructor as the source of truth for "valid Solana address"
 * (throws on the curve check failing, so we just try/catch).
 *
 * Recent searches persist to localStorage so support can re-jump to
 * a previously-inspected wallet with one click.
 */
const STORAGE_KEY = "ember-lookup-recent-v1";
const RECENT_LIMIT = 6;

export function WalletInput({ initial, onSubmit }: Props) {
  const [value, setValue] = useState(initial ?? "");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed.slice(0, RECENT_LIMIT));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (initial) setValue(initial); }, [initial]);

  const trimmed = value.trim();
  const validity = validateAddress(trimmed);

  const commit = (addr: string) => {
    if (validateAddress(addr) !== "valid") return;
    onSubmit(addr);
    setRecent((prev) => {
      const next = [addr, ...prev.filter((a) => a !== addr)].slice(0, RECENT_LIMIT);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(trimmed); }}
          placeholder="Paste a Solana wallet address…"
          className={clsx(
            "flex-1 border bg-ember-black/60 px-3 py-2 font-mono text-xs text-text-primary outline-none transition-colors",
            validity === "invalid"
              ? "border-ember-red/60"
              : validity === "valid"
              ? "border-ember-green/60"
              : "border-ember-border focus:border-ember-orange/60",
          )}
        />
        <button
          onClick={() => commit(trimmed)}
          disabled={validity !== "valid"}
          className={clsx(
            "border px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors",
            validity === "valid"
              ? "border-ember-orange/60 bg-ember-orange/10 text-ember-orange hover:bg-ember-orange/20"
              : "border-ember-border text-text-secondary/40 cursor-not-allowed",
          )}
        >
          Inspect
        </button>
      </div>

      <div className="flex items-center gap-3 font-mono text-[10px]">
        <span className={clsx(
          validity === "invalid" ? "text-ember-red"
          : validity === "valid" ? "text-ember-green"
          : "text-text-secondary/40",
        )}>
          {validity === "valid"   && "✓ valid Solana address"}
          {validity === "invalid" && "✗ not a valid Solana address (must be a base58 pubkey on the Ed25519 curve)"}
          {validity === "empty"   && "Paste any wallet — a base58 Solana address, 32–44 characters"}
        </span>
      </div>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/40">Recent:</span>
          {recent.map((a) => (
            <button
              key={a}
              onClick={() => { setValue(a); commit(a); }}
              className="border border-ember-border bg-surface-l2/40 px-2 py-0.5 font-mono text-[10px] text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors"
              title={a}
            >
              {a.slice(0, 4)}…{a.slice(-4)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Validity = "empty" | "valid" | "invalid";

function validateAddress(addr: string): Validity {
  if (!addr) return "empty";
  // Solana base58 addresses are 32–44 chars; PublicKey ctor validates
  // length + curve. We catch both length & curve errors as "invalid".
  if (addr.length < 32 || addr.length > 44) return "invalid";
  try {
    new PublicKey(addr);
    return "valid";
  } catch {
    return "invalid";
  }
}
