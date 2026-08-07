// Per-market leverage intent captured at order-submission time.
//
// Cross-margin positions share a single collateral pool on-chain — Phoenix
// never stores a "user-chosen leverage" per position. Computing
// notional/total_collateral for the positions tray drifts as unrelated
// account activity (deposits, withdrawals, other positions) changes the
// denominator, producing a number that rarely matches the slider the
// user dragged when opening the position.
//
// Isolated positions don't have this problem because subaccount
// collateral is a per-position quantity.

const PREFIX = "ember:lev:";

export function getLeveragePref(symbol: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + symbol);
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setLeveragePref(symbol: string, leverage: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(leverage) || leverage <= 0) return;
  try {
    window.localStorage.setItem(PREFIX + symbol, String(leverage));
  } catch {
    // storage unavailable (privacy mode, quota) — silently drop
  }
}
