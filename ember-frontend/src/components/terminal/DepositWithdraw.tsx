"use client";

import { useState, useEffect, useRef } from "react";
import { useTransactionBuilder } from "@/hooks/useTransactionBuilder";
import { useTraderStore } from "@/stores/traderStore";
import { formatUsd } from "@/lib/format";
import clsx from "clsx";

type Mode = "deposit" | "withdraw";

interface Props {
  onClose: () => void;
}

export function DepositWithdraw({ onClose }: Props) {
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { deposit, withdraw, connected } = useTransactionBuilder();
  const collateral = useTraderStore((s) => s.collateral);
  const portfolioValue = useTraderStore((s) => s.portfolioValue);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleSubmit = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      if (mode === "deposit") {
        await deposit(parsed);
        setSuccess(`Deposited ${formatUsd(parsed)} USDC`);
      } else {
        await withdraw(parsed);
        setSuccess(`Withdrew ${formatUsd(parsed)} USDC`);
      }
      setAmount("");
    } catch (e: any) {
      setError(e?.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="w-[360px] border border-ember-border bg-surface-l1 shadow-[0_16px_64px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ember-border px-4 py-3">
          <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-primary">
            {mode === "deposit" ? "Deposit" : "Withdraw"} USDC
          </span>
          <button
            onClick={onClose}
            className="text-text-secondary/60 transition-colors hover:text-text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-ember-border/50">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setSuccess(null); }}
              className={clsx(
                "flex-1 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                mode === m
                  ? "border-b border-ember-orange text-text-primary"
                  : "text-text-secondary/60 hover:text-text-secondary"
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 p-4">
          {/* Balance info */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">
              {mode === "deposit" ? "Account Equity" : "Available to Withdraw"}
            </span>
            <span className="font-mono text-[11px] text-text-primary">
              {formatUsd(mode === "deposit" ? portfolioValue : collateral)}
            </span>
          </div>

          {/* Amount input */}
          <div>
            <label className="mb-1 block text-[10px] tracking-wider text-text-secondary/70 uppercase">
              Amount
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(null); }}
                placeholder="0.00"
                autoFocus
                className="w-full border border-ember-border bg-surface-l2 py-2.5 pl-3 pr-16 font-mono text-sm text-text-primary placeholder:text-text-secondary/40 focus:border-ember-orange/60 focus:outline-none transition-colors"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-secondary/60">
                USDC
              </span>
            </div>
          </div>

          {/* Quick amounts */}
          <div className="flex gap-2">
            {[10, 50, 100, 500].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(val.toString())}
                className="flex-1 border border-ember-border/50 py-1 font-mono text-[10px] text-text-secondary/60 transition-colors hover:border-ember-orange/30 hover:text-text-secondary"
              >
                ${val}
              </button>
            ))}
          </div>

          {/* Error / Success */}
          {error && (
            <div className="font-mono text-[10px] text-ember-red">{error}</div>
          )}
          {success && (
            <div className="font-mono text-[10px] text-ember-green">{success}</div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!connected || !amount || loading}
            className={clsx(
              "w-full py-2.5 font-mono text-[11px] font-medium uppercase tracking-wider transition-all duration-150",
              !connected
                ? "bg-surface-l2 text-text-secondary/50 cursor-not-allowed"
                : mode === "deposit"
                  ? "bg-ember-orange text-white hover:brightness-110 active:brightness-95"
                  : "bg-surface-l2 border border-ember-orange text-ember-orange hover:bg-ember-orange/10",
              loading && "opacity-50 pointer-events-none"
            )}
          >
            {loading
              ? "Processing..."
              : !connected
                ? "Connect Wallet"
                : mode === "deposit"
                  ? "Deposit USDC"
                  : "Withdraw USDC"}
          </button>
        </div>
      </div>
    </div>
  );
}
