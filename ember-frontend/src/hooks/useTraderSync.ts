"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTraderStore } from "@/stores/traderStore";
import { wsClient } from "@/lib/ws";
import { api } from "@/lib/api";

/**
 * Syncs trader state with wallet connection.
 * On connect: fetches trader data from backend + subscribes to trader_margin WS.
 * On disconnect: resets trader store + unsubscribes.
 */
export function useTraderSync() {
  const { publicKey, connected } = useWallet();
  const setAccounts = useTraderStore((s) => s.setAccounts);
  const setConnected = useTraderStore((s) => s.setConnected);
  const setFetchingAccount = useTraderStore((s) => s.setFetchingAccount);
  const setNoAccount = useTraderStore((s) => s.setNoAccount);
  const setInviteActivated = useTraderStore((s) => s.setInviteActivated);
  const setProvisioning = useTraderStore((s) => s.setProvisioning);
  const setOnboardingDismissed = useTraderStore((s) => s.setOnboardingDismissed);
  const reset = useTraderStore((s) => s.reset);
  const prevPubkey = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const pubkeyStr = publicKey?.toBase58() || null;

    // Wallet disconnected
    if (!connected || !pubkeyStr) {
      if (prevPubkey.current) {
        unsubRef.current?.();
        unsubRef.current = null;
        reset();
        prevPubkey.current = null;
      }
      return;
    }

    // Same wallet, already synced
    if (pubkeyStr === prevPubkey.current) return;

    prevPubkey.current = pubkeyStr;
    setConnected(true, pubkeyStr);
    // Reset onboarding state for the new wallet so a previous wallet's
    // provisioning/dismissal can't leak across a wallet switch (no disconnect).
    setInviteActivated(null);
    setProvisioning("idle");
    setOnboardingDismissed(false);

    // When we confirm the wallet has no Phoenix account, ask perp-api whether
    // the wallet has already activated an invite. That distinguishes
    // "fresh wallet → show referral modal" from "activated but never deposited
    // → just show the deposit banner."
    async function checkInviteStatus() {
      try {
        const res = await api.checkOnboardingStatus(pubkeyStr!);
        setInviteActivated(!!res.activated);
      } catch (e) {
        // On error, leave inviteActivated null so the modal doesn't flash —
        // user can retry by reconnecting. Still log for diagnostics.
        console.warn("Onboarding status check failed:", e);
        setInviteActivated(null);
      }
    }

    // Fetch initial trader state from REST
    async function fetchTraderData() {
      setFetchingAccount(true);
      try {
        const data = await api.getTrader(pubkeyStr!);
        if (data?.accounts?.length > 0) {
          setAccounts(data.accounts);
          setNoAccount(false);
          // setAccounts already flips inviteActivated=true (clearly onboarded)
        } else {
          // Empty accounts array — backend has no account for this wallet
          setNoAccount(true);
          checkInviteStatus();
        }
      } catch (e: any) {
        const status = (e as any)?.status as number | undefined;
        if (status === 404 || status === 502) {
          // Backend confirmed: no Phoenix account for this wallet
          setNoAccount(true);
          checkInviteStatus();
        } else {
          // Network/server error — don't show the Phoenix warning; leave state unchanged
          console.warn("Trader data fetch failed:", e);
        }
      } finally {
        setFetchingAccount(false);
      }
    }

    fetchTraderData();

    // Subscribe to real-time trader_margin WS updates
    // SDK uses #[serde(flatten)] + #[serde(tag = "messageType")], producing flat JSON:
    // { "authority": "...", "messageType": "snapshot", "subaccounts": [...] }
    // WS snapshots use raw SDK format (flat strings like collateral: '23673164'),
    // NOT the REST Decimal format ({decimals, ui, value}) that setAccount() expects.
    // Use WS messages as a trigger to re-fetch via REST for correct data shapes.
    unsubRef.current = wsClient.subscribeTrader(pubkeyStr, (data: any) => {
      if (data?.messageType === "snapshot" || data?.messageType === "delta") {
        fetchTraderData();
      }
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [connected, publicKey, setAccounts, setConnected, setFetchingAccount, setNoAccount, setInviteActivated, setProvisioning, setOnboardingDismissed, reset]);
}
