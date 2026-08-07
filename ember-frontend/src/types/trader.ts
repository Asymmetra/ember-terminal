// SDK decimal value — all numeric fields use this format
export interface SdkDecimalValue {
  decimals: number;
  ui: string;
  value: number;
}

// Margin mode for positions — cross uses shared collateral, isolated uses dedicated collateral
export type MarginMode = "cross" | "isolated";

// Display-ready position (post-transform from SDK's camelCase + Decimal format).
// SDK sends: positionSize (Decimal, signed), entryPrice (Decimal), etc.
// traderStore.transformPosition() converts to this flat format.
export interface TraderPosition {
  symbol: string;
  side: string; // "Long" | "Short"
  size: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  discounted_unrealized_pnl: number;
  margin_mode: MarginMode;
  allocated_collateral: number;
  liquidation_price: number | null;
  position_value: number;
  initial_margin: number;
  // Funding (separate from mark-to-market unrealized PnL).
  // unsettled_funding: this epoch, not yet paid; jumps to ~0 at the 8h boundary
  //   when settlement folds it into accumulated_funding.
  // accumulated_funding: lifetime funding for this position (signed; negative
  //   = paid). Used in cumulative PnL accounting; should NOT be added to the
  //   headline mark-to-market unrealized PnL.
  unsettled_funding: number;
  accumulated_funding: number;
  tp_price: number | null;
  sl_price: number | null;
  subaccount_index: number; // 0 = cross-margin, 1-100 = isolated
}

// Display-ready limit order (post-transform from SDK's camelCase + Decimal/string format).
// SDK sends: initialTradeSize (Decimal), tradeSizeRemaining (Decimal),
// orderSequenceNumber (string), priceTicks (string from WS).
// traderStore.transformLimitOrder() converts to this flat format.
export interface LimitOrder {
  price_in_ticks: number;
  order_sequence_number: number;
  side: string; // "Bid" | "Ask"
  price: number;
  size: number;
  remaining_size: number;
  subaccount_index: number; // 0 = cross-margin, 1-100 = isolated
}

// SDK TraderView account — matches actual API response (camelCase)
export interface TraderAccount {
  traderKey: string;
  traderPdaIndex: number;
  traderSubaccountIndex: number;
  authority: string;
  state: string;
  flags: number; // Phoenix capability bitmask; 63 = fully activated
  collateralBalance: SdkDecimalValue;
  effectiveCollateral: SdkDecimalValue;
  portfolioValue: SdkDecimalValue;
  unrealizedPnl: SdkDecimalValue;
  discountedUnrealizedPnl: SdkDecimalValue;
  maintenanceMargin: SdkDecimalValue;
  cancelMargin: SdkDecimalValue;
  initialMargin: SdkDecimalValue;
  riskState: string;
  riskTier: string;
  capabilities?: Record<string, { immediate: boolean; viaColdActivation: boolean }>;
  positions: TraderPosition[];
  limitOrders: Record<string, LimitOrder[]>;
}

// GET /api/trader/:pubkey response
export interface TraderResponse {
  authority: string;
  accounts: TraderAccount[];
}

// Cancel order ID format sent to backend.
// NOTE: backend expects price as USD (e.g. 50.0) — it converts to ticks server-side.
export interface CancelOrderId {
  price: number;
  order_sequence_number: number;
}

// Order history item from SDK — camelCase, string values
export interface OrderHistoryItem {
  orderSequenceNumber: number;
  marketSymbol: string;
  status: string;
  side: string;
  isReduceOnly: boolean;
  price: string;
  baseQty: string;
  remainingBaseQty: string;
  filledBaseQty: string;
  placedAt: string;
  completedAt: string | null;
}

// Trade history item from SDK — camelCase, string values
export interface TradeHistoryItem {
  marketSymbol: string;
  baseQty: string;
  quoteQty: string;
  price: string;
  timestamp: string; // ISO 8601 string, e.g. "2026-02-12T03:36:48Z"
  transactionSignature: string;
  instructionType: string;
}

// Funding history event from SDK
export interface FundingHistoryEvent {
  timestamp: number;
  symbol: string;
  funding_payment: string;
  funding_rate_percentage: number;
  position_size: number;
  position_side: string;
}
