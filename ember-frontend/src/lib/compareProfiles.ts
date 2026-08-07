// Suggested profiles offered as one-click head-to-head comparisons on the
// /profile dashboard. Pure config — extend this list as more reference
// traders are curated. Addresses are full Solana pubkeys.

export interface SuggestedProfile {
  /** Display handle/label shown on the chip. */
  label: string;
  /** Full Solana pubkey of the trader to compare against. */
  address: string;
}

// Intentionally empty by default. Populating this ties a public label to a real
// on-chain address, so curate it only with addresses you own or have permission
// to feature. The compare panel hides its suggestion chips when this is empty.
export const SUGGESTED_PROFILES: SuggestedProfile[] = [];
