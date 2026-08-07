/**
 * Solana RPC endpoint configuration — single source of truth for both
 * HTTPS (transaction signing, simulation, account reads) AND
 * WebSocket (account / signature / logs subscriptions) URLs.
 *
 * Used by:
 *   - WalletProvider for the wallet adapter's connection
 *   - lib/solana.ts for tx simulation + signature confirmation
 *   - (formerly: MagicBlock Pyth Lazer accountSubscribe — pivoted to Pyth Hermes SSE)
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_SOLANA_RPC` — set this on Vercel to a paid endpoint
 *      (Helius / QuickNode / Triton). Honored verbatim for HTTPS;
 *      the matching WSS URL is derived by swapping the schema.
 *   2. `https://solana.publicnode.com` — public mainnet endpoint with
 *      reasonable rate limits and a paired WSS endpoint. First-choice
 *      fallback so things degrade gracefully if Vercel forgets the
 *      env var.
 *   3. `https://api.mainnet-beta.solana.com` — Solana Labs' public
 *      endpoint. Heavy rate-limiting; only useful for local dev
 *      sanity checks.
 *
 * `connect-src` in vercel.json must permit all hostnames that appear
 * in this resolution chain (both https: and wss: schemas).
 */

const PRIMARY_HTTPS =
  process.env.NEXT_PUBLIC_SOLANA_RPC && process.env.NEXT_PUBLIC_SOLANA_RPC.trim().length > 0
    ? process.env.NEXT_PUBLIC_SOLANA_RPC.trim()
    : "https://solana.publicnode.com";

/**
 * HTTPS endpoint for one-shot RPC calls (sendTransaction, simulate,
 * getAccountInfo, etc.). Honored as-given, including api-key query
 * strings on providers like Helius.
 */
export const SOLANA_HTTPS_URL = PRIMARY_HTTPS;

/**
 * WSS endpoint for subscription RPCs (accountSubscribe / signatureSubscribe).
 * Derived from `SOLANA_HTTPS_URL` by swapping the schema so providers
 * that share the same hostname for HTTP and WS (Helius, Triton,
 * publicnode) work without additional config.
 */
export const SOLANA_WSS_URL = PRIMARY_HTTPS.replace(/^https?:/, "wss:");

/**
 * Public fallback list — useful when implementing client-side
 * failover (e.g. if the primary WSS connection errors out
 * repeatedly, rotate to the next). Order: most-permissive first.
 */
export const SOLANA_PUBLIC_FALLBACKS = {
  https: [
    "https://solana.publicnode.com",
    "https://api.mainnet-beta.solana.com",
  ],
  wss: [
    "wss://solana.publicnode.com",
    "wss://api.mainnet-beta.solana.com",
  ],
} as const;
