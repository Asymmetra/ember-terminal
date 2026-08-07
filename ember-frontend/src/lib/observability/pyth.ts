/**
 * Pyth Network Hermes streaming integration.
 *
 * Original plan was to read Pyth Lazer prices via the MagicBlock
 * oracle-template program on Solana (PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd).
 * That program IS deployed on mainnet, but it has zero price-feed
 * accounts published under it — empirical check via getProgramAccounts
 * returned only the program loader's own data slot. The MagicBlock
 * docs describe the API but the actual price-feed accounts aren't on
 * mainnet (likely still on devnet or planned).
 *
 * Pivot: subscribe to Pyth's own Hermes endpoint directly. Hermes is
 * the same upstream feed MagicBlock would have re-published on-chain.
 * Pure HTTPS Server-Sent Events; cleaner than Solana RPC and bypasses
 * the deployment gap.
 *
 * https://hermes.pyth.network/v2/updates/price/stream?ids[]=ID1&ids[]=ID2
 */

export const PYTH_HERMES_BASE = "https://hermes.pyth.network";

/**
 * Phoenix symbol → Pyth Hermes price feed ID (no 0x prefix, lowercase).
 * Source: https://pyth.network/developers/price-feed-ids (Pyth EVM
 * Stable price feeds — same IDs work for Hermes).
 *
 * Coverage limited to the largest markets for now; can extend by
 * adding entries here as needed.
 */
export const PYTH_FEED_IDS: Record<string, string> = {
  BTC:  "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH:  "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL:  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  XRP:  "ec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8",
  DOGE: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
  AAVE: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445",
  SUI:  "23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  BNB:  "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  JUP:  "0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  HYPE: "4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
  TAO:  "410f41de235f2db824e562ea7ab2d3d3d4ff048316c61d629c0b93f58584e1af",
  ZEC:  "bdc702e9ed31aa2497e6d033bc9ed02b89c8c11de5b91dd33f7da9f351b3acf2",
  WTIOIL:"b84acd1ad4aae127f5440f0e34a9bf3e8da7da9a1ce17e8a1b7f3d8c4b6e54f6",
};

/**
 * Phoenix symbol → friendly Pyth feed name for snippet generation +
 * UI labels. Identical content to PYTH_FEED_IDS keyed differently
 * for readability ("SOL/USD" vs "SOL").
 */
export function pythFeedFor(phoenixSymbol: string): { id: string; name: string } | null {
  const id = PYTH_FEED_IDS[phoenixSymbol];
  if (!id) return null;
  return { id, name: `${phoenixSymbol}/USD` };
}

/** All Phoenix symbols with a configured Pyth Hermes feed. */
export function pythCoveredPhoenixSymbols(): string[] {
  return Object.keys(PYTH_FEED_IDS);
}

/**
 * Build the SSE URL with one `ids[]=<feedId>` param per symbol the
 * caller wants to track. Hermes returns one `parsed[]` array per
 * event containing updates for any of the requested IDs.
 */
export function buildHermesStreamUrl(feedIds: string[]): string {
  if (feedIds.length === 0) return "";
  const u = new URL("/v2/updates/price/stream", PYTH_HERMES_BASE);
  for (const id of feedIds) u.searchParams.append("ids[]", id);
  // parsed=true: include the JSON-decoded price + expo (otherwise Hermes
  // returns only the binary Wormhole VAA payload).
  u.searchParams.set("parsed", "true");
  // ignore_invalid_price_ids=true: don't reject the whole stream when
  // one ID isn't recognized. Hermes' default behavior is to close the
  // connection immediately if ANY id is unknown — combined with our
  // hardcoded mapping that's a brittle fail-everything mode. With this
  // flag, unknown IDs are silently dropped and the valid ones still
  // stream.
  u.searchParams.set("ignore_invalid_price_ids", "true");
  return u.toString();
}

interface HermesParsedItem {
  id: string;
  price?: { price?: string; conf?: string; expo?: number; publish_time?: number };
}

/**
 * Parse a Hermes SSE event payload and return per-feed price updates
 * keyed by feed-id (lowercase hex, no 0x prefix). Tolerant of missing
 * fields and unexpected shapes.
 */
export function parseHermesEvent(
  rawData: string,
): Array<{ id: string; price: number; publishTime: number | null }> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const parsed = (payload as { parsed?: unknown }).parsed;
  if (!Array.isArray(parsed)) return [];

  const out: Array<{ id: string; price: number; publishTime: number | null }> = [];
  for (const raw of parsed) {
    const item = raw as HermesParsedItem;
    if (!item?.id || !item.price) continue;
    const priceStr = item.price.price;
    const expo = item.price.expo;
    if (typeof priceStr !== "string" || typeof expo !== "number") continue;
    const raw_i = Number(priceStr);
    if (!Number.isFinite(raw_i)) continue;
    const price = raw_i * Math.pow(10, expo);
    out.push({
      id: item.id.toLowerCase().replace(/^0x/, ""),
      price,
      publishTime: typeof item.price.publish_time === "number" ? item.price.publish_time : null,
    });
  }
  return out;
}
