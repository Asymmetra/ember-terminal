"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTraderStore } from "@/stores/traderStore";
import { api } from "@/lib/api";
import clsx from "clsx";

// Fallback onboarding panel.
//
// New wallets are provisioned AUTOMATICALLY on connect (useOnboardingProvision):
// a one-time signature → referral activation (REKT) → the account is created,
// with progress surfaced through the standard toast system. There is no manual
// referral-code entry anymore.
//
// This dialog only appears when that auto-setup FAILED (provisioning === "error").
// It offers:
//   • Retry setup     — re-run the automatic provisioning flow
//   • Have a code?     — activate an access/allowlist code (no signature needed)
//   • Browse anyway    — dismiss and use the terminal read-only
//   • Disconnect       — return to the disconnected state / switch wallets

export function OnboardingModal({ onRetry }: { onRetry: () => void | Promise<void> }) {
  const { connected, publicKey, disconnect } = useWallet();
  const provisioning = useTraderStore((s) => s.provisioning);
  const provisioningError = useTraderStore((s) => s.provisioningError);
  const onboardingDismissed = useTraderStore((s) => s.onboardingDismissed);
  const setInviteActivated = useTraderStore((s) => s.setInviteActivated);
  const setOnboardingDismissed = useTraderStore((s) => s.setOnboardingDismissed);
  const setProvisioning = useTraderStore((s) => s.setProvisioning);

  const [showAccessCode, setShowAccessCode] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldOpen =
    !!connected && !!publicKey && provisioning === "error" && !onboardingDismissed;

  // Reset transient fields whenever the panel closes so reopening is clean.
  useEffect(() => {
    if (!shouldOpen) {
      setShowAccessCode(false);
      setCode("");
      setError(null);
      setSubmitting(false);
    }
  }, [shouldOpen]);

  function handleRetry() {
    setError(null);
    // Reset to idle so the provisioning flow can re-run from the top.
    setProvisioning("idle");
    void onRetry();
  }

  async function handleAccessCode() {
    if (!publicKey) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Access code is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.activateAccessCode(publicKey.toBase58(), trimmed);
      setInviteActivated(true);
      setProvisioning("ready");
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "";
      if (msg.startsWith("invalid_code:")) {
        setError("Invalid access code. Double-check and try again.");
      } else if (msg.startsWith("upstream_error:")) {
        setError("Couldn't reach Phoenix. Try again in a moment.");
      } else {
        setError(msg || "Activation failed. Please try again.");
      }
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  function handleBrowseAnyway() {
    setOnboardingDismissed(true);
  }

  function handleDisconnect() {
    disconnect().catch(() => {});
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !submitting) {
      e.preventDefault();
      handleAccessCode();
    }
  }

  return (
    <AnimatePresence>
      {shouldOpen && (
        <>
          <motion.div
            key="onboard-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            key="onboard-panel"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            <div className="w-full max-w-[440px] border border-ember-border bg-surface-l1 shadow-[0_16px_64px_rgba(0,0,0,0.6)]">
              <div className="border-b border-ember-border/60 px-5 py-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ember-orange">
                  Account setup
                </span>
              </div>

              <div className="flex flex-col gap-4 px-5 py-5">
                <p className="font-mono text-[11px] leading-relaxed text-text-secondary">
                  {provisioningError ||
                    "We couldn't finish setting up your Phoenix account. You can retry, or use an access code if you have one."}
                </p>

                <button
                  onClick={handleRetry}
                  disabled={submitting}
                  className="flex items-center justify-center gap-2 border border-ember-orange bg-ember-orange/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-ember-orange transition-colors hover:bg-ember-orange/25"
                >
                  Retry setup
                </button>

                <div className="border-t border-ember-border/60 pt-4">
                  {!showAccessCode ? (
                    <button
                      onClick={() => setShowAccessCode(true)}
                      className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 transition-colors hover:text-ember-orange"
                    >
                      Have an access code?
                    </button>
                  ) : (
                    <label className="flex flex-col gap-1.5">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/60">
                        Access code
                      </span>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          autoFocus
                          value={code}
                          onChange={(e) => {
                            setCode(e.target.value);
                            if (error) setError(null);
                          }}
                          onKeyDown={handleKey}
                          disabled={submitting}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder="Enter access code"
                          className={clsx(
                            "min-w-0 flex-1 border bg-ember-black px-3 py-2 font-mono text-[13px] tracking-wider text-text-primary outline-none transition-colors",
                            error
                              ? "border-ember-red/70 focus:border-ember-red"
                              : "border-ember-border focus:border-ember-orange/70"
                          )}
                        />
                        <button
                          onClick={handleAccessCode}
                          disabled={submitting || code.trim().length === 0}
                          className={clsx(
                            "border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                            submitting || code.trim().length === 0
                              ? "cursor-not-allowed border-ember-border bg-surface-l2 text-text-secondary/40"
                              : "border-ember-orange bg-ember-orange/15 text-ember-orange hover:bg-ember-orange/25"
                          )}
                        >
                          {submitting ? "…" : "Apply"}
                        </button>
                      </div>
                      {error && (
                        <span className="font-mono text-[10px] text-ember-red">{error}</span>
                      )}
                    </label>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-ember-border/60 pt-4">
                  <button
                    onClick={handleBrowseAnyway}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 border border-ember-border bg-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary/80 transition-colors hover:bg-surface-l2 hover:text-text-primary"
                  >
                    Browse anyway
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 border border-ember-border bg-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary/80 transition-colors hover:bg-surface-l2 hover:text-text-primary"
                  >
                    Disconnect wallet
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
