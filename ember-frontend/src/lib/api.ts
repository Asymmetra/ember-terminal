import { API_BASE_URL } from "./constants";

export interface LeaderboardEntry {
  rank: number;
  authority: string;
  accountValueUsd: number;
  subaccounts: number;
  active: boolean;
  /** Enriched (top-N leaders only). */
  equityUsd?: number;
  unrealizedPnlUsd?: number;
  openPositions?: number;
  /** Rough estimated lifetime volume (USD) from cumulative taker fees. */
  volumeUsd?: number;
}

export interface LeaderboardStats {
  totalAccounts: number;
  totalTraders: number;
  activeTraders: number;
  totalCollateralUsd: number;
  medianAccountValueUsd: number;
  avgAccountValueUsd: number;
}

export interface LeaderboardResponse {
  stats: LeaderboardStats;
  traders: LeaderboardEntry[];
  total: number;
  offset?: number;
  limit?: number;
  generatedAt: number;
  stale: boolean;
  error?: string | null;
}

const RETRY_STATUS_CODES = [502, 503];
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

async function fetchApi<T>(path: string, options?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  let lastError: Error & { status?: number } = new Error("fetch failed");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
    } catch (networkErr: any) {
      console.warn(`[fetchApi] Network error on ${url} (attempt ${attempt + 1}/${MAX_ATTEMPTS}), API_BASE_URL: ${API_BASE_URL}`, networkErr?.message);
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
        continue;
      }
      throw lastError;
    }

    if (res.ok) return res.json();

    const error = await res.json().catch(() => ({ error: res.statusText }));
    lastError = new Error(error.error || res.statusText) as Error & { status: number };
    (lastError as any).status = res.status;

    if (!RETRY_STATUS_CODES.includes(res.status) || attempt === MAX_ATTEMPTS - 1) {
      console.warn(`[fetchApi] HTTP ${res.status} on ${url}, API_BASE_URL: ${API_BASE_URL}`);
      throw lastError;
    }

    await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
  }

  throw lastError;
}

/** Protocol-exact account margin from the Hawkeye `view_margin` endpoint
 *  (`/api/view/margin`). All USD figures are read on-chain via simulation, so
 *  they're exact and more reliable than the rate-limited REST trader view. */
export interface MarginView {
  authority: string;
  subaccountIndex: number;
  positionCount: number;
  isLiquidatable: boolean;
  riskState: number;
  riskTier: number;
  collateralUsd: number;
  effectiveCollateralUsd: number;
  freeCollateralUsd: number;
  withdrawableCollateralUsd: number;
  initialMarginUsd: number;
  maintenanceMarginUsd: number;
  unrealizedPnlUsd: number;
  discountedUnrealizedPnlUsd: number;
  unsettledFundingUsd: number;
}

export const api = {
  getMarkets: () => fetchApi<any[]>("/api/markets"),
  getMarket: (symbol: string, signal?: AbortSignal) => fetchApi<any>(`/api/markets/${symbol}`, { signal }),
  getOrderbook: (symbol: string, signal?: AbortSignal) => fetchApi<any>(`/api/orderbook/${symbol}`, { signal }),
  getCandles: (symbol: string, timeframe = "1m", limit = 300, signal?: AbortSignal) =>
    fetchApi<any[]>(`/api/candles/${symbol}?timeframe=${timeframe}&limit=${limit}`, { signal }),
  getRecentTrades: (symbol: string, signal?: AbortSignal) =>
    fetchApi<{ trades: any[] }>(`/api/trades/${symbol}/recent`, { signal }),
  getTrader: (pubkey: string) => fetchApi<any>(`/api/trader/${pubkey}`),
  getMargin: (authority: string, subaccountIndex = 0, signal?: AbortSignal) =>
    fetchApi<MarginView>(
      `/api/view/margin?authority=${authority}&subaccount_index=${subaccountIndex}`,
      { signal },
    ),
  getTraderOrders: (pubkey: string, opts?: { cursor?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", opts.limit.toString());
    const qs = params.toString();
    return fetchApi<any>(`/api/trader/${pubkey}/orders${qs ? `?${qs}` : ""}`);
  },
  getTraderTrades: (pubkey: string, opts?: { cursor?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", opts.limit.toString());
    const qs = params.toString();
    return fetchApi<any>(`/api/trader/${pubkey}/trades${qs ? `?${qs}` : ""}`);
  },
  getTraderFunding: (pubkey: string, opts?: { cursor?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", opts.limit.toString());
    const qs = params.toString();
    return fetchApi<any>(`/api/trader/${pubkey}/funding${qs ? `?${qs}` : ""}`);
  },
  buildMarketOrder: (params: any) =>
    fetchApi<any>("/api/tx/market-order", { method: "POST", body: JSON.stringify(params) }),
  buildLimitOrder: (params: any) =>
    fetchApi<any>("/api/tx/limit-order", { method: "POST", body: JSON.stringify(params) }),
  buildCancelOrders: (params: any) =>
    fetchApi<any>("/api/tx/cancel-orders", { method: "POST", body: JSON.stringify(params) }),
  buildDeposit: (params: any) =>
    fetchApi<any>("/api/tx/deposit", { method: "POST", body: JSON.stringify(params) }),
  buildWithdraw: (params: any) =>
    fetchApi<any>("/api/tx/withdraw", { method: "POST", body: JSON.stringify(params) }),
  buildIsolatedMarketOrder: (params: any) =>
    fetchApi<any>("/api/tx/isolated-market-order", { method: "POST", body: JSON.stringify(params) }),
  buildIsolatedLimitOrder: (params: any) =>
    fetchApi<any>("/api/tx/isolated-limit-order", { method: "POST", body: JSON.stringify(params) }),
  buildTransferCollateral: (params: any) =>
    fetchApi<any>("/api/tx/transfer-collateral", { method: "POST", body: JSON.stringify(params) }),
  buildRegisterSubaccount: (params: any) =>
    fetchApi<any>("/api/tx/register-subaccount", { method: "POST", body: JSON.stringify(params) }),
  buildCloseAllPositions: (params: { authority: string; positions: Array<{ symbol: string; side: string; size_lots: number; margin_mode: string; subaccount_index: number }> }) =>
    fetchApi<any>("/api/tx/close-all-positions", { method: "POST", body: JSON.stringify(params) }),
  buildMultiLimitOrders: (params: { authority: string; symbol: string; bids: Array<{ price: number; size_lots: number }>; asks: Array<{ price: number; size_lots: number }> }) =>
    fetchApi<any>("/api/tx/place-multi-limit-orders", { method: "POST", body: JSON.stringify(params) }),
  buildCancelStopLoss: (params: { authority: string; symbol: string; direction: string; subaccount_index?: number }) =>
    fetchApi<any>("/api/tx/cancel-stop-loss", { method: "POST", body: JSON.stringify(params) }),
  // Set / replace SL and/or TP triggers on an already-open position.
  buildSetPositionSlTp: (params: { authority: string; symbol: string; side: string; stop_loss_price?: number; take_profit_price?: number; subaccount_index?: number }) =>
    fetchApi<any>("/api/tx/set-position-sltp", { method: "POST", body: JSON.stringify(params) }),
  getTraderSubaccounts: (pubkey: string) => fetchApi<any>(`/api/trader/${pubkey}/subaccounts`),
  getTraderPnl: (pubkey: string, resolution = "1h", limit = 168) =>
    fetchApi<any>(`/api/trader/${pubkey}/pnl?resolution=${resolution}&limit=${limit}`),
  getTraderCollateralHistory: (pubkey: string, limit = 100) =>
    fetchApi<any>(`/api/trader/${pubkey}/collateral-history?limit=${limit}`),
  // Flight builder-fee config — drives the order-entry fee disclosure.
  getFlightConfig: () =>
    fetchApi<{ active: boolean; feeBps: number; builderAuthority: string | null; builderTraderAccount: string | null }>(
      "/api/flight/config"
    ),
  // Build the one-time register-builder tx for the connected wallet to sign.
  buildRegisterFlightBuilder: (authority: string, feeBps?: number) =>
    fetchApi<any>("/api/flight/register-builder", {
      method: "POST",
      body: JSON.stringify({ authority, feeBps }),
    }),
  // Build an update-fee tx for an already-registered builder to sign.
  buildUpdateFlightFee: (authority: string, feeBps: number) =>
    fetchApi<any>("/api/flight/update-fee", {
      method: "POST",
      body: JSON.stringify({ authority, feeBps }),
    }),
  // Community leaderboard — ranked active traders + aggregate stats, scanned
  // on-chain server-side. `q` searches the full universe (incl. dormant).
  getLeaderboard: (opts?: { limit?: number; offset?: number; q?: string }) => {
    const params = new URLSearchParams();
    if (opts?.q) params.set("q", opts.q);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return fetchApi<LeaderboardResponse>(`/api/leaderboard${qs ? `?${qs}` : ""}`);
  },
  // On-chain builder-code status for any wallet (registered?, fee, accounts).
  getFlightBuilder: (pubkey: string) =>
    fetchApi<{ builderAuthority: string; builderTraderAccount: string; registered: boolean; feeBps: number | null }>(
      `/api/flight/builder/${pubkey}`
    ),
  // Onboarding / invite gate
  checkOnboardingStatus: (pubkey: string) =>
    fetchApi<{ activated: boolean; whitelisted_at: string | null; invite_code_used: string | null }>(
      `/api/onboard/check/${pubkey}`
    ),
  // Wallet auth: fetch a nonce for the wallet to sign (Phantom signMessage).
  // The signature + nonceId are then passed to activateReferral (referral
  // activation requires an authenticated Phoenix session as of SDK 0.1.4).
  getWalletNonce: (authority: string) =>
    fetchApi<{ nonce_id: string; message: string; expires_at: string }>(
      `/api/onboard/nonce/${authority}`
    ),
  activateReferral: (params: { authority: string; referralCode: string; signature: string; nonceId: string }) =>
    fetchApi<{ trader_pda: string | null; already_activated: boolean }>(
      "/api/onboard/activate-referral",
      {
        method: "POST",
        body: JSON.stringify({
          authority: params.authority,
          referral_code: params.referralCode,
          signature: params.signature,
          nonce_id: params.nonceId,
        }),
      }
    ),
  activateAccessCode: (authority: string, code: string) =>
    fetchApi<{ trader_pda: string | null; already_activated: boolean }>(
      "/api/onboard/activate-access-code",
      {
        method: "POST",
        body: JSON.stringify({ authority, code }),
      }
    ),
};

/**
 * Fetch a trader's full trade history by following the cursor. The /trades
 * endpoint caps each page at 1000; the flat `{limit:500}` calls used across
 * the profile page silently truncated active wallets (and combined with
 * window-filtering, made the dashboard look empty). This pages through up to
 * `maxTrades` (default 5000) newest-first, returning the raw trade objects.
 */
/**
 * True when an error means "this wallet has never had a Phoenix account"
 * (the backend/SDK answers with HTTP 404 and a `User not found` body) rather
 * than a genuine failure. Lets the UI show a clean "no Phoenix account"
 * empty state instead of a raw SDK error string.
 */
export function isTraderNotFoundError(e: unknown): boolean {
  if (!e) return false;
  if ((e as { status?: number }).status === 404) return true;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes("user not found") || msg.includes("not found");
}

export async function fetchAllTrades(
  pubkey: string,
  maxTrades = 5000,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  // Hard page cap as a backstop against a misbehaving cursor.
  for (let page = 0; page < 50; page++) {
    const res: any = await api.getTraderTrades(pubkey, { cursor, limit: 1000 });
    const items: Record<string, unknown>[] = res?.trades ?? res?.data ?? [];
    out.push(...items);
    cursor = res?.next_cursor ?? res?.cursor;
    if (!cursor || !res?.has_more || items.length === 0 || out.length >= maxTrades) break;
  }
  return out;
}
