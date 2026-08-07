"use client";

import { useCallback, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTraderStore } from "@/stores/traderStore";
import { useToastStore } from "@/stores/toastStore";
import { api } from "@/lib/api";
import { REFERRAL_CODE } from "@/lib/constants";

// Pre-warm onboarding: when a connected wallet has no Phoenix account, we
// auto-provision one (one-time signMessage → referral activation with REKT →
// wait for the on-chain trader PDA), surfacing progress via the standard toast
// system. The wallet only signs once; the backend relays that signature to
// Phoenix and activates in a single request (the keyless backend never holds
// keys). Referral activation is the only auth-gated call and happens once per
// wallet, so there's no persistent session to manage.

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function friendlyProvisionError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("rejected") || lower.includes("declined") || lower.includes("signmessage")) {
    return "Signature declined. Retry to finish setting up your Phoenix account.";
  }
  if (lower.includes("rate_limited") || lower.includes("rate limited")) {
    return "Sign-in is rate-limited right now — wait a few seconds and retry.";
  }
  if (msg.includes("auth_failed")) return "Couldn't verify your wallet. Please retry.";
  if (msg.includes("invalid_code")) return "Account activation was rejected. Please retry.";
  if (msg.includes("upstream_error")) return "Couldn't reach Phoenix. Please try again in a moment.";
  return msg || "Account setup failed. Please retry.";
}

/** Poll the backend until the new trader PDA surfaces (Phoenix documents a
 *  ~15s onboarding window; we poll up to POLL_TIMEOUT_MS for headroom). Returns
 *  true if the account appeared (and was loaded into the store). */
async function pollForAccount(authority: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const data = await api.getTrader(authority);
      if (data?.accounts?.length > 0) {
        useTraderStore.getState().setAccounts(data.accounts);
        return true;
      }
    } catch {
      // 404 while the PDA hasn't surfaced yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

export function useOnboardingProvision() {
  const { publicKey, signMessage } = useWallet();
  const connected = useTraderStore((s) => s.connected);
  const noAccount = useTraderStore((s) => s.noAccount);
  const inviteActivated = useTraderStore((s) => s.inviteActivated);
  const provisioning = useTraderStore((s) => s.provisioning);
  const onboardingDismissed = useTraderStore((s) => s.onboardingDismissed);

  const addToast = useToastStore((s) => s.addToast);
  const updateToast = useToastStore((s) => s.updateToast);
  const inFlight = useRef(false);

  const provision = useCallback(async () => {
    if (inFlight.current) return;
    if (!publicKey || !signMessage) return;
    inFlight.current = true;

    const { setProvisioning, setInviteActivated } = useTraderStore.getState();
    const authority = publicKey.toBase58();
    const toastId = addToast("loading", "Setting up your Phoenix account", "Provisioning your account…");

    try {
      // 1. One-time wallet sign-in. The signature authorizes referral activation;
      //    we never hold the key — the backend relays the signature to Phoenix.
      setProvisioning("signing");
      updateToast(toastId, {
        type: "loading",
        title: "Confirm in your wallet",
        detail: "Sign the message to create your Phoenix account",
      });
      const nonce = await api.getWalletNonce(authority);
      const signature = await signMessage(new TextEncoder().encode(nonce.message));

      // 2. Activate the referral (REKT) on the signed session — provisions the account.
      setProvisioning("activating");
      updateToast(toastId, {
        type: "loading",
        title: "Creating your account",
        detail: "Activating with Ember…",
      });
      await api.activateReferral({
        authority,
        referralCode: REFERRAL_CODE,
        signature: toBase64(signature),
        nonceId: nonce.nonce_id,
      });
      setInviteActivated(true);

      // 3. Wait for the on-chain trader PDA to appear (~15s onboarding window).
      setProvisioning("waiting");
      updateToast(toastId, {
        type: "loading",
        title: "Finalizing your account",
        detail: "Almost ready…",
      });
      const visible = await pollForAccount(authority);

      setProvisioning("ready");
      updateToast(toastId, {
        type: "success",
        title: "Phoenix account ready",
        detail: visible
          ? "Make your first deposit to start trading."
          : "Account created — it'll be ready to trade in a moment.",
      });
    } catch (e: unknown) {
      const friendly = friendlyProvisionError(e instanceof Error ? e.message : String(e));
      setProvisioning("error", friendly);
      updateToast(toastId, { type: "error", title: "Account setup failed", detail: friendly });
    } finally {
      inFlight.current = false;
    }
  }, [publicKey, signMessage, addToast, updateToast]);

  // Pre-warm: as soon as a connected wallet is confirmed to have no Phoenix
  // account and has not activated, provision it automatically (one signature).
  useEffect(() => {
    const shouldProvision =
      connected &&
      !!publicKey &&
      noAccount === true &&
      inviteActivated === false &&
      provisioning === "idle" &&
      !onboardingDismissed;
    if (!shouldProvision) return;
    if (signMessage) {
      void provision();
    } else {
      // Wallet can't sign off-chain messages (e.g. some hardware wallets).
      // Surface an actionable error so the OnboardingModal fallback (access-code
      // path) becomes reachable — otherwise provisioning would sit "idle"
      // forever and every trade attempt would show a misleading "setting up…".
      useTraderStore.getState().setProvisioning(
        "error",
        "This wallet can't sign the setup message. Use an access code, or connect a wallet that supports message signing.",
      );
    }
  }, [connected, publicKey, signMessage, noAccount, inviteActivated, provisioning, onboardingDismissed, provision]);

  return provision;
}
