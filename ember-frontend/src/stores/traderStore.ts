import { create } from "zustand";
import { TraderAccount, TraderPosition, LimitOrder, MarginMode } from "@/types/trader";

// Helper to extract number from SDK's { decimals, ui, value } format
function sdkNum(val: any): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object" && val.ui != null) return parseFloat(val.ui) || 0;
  return 0;
}

// Transform SDK position (camelCase + Decimal objects) → display-ready TraderPosition
// NOTE: mark_price is NOT set here — it's computed reactively in Positions component
// from statsStore to avoid stale data between account refreshes
function transformPosition(sdkPos: any, subaccountIndex: number): TraderPosition {
  const rawSize = sdkNum(sdkPos.positionSize);
  const side = rawSize >= 0 ? "Long" : "Short";

  const marginMode: MarginMode = subaccountIndex > 0
    ? "isolated"
    : (sdkPos.marginMode || sdkPos.margin_mode || "cross") as MarginMode;

  // Extract liquidation price from SDK (may be camelCase or snake_case)
  const liqRaw = sdkPos.liquidationPrice ?? sdkPos.liquidation_price;
  const liqPrice = liqRaw != null ? sdkNum(liqRaw) : null;

  return {
    symbol: sdkPos.marketSymbol || sdkPos.symbol || "",
    side,
    size: Math.abs(rawSize),
    entry_price: sdkNum(sdkPos.entryPrice),
    mark_price: 0,
    unrealized_pnl: sdkNum(sdkPos.unrealizedPnl),
    discounted_unrealized_pnl: sdkNum(sdkPos.discountedUnrealizedPnl),
    margin_mode: marginMode,
    allocated_collateral: sdkNum(sdkPos.allocatedCollateral || sdkPos.allocated_collateral),
    liquidation_price: liqPrice && liqPrice > 0 ? liqPrice : null,
    position_value: sdkNum(sdkPos.positionValue),
    initial_margin: sdkNum(sdkPos.initialMargin || sdkPos.positionInitialMargin),
    // Funding (Phoenix tracks both fields per-position; both are realized PnL
    // components and are intentionally NOT added into the headline
    // unrealized_pnl above — that field is mark-to-market only.)
    unsettled_funding: sdkNum(sdkPos.unsettledFunding ?? sdkPos.unsettled_funding),
    accumulated_funding: sdkNum(sdkPos.accumulatedFunding ?? sdkPos.accumulated_funding),
    tp_price: sdkPos.tpPrice != null ? sdkNum(sdkPos.tpPrice) : (sdkPos.tp_price != null ? sdkNum(sdkPos.tp_price) : null),
    sl_price: sdkPos.slPrice != null ? sdkNum(sdkPos.slPrice) : (sdkPos.sl_price != null ? sdkNum(sdkPos.sl_price) : null),
    subaccount_index: subaccountIndex,
  };
}

// Transform SDK limit order (camelCase + Decimal/string) → display-ready LimitOrder
function transformLimitOrder(sdkOrder: any, subaccountIndex: number): LimitOrder {
  return {
    price_in_ticks: typeof sdkOrder.priceTicks === "string"
      ? parseInt(sdkOrder.priceTicks, 10) || 0
      : sdkOrder.priceTicks ?? sdkOrder.price_in_ticks ?? 0,
    order_sequence_number: typeof sdkOrder.orderSequenceNumber === "string"
      ? parseInt(sdkOrder.orderSequenceNumber, 10) || 0
      : sdkOrder.orderSequenceNumber ?? sdkOrder.order_sequence_number ?? 0,
    side: sdkOrder.side || "Bid",
    price: sdkNum(sdkOrder.price || sdkOrder.limitPrice),
    size: sdkNum(sdkOrder.initialTradeSize || sdkOrder.size),
    remaining_size: sdkNum(sdkOrder.tradeSizeRemaining || sdkOrder.remaining_size),
    subaccount_index: subaccountIndex,
  };
}

export type ActivationState = "uninitialized" | "inactive" | "active";

// JIT account provisioning (auto pre-warm on connect for wallets with no
// Phoenix account). Drives the provisioning toasts + the trade-attempt guard.
//   idle       — nothing to do (has an account, or not yet evaluated)
//   signing    — waiting for the wallet to sign the one-time auth message
//   activating — sign-in + referral activation in flight
//   waiting    — activated; polling for the on-chain trader PDA (~15s window)
//   ready      — account provisioned and visible
//   error      — provisioning failed; user can retry from the fallback panel
export type ProvisioningState =
  | "idle"
  | "signing"
  | "activating"
  | "waiting"
  | "ready"
  | "error";

interface TraderStore {
  connected: boolean;
  authority: string | null;
  account: TraderAccount | null;
  allAccounts: TraderAccount[]; // all registered subaccounts — preserved for per-subaccount balance queries
  fetchingAccount: boolean; // true while REST fetch is in-flight; gates no-account warning
  noAccount: boolean; // true only when backend confirmed 502/404 (no Phoenix account)
  // Invite/referral onboarding state (Phoenix off-chain gate).
  //   null  — we haven't checked yet; modals/banners stay hidden
  //   false — checked and the wallet has not activated a referral yet
  //   true  — wallet has either activated OR already has Phoenix accounts
  inviteActivated: boolean | null;
  // True when the user explicitly chose "Browse anyway" on the onboarding modal.
  // Suppresses the modal for the rest of the session without disconnecting the
  // wallet. Cleared automatically on wallet change / disconnect / successful
  // activation. Trade attempts will still surface an error from Phoenix until
  // the wallet activates.
  onboardingDismissed: boolean;
  // Auto-provisioning lifecycle (see ProvisioningState). Set by useOnboardingProvision.
  provisioning: ProvisioningState;
  provisioningError: string | null;
  activationState: ActivationState; // derived from primary account flags: uninitialized | inactive | active
  activationFlags: number; // raw flags value when activationState === "inactive"
  collateral: number; // effectiveCollateral — already net of unrealized PnL
  collateralBalance: number; // raw collateralBalance — useful for ROI denominator
  portfolioValue: number;
  unrealizedPnl: number; // sum across all subaccounts (cross + isolated)
  discountedUnrealizedPnl: number; // risk-haircut version, used for margin checks
  initialMargin: number;
  maintenanceMargin: number;
  riskState: string;
  positions: TraderPosition[];
  limitOrders: Record<string, LimitOrder[]>;
  lastRefresh: number; // increments on every setAccounts — used to trigger dependent refreshes
  setAccounts: (accounts: TraderAccount[]) => void;
  setConnected: (connected: boolean, authority?: string) => void;
  setFetchingAccount: (fetching: boolean) => void;
  setNoAccount: (noAccount: boolean) => void;
  setInviteActivated: (v: boolean | null) => void;
  setOnboardingDismissed: (v: boolean) => void;
  setProvisioning: (state: ProvisioningState, error?: string | null) => void;
  reset: () => void;
}


export const useTraderStore = create<TraderStore>((set, get) => ({
  connected: false,
  authority: null,
  account: null,
  allAccounts: [],
  fetchingAccount: false,
  noAccount: false,
  inviteActivated: null,
  onboardingDismissed: false,
  provisioning: "idle",
  provisioningError: null,
  activationState: "uninitialized",
  activationFlags: 0,
  collateral: 0,
  collateralBalance: 0,
  portfolioValue: 0,
  unrealizedPnl: 0,
  discountedUnrealizedPnl: 0,
  initialMargin: 0,
  maintenanceMargin: 0,
  riskState: "",
  positions: [],
  limitOrders: {},
  lastRefresh: 0,
  setAccounts: (accounts) => {
    // Use cross-margin account (index 0) for portfolio summary
    const primary = accounts.find((a) => a.traderSubaccountIndex === 0) || accounts[0];

    // Aggregate positions from ALL accounts, threading subaccount_index
    const positions: TraderPosition[] = [];
    const limitOrders: Record<string, LimitOrder[]> = {};

    for (const account of accounts) {
      const subIdx = account.traderSubaccountIndex ?? 0;
      for (const pos of account.positions || []) {
        positions.push(transformPosition(pos, subIdx));
      }
      for (const [symbol, orders] of Object.entries(account.limitOrders || {})) {
        const transformed = (orders as any[]).map((o) => transformLimitOrder(o, subIdx));
        limitOrders[symbol] = [...(limitOrders[symbol] || []), ...transformed];
      }
    }

    const flags = typeof primary.flags === "number" ? primary.flags : 0;
    // A wallet is "active" if it can place market orders (the core trading capability).
    // flags=62 (Cold) is fully functional for trading — only flags < 6 (Frozen) is truly inactive.
    const canTrade = primary.capabilities?.placeMarketOrder?.immediate === true;
    const activationState: ActivationState = canTrade || flags >= 63 ? "active" : "inactive";

    // Aggregate unrealizedPnl (and the discounted variant) across ALL subaccounts.
    // Phoenix's per-account fields are isolated to that subaccount, so taking
    // only the cross-margin (primary) account would silently zero-out PnL from
    // every isolated subaccount. This is what the portfolio bar /
    // any future consumer of `unrealizedPnl` should see.
    const totalUnrealizedPnl = accounts.reduce((s, a) => s + sdkNum(a.unrealizedPnl), 0);
    const totalDiscountedUnrealizedPnl = accounts.reduce(
      (s, a) => s + sdkNum(a.discountedUnrealizedPnl),
      0,
    );

    set({
      account: primary,
      allAccounts: accounts,
      noAccount: false,
      inviteActivated: true,
      onboardingDismissed: false,
      activationState,
      activationFlags: flags,
      collateral: sdkNum(primary.effectiveCollateral),
      collateralBalance: sdkNum(primary.collateralBalance),
      portfolioValue: sdkNum(primary.portfolioValue),
      unrealizedPnl: totalUnrealizedPnl,
      discountedUnrealizedPnl: totalDiscountedUnrealizedPnl,
      initialMargin: sdkNum(primary.initialMargin),
      maintenanceMargin: sdkNum(primary.maintenanceMargin),
      riskState: primary.riskState || "",
      positions,
      limitOrders,
      lastRefresh: get().lastRefresh + 1,
    });
  },
  setConnected: (connected, authority) =>
    set({ connected, authority: authority || null }),
  setFetchingAccount: (fetching) => set({ fetchingAccount: fetching }),
  setNoAccount: (noAccount) => set({ noAccount, ...(noAccount && { activationState: "uninitialized" as ActivationState, activationFlags: 0 }) }),
  setInviteActivated: (v) => set({ inviteActivated: v }),
  setOnboardingDismissed: (v) => set({ onboardingDismissed: v }),
  setProvisioning: (state, error = null) => set({ provisioning: state, provisioningError: error }),
  reset: () =>
    set({
      connected: false,
      authority: null,
      account: null,
      allAccounts: [],
      fetchingAccount: false,
      noAccount: false,
      inviteActivated: null,
      onboardingDismissed: false,
      provisioning: "idle",
      provisioningError: null,
      activationState: "uninitialized",
      activationFlags: 0,
      collateral: 0,
      collateralBalance: 0,
      portfolioValue: 0,
      unrealizedPnl: 0,
      discountedUnrealizedPnl: 0,
      initialMargin: 0,
      maintenanceMargin: 0,
      riskState: "",
      lastRefresh: 0,
      positions: [],
      limitOrders: {},
    }),
}));
