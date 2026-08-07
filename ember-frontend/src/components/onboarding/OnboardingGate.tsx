"use client";

import { useTraderSync } from "@/hooks/useTraderSync";
import { useOnboardingProvision } from "@/hooks/useOnboardingProvision";
import { OnboardingModal } from "./OnboardingModal";

// Thin client component mounted once at the root layout. Runs useTraderSync
// globally (so trader state is kept in sync whether the user is on /terminal,
// /profile, /stats, etc.) and drives the pre-warm account provisioning
// (useOnboardingProvision) — auto-creating a Phoenix account for connected
// wallets that don't have one, with progress surfaced via toasts.
//
// The OnboardingModal is no longer a blocking gate: it only appears as a
// fallback when provisioning errors (retry) or when a user wants to enter an
// access code instead. `onRetry` re-runs the provisioning flow.
export function OnboardingGate() {
  useTraderSync();
  const provision = useOnboardingProvision();
  return <OnboardingModal onRetry={provision} />;
}
