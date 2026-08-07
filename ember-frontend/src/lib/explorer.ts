/**
 * Explorer URL helpers — link to Solscan / Solana Explorer for any
 * on-chain artifact we surface in the UI (transactions, accounts,
 * slots, programs).
 *
 * Used pervasively on /lookup so support / debugging users can click
 * straight from any event into the chain.
 */

export const SOLSCAN_BASE = "https://solscan.io";
export const SOLANA_EXPLORER_BASE = "https://explorer.solana.com";

export function txUrl(signature: string): string {
  return `${SOLSCAN_BASE}/tx/${signature}`;
}

export function accountUrl(address: string): string {
  return `${SOLSCAN_BASE}/account/${address}`;
}

export function slotUrl(slot: number | string): string {
  return `${SOLSCAN_BASE}/block/${slot}`;
}

export function programUrl(programId: string): string {
  return `${SOLSCAN_BASE}/account/${programId}`;
}

/**
 * Truncated middle ellipsis for long pubkeys / signatures — keep the
 * first 4 + last 4 chars by default. Useful for tables where the full
 * value would dominate the row.
 */
export function shortAddr(s: string | null | undefined, head = 4, tail = 4): string {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
