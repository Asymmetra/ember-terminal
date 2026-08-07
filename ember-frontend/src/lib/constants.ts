export const COLORS = {
  emberBlack: "#0C0C0E",
  surfaceL1: "#16171B",
  surfaceL2: "#1E1F25",
  emberBorder: "#2A2B33",
  emberOrange: "#FF5500",
  emberGreen: "#2EE29B",
  emberRed: "#F23B4E",
  textPrimary: "#FFFFFF",
  textSecondary: "#9CA3AF",
} as const;

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001/ws";

// Referral code used to auto-provision a Phoenix account for any connected
// wallet that doesn't have one yet. Overridable without a redeploy via
// NEXT_PUBLIC_REFERRAL_CODE.
export const REFERRAL_CODE =
  process.env.NEXT_PUBLIC_REFERRAL_CODE || "REKT";

// Flat taker-fee rate used to back out a rough lifetime-volume estimate from a
// trader's cumulative taker fees on the leaderboard (volume ≈ fees / rate).
// Approximate (taker-side only, flat rate). Keep in sync with the backend's
// LEADERBOARD_TAKER_FEE_RATE; overridable via NEXT_PUBLIC_TAKER_FEE_RATE.
export const ESTIMATED_TAKER_FEE_RATE =
  Number(process.env.NEXT_PUBLIC_TAKER_FEE_RATE) || 0.0005;
