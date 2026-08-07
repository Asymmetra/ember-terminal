use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use phoenix_rise::math::{Ticks, WrapperNum};
use phoenix_rise::{
    get_conditional_orders_address, BracketLeg, BracketLegOrders, CancelId, Direction,
    IsolatedCollateralFlow, LimitOrderTicket, MarketOrderTicket, PhoenixHawkeyeClient,
    PhoenixMetadata, PhoenixTxBuilder, Side, TraderKey,
};
use serde::{Deserialize, Deserializer, de};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;

use crate::error::AppError;
use crate::services::bbo_cache::BboCache;
use crate::services::market_cache::MarketCache;
use crate::services::tx_builder::{serialize_instructions, IsolatedLimitOrderResponse, TxResponse};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct MarketOrderRequest {
    pub authority: String,
    pub symbol: String,
    pub side: String,
    pub size_lots: u64,
    #[serde(default)]
    pub stop_loss_price: Option<f64>,
    #[serde(default)]
    pub take_profit_price: Option<f64>,
    /// Maximum allowed slippage in basis points (1 bp = 0.01%).
    /// Defaults to 200 (2%) if omitted. The on-chain IOC order will reject
    /// fills beyond `best_price ± slippage`.
    #[serde(default)]
    pub max_slippage_bps: Option<u16>,
}

#[derive(Deserialize)]
pub struct LimitOrderRequest {
    pub authority: String,
    pub symbol: String,
    pub side: String,
    pub price: f64,
    pub size_lots: u64,
    #[serde(default)]
    pub stop_loss_price: Option<f64>,
    #[serde(default)]
    pub take_profit_price: Option<f64>,
}

/// Deserialize a u64 that may arrive as a JSON number or a JSON string.
/// This is needed because JavaScript cannot represent u64 values precisely
/// (Number.MAX_SAFE_INTEGER = 2^53 - 1), so Phoenix SDK and frontends
/// may serialize these fields as strings.
fn deserialize_u64_or_string<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrU64 {
        Num(u64),
        Str(String),
    }
    match StringOrU64::deserialize(deserializer)? {
        StringOrU64::Num(n) => Ok(n),
        StringOrU64::Str(s) => s.parse().map_err(de::Error::custom),
    }
}

#[derive(Deserialize)]
pub struct CancelOrderId {
    /// USD price of the order (e.g. 50.0 for $50). Converted to on-chain
    /// ticks via the market calculator's price_to_ticks().
    pub price: f64,
    #[serde(deserialize_with = "deserialize_u64_or_string")]
    pub order_sequence_number: u64,
}

#[derive(Deserialize)]
pub struct CancelOrdersRequest {
    pub authority: String,
    pub symbol: String,
    pub order_ids: Vec<CancelOrderId>,
    #[serde(default)]
    pub subaccount_index: Option<u8>,
}

#[derive(Deserialize)]
pub struct DepositRequest {
    pub authority: String,
    pub amount_usdc: f64,
}

#[derive(Deserialize)]
pub struct WithdrawRequest {
    pub authority: String,
    pub amount_usdc: f64,
}

#[derive(Deserialize)]
pub struct IsolatedMarketOrderRequest {
    pub authority: String,
    pub symbol: String,
    pub side: String,
    pub size_lots: u64,
    /// Desired USDC collateral level in the isolated subaccount.
    /// Delta above existing collateral is transferred from cross-margin.
    #[serde(default)]
    pub collateral_usdc: Option<f64>,
    /// Isolated subaccount index (1–100). When provided, targets that specific
    /// isolated subaccount slot. Defaults to None (Phoenix API picks the slot).
    #[serde(default)]
    pub subaccount_index: Option<u8>,
    #[serde(default)]
    pub stop_loss_price: Option<f64>,
    #[serde(default)]
    pub take_profit_price: Option<f64>,
    /// Maximum allowed slippage in basis points (1 bp = 0.01%).
    /// Defaults to 200 (2%) if omitted.
    #[serde(default)]
    pub max_slippage_bps: Option<u16>,
}

#[derive(Deserialize)]
pub struct IsolatedLimitOrderRequest {
    pub authority: String,
    pub symbol: String,
    pub side: String,
    pub price: f64,
    pub size_lots: u64,
    #[serde(default)]
    pub collateral_usdc: Option<f64>,
    /// Isolated subaccount index (1–100). Required — callers must always
    /// specify which subaccount to target so cancel routing is unambiguous.
    #[serde(default)]
    pub subaccount_index: Option<u8>,
    #[serde(default)]
    pub stop_loss_price: Option<f64>,
    #[serde(default)]
    pub take_profit_price: Option<f64>,
}

#[derive(Deserialize)]
pub struct TransferCollateralRequest {
    pub authority: String,
    pub from_subaccount_index: u8,
    pub to_subaccount_index: u8,
    /// USDC amount to transfer. Omit to sweep all collateral (child→parent only).
    #[serde(default)]
    pub amount_usdc: Option<f64>,
}

#[derive(Deserialize)]
pub struct RegisterSubaccountRequest {
    pub authority: String,
    /// Subaccount index: 0 = cross-margin, 1–100 = isolated.
    pub subaccount_index: u8,
}

/// Position to close in a batch close-all operation.
#[derive(Deserialize)]
pub struct ClosePositionItem {
    pub symbol: String,
    /// "long" or "short" - the side of the position to close
    pub side: String,
    /// Size in base lots
    pub size_lots: u64,
    /// "cross" or "isolated"
    pub margin_mode: String,
    /// Subaccount index (0 for cross, 1-100 for isolated)
    pub subaccount_index: u8,
}

#[derive(Deserialize)]
pub struct CloseAllPositionsRequest {
    pub authority: String,
    pub positions: Vec<ClosePositionItem>,
}

/// A single order in a multi-limit-order batch: price in USD and size in base lots.
#[derive(Deserialize)]
pub struct OrderEntry {
    pub price: f64,
    pub size_lots: u64,
}

#[derive(Deserialize)]
pub struct MultiLimitOrderRequest {
    pub authority: String,
    pub symbol: String,
    /// Bid (buy) orders — each with a USD price and size in base lots.
    #[serde(default)]
    pub bids: Vec<OrderEntry>,
    /// Ask (sell) orders — each with a USD price and size in base lots.
    #[serde(default)]
    pub asks: Vec<OrderEntry>,
    /// Whether orders should slide to top of book if they would cross.
    /// Defaults to true.
    #[serde(default = "default_slide")]
    pub slide: Option<bool>,
}

fn default_slide() -> Option<bool> {
    Some(true)
}

#[derive(Deserialize)]
pub struct CancelStopLossRequest {
    pub authority: String,
    pub symbol: String,
    /// Which TP/SL leg to cancel: "less_than" or "greater_than".
    /// For longs: "less_than" = stop-loss, "greater_than" = take-profit.
    /// For shorts: reversed.
    pub direction: String,
    /// Subaccount index (0 for cross, 1–100 for isolated). Defaults to 0.
    #[serde(default)]
    pub subaccount_index: Option<u8>,
}

/// Set / replace stop-loss and/or take-profit on an ALREADY-OPEN position.
/// Uses the same position-conditional-order mechanism as entry-time TP/SL.
#[derive(Deserialize)]
pub struct SetPositionSlTpRequest {
    pub authority: String,
    pub symbol: String,
    /// The open position's side: "long"/"short" (or bid/ask). Determines the
    /// trigger directions for the SL/TP legs.
    pub side: String,
    #[serde(default)]
    pub stop_loss_price: Option<f64>,
    #[serde(default)]
    pub take_profit_price: Option<f64>,
    /// Subaccount index (0 = cross, 1–100 = isolated). Defaults to 0.
    #[serde(default)]
    pub subaccount_index: Option<u8>,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn parse_side(s: &str) -> Result<Side, AppError> {
    match s.to_lowercase().as_str() {
        "bid" | "buy" | "long" => Ok(Side::Bid),
        "ask" | "sell" | "short" => Ok(Side::Ask),
        _ => Err(AppError::BadRequest(format!(
            "Invalid side: {}. Use bid/buy/long or ask/sell/short",
            s
        ))),
    }
}

fn parse_authority(s: &str) -> Result<Pubkey, AppError> {
    Pubkey::from_str(s).map_err(|e| AppError::BadRequest(format!("Invalid pubkey: {}", e)))
}

fn validate_size_lots(size: u64) -> Result<(), AppError> {
    if size == 0 {
        return Err(AppError::BadRequest(
            "size_lots must be greater than 0".to_string(),
        ));
    }
    Ok(())
}

fn validate_price(price: f64) -> Result<(), AppError> {
    if price <= 0.0 || !price.is_finite() {
        return Err(AppError::BadRequest(
            "price must be a positive finite number".to_string(),
        ));
    }
    Ok(())
}

fn validate_amount(amount: f64) -> Result<(), AppError> {
    if amount <= 0.0 || !amount.is_finite() {
        return Err(AppError::BadRequest(
            "amount_usdc must be a positive finite number".to_string(),
        ));
    }
    Ok(())
}

fn validate_subaccount_index(index: u8) -> Result<(), AppError> {
    if index > 100 {
        return Err(AppError::BadRequest(
            "subaccount_index must be between 0 and 100".to_string(),
        ));
    }
    Ok(())
}

/// Capacity (number of conditional orders) for a trader's conditional-orders
/// account when we create it. Holds plenty of SL/TP triggers across positions.
const CONDITIONAL_ORDERS_CAPACITY: u8 = 16;

/// Default slippage for normal market orders (2%).
const DEFAULT_SLIPPAGE_BPS: u16 = 200;

/// Wider default for close-all-positions (5%) — emergency closes need room.
const CLOSE_ALL_SLIPPAGE_BPS: u16 = 500;

/// TTL for the Hawkeye BBO fallback cache used when the realtime WS orderbook
/// is empty (cold boot / WS reconnect / never-subscribed symbol).
const BBO_CACHE_TTL_MS: i64 = 1_500;

/// Resolve the reference price for a market order's slippage cap: the best ask
/// for buys (the price we'd pay), the best bid for sells (the price we'd
/// receive). Tries the realtime WS orderbook first, then a recent Hawkeye
/// snapshot, then a live Hawkeye `view_bbo` simulation (which warms the cache).
/// Returns `None` only if no source can produce the needed side.
async fn resolve_reference_price(
    metadata: &PhoenixMetadata,
    market_cache: &MarketCache,
    bbo_cache: &BboCache,
    symbol: &str,
    side: Side,
) -> Option<f64> {
    // 1. Realtime WS book (freshest when present).
    if let Some(book) = market_cache.get_orderbook(symbol) {
        let p = match side {
            Side::Bid => book.asks.first().map(|l| l.price),
            Side::Ask => book.bids.first().map(|l| l.price),
        };
        if let Some(p) = p {
            return Some(p);
        }
    }

    // 2. Recent Hawkeye snapshot.
    if let Some(e) = bbo_cache.get(symbol, BBO_CACHE_TTL_MS) {
        return Some(match side {
            Side::Bid => e.best_ask,
            Side::Ask => e.best_bid,
        });
    }

    // 3. Live Hawkeye `view_bbo` simulation (warms the cache for bursts).
    let rpc = std::env::var("SOLANA_RPC_URL").ok()?;
    let client = PhoenixHawkeyeClient::new(rpc, metadata);
    let r = client.view_bbo(symbol).await.ok()?.value;
    let calc = metadata.get_market_calculator(symbol)?;
    // Use the flag-gated accessors: an absent side must read as None, not the
    // raw 0-tick field (which would convert to price 0).
    let bid = r
        .best_bid_ticks()
        .map(|t| calc.ticks_to_price(Ticks::new_saturating(t)));
    let ask = r
        .best_ask_ticks()
        .map(|t| calc.ticks_to_price(Ticks::new_saturating(t)));
    if let (Some(b), Some(a)) = (bid, ask) {
        bbo_cache.put(symbol, b, a);
    }
    match side {
        Side::Bid => ask,
        Side::Ask => bid,
    }
}

/// Compute a slippage-capped limit price in USD for a market order.
///
/// FAIL-CLOSED: if no price reference can be resolved from any source (WS book,
/// Hawkeye snapshot, or a live `view_bbo` simulation), this returns an error so
/// the caller REJECTS the order rather than sending it with no price cap. An
/// uncapped market order can sweep the book at a ruinous price — the previous
/// behavior returned `None` here and proceeded uncapped.
async fn compute_slippage_limit_usd(
    metadata: &PhoenixMetadata,
    market_cache: &MarketCache,
    bbo_cache: &BboCache,
    symbol: &str,
    side: Side,
    slippage_bps: u16,
) -> Result<f64, AppError> {
    let reference_price = resolve_reference_price(metadata, market_cache, bbo_cache, symbol, side)
        .await
        .ok_or_else(|| {
            AppError::Phoenix(format!(
                "no price reference available to bound slippage for {symbol}; refusing to send an uncapped market order"
            ))
        })?;

    let factor = slippage_bps as f64 / 10_000.0;
    let limit_price = match side {
        Side::Bid => reference_price * (1.0 + factor),
        Side::Ask => reference_price * (1.0 - factor),
    };

    if limit_price <= 0.0 || !limit_price.is_finite() {
        return Err(AppError::Phoenix(format!(
            "computed an invalid slippage limit for {symbol}"
        )));
    }

    Ok(limit_price)
}

fn build_bracket(
    stop_loss_price: Option<f64>,
    take_profit_price: Option<f64>,
) -> Result<Option<BracketLegOrders>, AppError> {
    if let Some(p) = stop_loss_price {
        if p <= 0.0 || !p.is_finite() {
            return Err(AppError::BadRequest(
                "stop_loss_price must be a positive finite number".to_string(),
            ));
        }
    }
    if let Some(p) = take_profit_price {
        if p <= 0.0 || !p.is_finite() {
            return Err(AppError::BadRequest(
                "take_profit_price must be a positive finite number".to_string(),
            ));
        }
    }
    if stop_loss_price.is_some() || take_profit_price.is_some() {
        Ok(Some(BracketLegOrders {
            stop_loss: stop_loss_price.map(BracketLeg::new),
            take_profit: take_profit_price.map(BracketLeg::new),
        }))
    } else {
        Ok(None)
    }
}

fn build_collateral(collateral_usdc: Option<f64>) -> Result<Option<IsolatedCollateralFlow>, AppError> {
    match collateral_usdc {
        Some(usdc) => {
            if usdc <= 0.0 || !usdc.is_finite() {
                return Err(AppError::BadRequest(
                    "collateral_usdc must be a positive finite number".to_string(),
                ));
            }
            // Cap at u64::MAX / 1_000_000 to prevent overflow on f64→u64 cast
            if usdc > 1e13 {
                return Err(AppError::BadRequest(
                    "collateral_usdc exceeds maximum allowed value".to_string(),
                ));
            }
            Ok(Some(IsolatedCollateralFlow::TransferFromCrossMargin {
                collateral: (usdc * 1_000_000.0) as u64,
            }))
        }
        None => Ok(None),
    }
}

/// Append TP/SL bracket leg instructions to `instructions` if any leg is set.
/// Delegates to the SDK's `PhoenixTxBuilder::build_bracket_leg_orders`, which
/// emits a position-conditional-order ix per leg.
fn append_bracket_legs(
    instructions: &mut Vec<Instruction>,
    builder: &PhoenixTxBuilder<'_>,
    authority: Pubkey,
    trader_account: Pubkey,
    symbol: &str,
    primary_side: Side,
    bracket: &BracketLegOrders,
) -> Result<(), AppError> {
    let bracket_ixs = builder
        .build_bracket_leg_orders(authority, trader_account, symbol, primary_side, bracket)
        .map_err(|e| AppError::Phoenix(format!("Failed to build bracket leg orders: {}", e)))?;
    instructions.extend(bracket_ixs);
    Ok(())
}

// ---------------------------------------------------------------------------
// Cross-margin handlers (existing)
// ---------------------------------------------------------------------------

async fn market_order(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MarketOrderRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building market order: {} {} lots on {}",
        req.side,
        req.size_lots,
        req.symbol
    );

    validate_size_lots(req.size_lots)?;
    let authority = parse_authority(&req.authority)?;
    let side = parse_side(&req.side)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, 0);
    let bracket = build_bracket(req.stop_loss_price, req.take_profit_price)?;

    state.ensure_market(&req.symbol).await.map_err(|_| {
        AppError::BadRequest(format!("Unknown symbol: {}", req.symbol))
    })?;
    let metadata = state.metadata.read().await;

    if metadata.is_isolated_only(&req.symbol) {
        return Err(AppError::BadRequest(format!(
            "{} is an isolated-only market. Use /api/tx/isolated-market-order or /api/tx/isolated-limit-order",
            req.symbol.to_uppercase()
        )));
    }

    let slippage_bps = req.max_slippage_bps.unwrap_or(DEFAULT_SLIPPAGE_BPS);
    let price_limit_usd = compute_slippage_limit_usd(
        &metadata,
        &state.market_cache,
        &state.bbo_cache,
        &req.symbol,
        side,
        slippage_bps,
    )
    .await?;

    let builder = PhoenixTxBuilder::new(&metadata);

    let mut ticket_builder = MarketOrderTicket::builder()
        .authority(authority)
        .trader_account(trader_pda)
        .symbol(req.symbol.clone())
        .side(side)
        .num_base_lots(req.size_lots)
        .subaccount_index(0);

    ticket_builder = ticket_builder.price(price_limit_usd);

    let ticket = ticket_builder
        .build()
        .map_err(|e| AppError::Phoenix(format!("Failed to build market order ticket: {}", e)))?;

    let mut instructions = builder
        .place_market_order(ticket)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to build market order: {}", e)))?;

    if let Some(ref bracket_legs) = bracket {
        append_bracket_legs(
            &mut instructions,
            &builder,
            authority,
            trader_pda,
            &req.symbol,
            side,
            bracket_legs,
        )?;
    }

    // Route through Flight (builder fee) when configured — no-op otherwise.
    let instructions = state.wrap_flight(instructions, authority);

    Ok(Json(serialize_instructions(
        instructions,
        format!(
            "Market {} order: {} lots on {} (slippage cap: {}bps)",
            req.side, req.size_lots, req.symbol, slippage_bps
        ),
    )))
}

async fn limit_order(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LimitOrderRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building limit order: {} {} lots at ${} on {}",
        req.side,
        req.size_lots,
        req.price,
        req.symbol
    );

    // TP/SL bracket orders are architecturally unsupported on limit orders:
    // place_stop_loss requires an existing open position, but a resting limit
    // order hasn't filled at TX time — Phoenix returns error 7002.
    if req.take_profit_price.is_some() || req.stop_loss_price.is_some() {
        return Err(AppError::BadRequest(
            "Bracket orders (TP/SL) are not supported for limit orders. \
             Use a market order for bracket functionality."
                .to_string(),
        ));
    }

    validate_size_lots(req.size_lots)?;
    validate_price(req.price)?;
    let authority = parse_authority(&req.authority)?;
    let side = parse_side(&req.side)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, 0);
    let bracket = build_bracket(req.stop_loss_price, req.take_profit_price)?;

    state.ensure_market(&req.symbol).await.map_err(|_| {
        AppError::BadRequest(format!("Unknown symbol: {}", req.symbol))
    })?;
    let metadata = state.metadata.read().await;

    if metadata.is_isolated_only(&req.symbol) {
        return Err(AppError::BadRequest(format!(
            "{} is an isolated-only market. Use /api/tx/isolated-market-order or /api/tx/isolated-limit-order",
            req.symbol.to_uppercase()
        )));
    }

    let builder = PhoenixTxBuilder::new(&metadata);

    let ticket = LimitOrderTicket::builder()
        .authority(authority)
        .trader_account(trader_pda)
        .symbol(req.symbol.clone())
        .side(side)
        .price(req.price)
        .num_base_lots(req.size_lots)
        .subaccount_index(0)
        .build()
        .map_err(|e| AppError::Phoenix(format!("Failed to build limit order ticket: {}", e)))?;

    let mut instructions = builder
        .place_limit_order(ticket)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to build limit order: {}", e)))?;

    // Append bracket leg (TP/SL) instructions if requested.
    // These place on-chain stop-loss orders that trigger after the limit order fills.
    if let Some(ref bracket_legs) = bracket {
        append_bracket_legs(
            &mut instructions,
            &builder,
            authority,
            trader_pda,
            &req.symbol,
            side,
            bracket_legs,
        )?;
    }

    // Route through Flight (builder fee) when configured — no-op otherwise.
    let instructions = state.wrap_flight(instructions, authority);

    Ok(Json(serialize_instructions(
        instructions,
        format!(
            "Limit {} order: {} lots at ${} on {}",
            req.side, req.size_lots, req.price, req.symbol
        ),
    )))
}

async fn cancel_orders(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CancelOrdersRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building cancel: {} orders on {}",
        req.order_ids.len(),
        req.symbol
    );

    if req.order_ids.is_empty() {
        return Err(AppError::BadRequest(
            "order_ids cannot be empty".to_string(),
        ));
    }
    let authority = parse_authority(&req.authority)?;
    let subaccount_index = req.subaccount_index.unwrap_or(0);
    validate_subaccount_index(subaccount_index)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, subaccount_index);

    state.ensure_market(&req.symbol).await.map_err(|_| {
        AppError::MarketNotFound(req.symbol.clone())
    })?;
    let metadata = state.metadata.read().await;

    let calc = metadata
        .get_market_calculator(&req.symbol)
        .ok_or_else(|| AppError::MarketNotFound(req.symbol.clone()))?;

    let order_ids: Vec<CancelId> = req
        .order_ids
        .iter()
        .map(|id| {
            let price_in_ticks = calc
                .price_to_ticks(id.price)
                .map_err(|e| AppError::BadRequest(format!("Invalid price {}: {}", id.price, e)))?
                .as_inner();
            Ok(CancelId::new(price_in_ticks, id.order_sequence_number))
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let builder = PhoenixTxBuilder::new(&metadata);

    let instructions = builder
        .build_cancel_orders(authority, trader_pda, &req.symbol, order_ids)
        .map_err(|e| AppError::Phoenix(format!("Failed to build cancel orders: {}", e)))?;

    Ok(Json(serialize_instructions(
        instructions,
        format!("Cancel {} orders on {}", req.order_ids.len(), req.symbol),
    )))
}

async fn deposit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DepositRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!("Building deposit: {} USDC", req.amount_usdc);
    validate_amount(req.amount_usdc)?;

    let authority = parse_authority(&req.authority)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, 0);

    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    // Check if trader is registered on Phoenix — if not, prepend registration
    let mut all_instructions: Vec<Instruction> = Vec::new();

    let trader_registered = state
        .http_client
        .traders()
        .get_trader_subaccount(&authority, 0, 0)
        .await
        .map(|opt| opt.is_some())
        .unwrap_or(false);

    if !trader_registered {
        tracing::info!(
            "Trader {} not registered on Phoenix, prepending registration",
            req.authority
        );
        let register_ixs = builder
            .build_register_trader(authority, 0, 0)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build register trader: {}", e))
            })?;
        all_instructions.extend(register_ixs);
    }

    let deposit_ixs = builder
        .build_deposit_funds(authority, trader_pda, req.amount_usdc)
        .map_err(|e| AppError::Phoenix(format!("Failed to build deposit: {}", e)))?;
    all_instructions.extend(deposit_ixs);

    Ok(Json(serialize_instructions(
        all_instructions,
        format!("Deposit {} USDC", req.amount_usdc),
    )))
}

async fn withdraw(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WithdrawRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!("Building withdraw: {} USDC", req.amount_usdc);
    validate_amount(req.amount_usdc)?;

    let authority = parse_authority(&req.authority)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, 0);

    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    let instructions = builder
        .build_withdraw_funds(authority, trader_pda, req.amount_usdc)
        .map_err(|e| AppError::Phoenix(format!("Failed to build withdrawal: {}", e)))?;

    Ok(Json(serialize_instructions(
        instructions,
        format!("Withdraw {} USDC", req.amount_usdc),
    )))
}

// ---------------------------------------------------------------------------
// Isolated margin handlers (new)
// ---------------------------------------------------------------------------

async fn isolated_market_order(
    State(state): State<Arc<AppState>>,
    Json(req): Json<IsolatedMarketOrderRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building isolated market order: {} {} lots on {}",
        req.side,
        req.size_lots,
        req.symbol
    );

    validate_size_lots(req.size_lots)?;
    let authority = parse_authority(&req.authority)?;
    let side = parse_side(&req.side)?;
    let bracket = build_bracket(req.stop_loss_price, req.take_profit_price)?;

    // Require explicit subaccount index (1–100), same as isolated_limit_order.
    let sub_idx = req
        .subaccount_index
        .filter(|&i| i > 0 && i <= 100)
        .ok_or_else(|| {
            AppError::BadRequest(
                "subaccount_index (1–100) is required for isolated market orders".to_string(),
            )
        })?;

    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);
    let mut all_instructions: Vec<Instruction> = Vec::new();

    // Auto-register isolated subaccount if not yet registered.
    // The local builder constructs the order instruction without a pre-flight
    // HTTP lookup, so unregistered traders no longer 404. Prepend register+sync
    // instructions if the PDA doesn't exist yet.
    let is_registered = state
        .http_client
        .traders()
        .get_trader_subaccount(&authority, 0, sub_idx)
        .await
        .map(|opt| opt.is_some())
        .unwrap_or(false);

    if !is_registered {
        tracing::info!(
            "Isolated sub={} not registered for {}, prepending registration",
            sub_idx,
            req.authority
        );
        let register_ixs = builder
            .build_register_trader(authority, 0, sub_idx)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build register trader: {}", e))
            })?;
        all_instructions.extend(register_ixs);

        let parent_pda = TraderKey::derive_pda(&authority, 0, 0);
        let child_pda = TraderKey::derive_pda(&authority, 0, sub_idx);
        let sync_ixs = builder
            .build_sync_parent_to_child(authority, parent_pda, child_pda)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build sync parent to child: {}", e))
            })?;
        all_instructions.extend(sync_ixs);
    }

    // Transfer collateral from cross-margin to isolated subaccount if requested.
    if let Some(usdc) = req.collateral_usdc {
        let parent_pda = TraderKey::derive_pda(&authority, 0, 0);
        let child_pda = TraderKey::derive_pda(&authority, 0, sub_idx);
        let transfer_ixs = builder
            .build_transfer_collateral(authority, parent_pda, child_pda, usdc)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build collateral transfer: {}", e))
            })?;
        all_instructions.extend(transfer_ixs);
    }

    // Build the isolated market order using the SDK ticket API with slippage cap.
    let slippage_bps = req.max_slippage_bps.unwrap_or(DEFAULT_SLIPPAGE_BPS);
    let price_limit_usd = compute_slippage_limit_usd(
        &metadata,
        &state.market_cache,
        &state.bbo_cache,
        &req.symbol,
        side,
        slippage_bps,
    )
    .await?;

    let child_pda = TraderKey::derive_pda(&authority, 0, sub_idx);

    let mut ticket_builder = MarketOrderTicket::builder()
        .authority(authority)
        .trader_account(child_pda)
        .symbol(req.symbol.clone())
        .side(side)
        .num_base_lots(req.size_lots)
        .subaccount_index(sub_idx);

    ticket_builder = ticket_builder.price(price_limit_usd);

    let ticket = ticket_builder
        .build()
        .map_err(|e| AppError::Phoenix(format!("Failed to build isolated market order ticket: {}", e)))?;

    let market_ixs = builder
        .place_market_order(ticket)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to build isolated market order: {}", e)))?;
    all_instructions.extend(market_ixs);

    // Append bracket leg (TP/SL) instructions bound to the isolated subaccount PDA.
    if let Some(ref bracket_legs) = bracket {
        append_bracket_legs(
            &mut all_instructions,
            &builder,
            authority,
            child_pda,
            &req.symbol,
            side,
            bracket_legs,
        )?;
    }

    let all_instructions = state.wrap_flight(all_instructions, authority);

    Ok(Json(serialize_instructions(
        all_instructions,
        format!(
            "Isolated market {} order: {} lots on {}",
            req.side, req.size_lots, req.symbol
        ),
    )))
}

async fn isolated_limit_order(
    State(state): State<Arc<AppState>>,
    Json(req): Json<IsolatedLimitOrderRequest>,
) -> Result<Json<IsolatedLimitOrderResponse>, AppError> {
    tracing::info!(
        "Building isolated limit order: {} {} lots at ${} on {}",
        req.side,
        req.size_lots,
        req.price,
        req.symbol
    );

    validate_size_lots(req.size_lots)?;
    validate_price(req.price)?;

    // TP/SL bracket orders are architecturally unsupported on limit orders:
    // place_stop_loss requires an existing open position, but a resting limit
    // order hasn't filled at TX time — Phoenix returns error 7002.
    if req.take_profit_price.is_some() || req.stop_loss_price.is_some() {
        return Err(AppError::BadRequest(
            "Bracket orders (TP/SL) are not supported for limit orders. \
             Use a market order for bracket functionality."
                .to_string(),
        ));
    }

    let authority = parse_authority(&req.authority)?;
    let side = parse_side(&req.side)?;
    let _collateral = build_collateral(req.collateral_usdc)?; // validate; transfer built locally below
    let bracket = build_bracket(req.stop_loss_price, req.take_profit_price)?;
    // isolated_limit_order is exclusively for isolated-margin orders — the caller
    // must always provide the target subaccount explicitly. This ensures cancel
    // routing, bracket PDA binding, and the response subaccount_index are all
    // unambiguous. Return 400 if absent or 0 (cross-margin index).
    let sub_idx = req
        .subaccount_index
        .filter(|&i| i > 0 && i <= 100)
        .ok_or_else(|| {
            AppError::BadRequest(
                "subaccount_index (1–100) is required for isolated limit orders".to_string(),
            )
        })?;

    state.ensure_market(&req.symbol).await.map_err(|_| {
        AppError::BadRequest(format!("Unknown symbol: {}", req.symbol))
    })?;
    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);
    let mut all_instructions: Vec<Instruction> = Vec::new();

    // Auto-register isolated subaccount if it has not been registered yet.
    // The local builder constructs the order instruction without a pre-flight
    // lookup, but the on-chain program still requires the PDA to exist when the
    // TX lands. Prepend register+sync instructions if not yet registered.
    let is_registered = state
        .http_client
        .traders()
        .get_trader_subaccount(&authority, 0, sub_idx)
        .await
        .map(|opt| opt.is_some())
        .unwrap_or(false);

    if !is_registered {
        tracing::info!(
            "Isolated sub={} not registered for {}, prepending registration",
            sub_idx,
            req.authority
        );
        let register_ixs = builder
            .build_register_trader(authority, 0, sub_idx)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build register trader: {}", e))
            })?;
        all_instructions.extend(register_ixs);

        let parent_pda = TraderKey::derive_pda(&authority, 0, 0);
        let child_pda = TraderKey::derive_pda(&authority, 0, sub_idx);
        let sync_ixs = builder
            .build_sync_parent_to_child(authority, parent_pda, child_pda)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build sync parent to child: {}", e))
            })?;
        all_instructions.extend(sync_ixs);
    }

    // Explicitly transfer collateral from cross-margin to the isolated subaccount.
    // /ix/place-isolated-limit-order silently ignores transfer_amount; build the
    // transfer locally via the SDK builder instead.
    if let Some(usdc) = req.collateral_usdc {
        let parent_pda = TraderKey::derive_pda(&authority, 0, 0);
        let child_pda = TraderKey::derive_pda(&authority, 0, sub_idx);
        let transfer_ixs = builder
            .build_transfer_collateral(authority, parent_pda, child_pda, usdc)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build collateral transfer: {}", e))
            })?;
        all_instructions.extend(transfer_ixs);
    }

    // Build the isolated limit order using the SDK ticket API. The ticket
    // resolves market addresses internally and converts the USD price to
    // ticks via the cached MarketCalculator — no HTTP pre-flight required.
    let child_pda = TraderKey::derive_pda(&authority, 0, sub_idx);
    let ticket = LimitOrderTicket::builder()
        .authority(authority)
        .trader_account(child_pda)
        .symbol(req.symbol.clone())
        .side(side)
        .price(req.price)
        .num_base_lots(req.size_lots)
        .subaccount_index(sub_idx)
        .build()
        .map_err(|e| AppError::Phoenix(format!("Failed to build isolated limit order ticket: {}", e)))?;
    let limit_ixs = builder
        .place_limit_order(ticket)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to build isolated limit order: {}", e)))?;
    all_instructions.extend(limit_ixs);

    // Append bracket leg (TP/SL) instructions bound to the isolated subaccount PDA.
    if let Some(ref bracket_legs) = &bracket {
        append_bracket_legs(
            &mut all_instructions,
            &builder,
            authority,
            child_pda,
            &req.symbol,
            side,
            bracket_legs,
        )?;
    }

    let all_instructions = state.wrap_flight(all_instructions, authority);

    let tx = serialize_instructions(
        all_instructions,
        format!(
            "Isolated limit {} order: {} lots at ${} on {}",
            req.side, req.size_lots, req.price, req.symbol
        ),
    );
    Ok(Json(IsolatedLimitOrderResponse {
        instructions: tx.instructions,
        message: tx.message,
        subaccount_index: sub_idx,
    }))
}

// ---------------------------------------------------------------------------
// Batch close-all positions handler
// ---------------------------------------------------------------------------

async fn close_all_positions(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CloseAllPositionsRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building close-all for {} positions",
        req.positions.len()
    );

    if req.positions.is_empty() {
        return Err(AppError::BadRequest(
            "positions cannot be empty".to_string(),
        ));
    }

    // Enforce position count limit before building instructions.
    // Each market order needs ~4 instructions; Solana TX has a hard size limit.
    const MAX_POSITIONS: usize = 8;
    if req.positions.len() > MAX_POSITIONS {
        return Err(AppError::BadRequest(format!(
            "Too many positions to close in one TX ({} requested, max {}). Close individually.",
            req.positions.len(),
            MAX_POSITIONS
        )));
    }

    let authority = parse_authority(&req.authority)?;

    // Ensure all position symbols are known (refresh-on-miss)
    for pos in &req.positions {
        state.ensure_market(&pos.symbol).await.map_err(|_| {
            AppError::BadRequest(format!("Unknown symbol: {}", pos.symbol))
        })?;
    }

    // Separate positions by margin mode
    let mut cross_positions: Vec<&ClosePositionItem> = Vec::new();
    let mut isolated_positions: Vec<&ClosePositionItem> = Vec::new();

    for pos in &req.positions {
        if pos.margin_mode.to_lowercase() == "isolated" {
            isolated_positions.push(pos);
        } else {
            cross_positions.push(pos);
        }
    }

    let mut all_instructions: Vec<Instruction> = Vec::new();

    // Process cross-margin positions (with close-all slippage cap)
    if !cross_positions.is_empty() {
        let metadata = state.metadata.read().await;
        let builder = PhoenixTxBuilder::new(&metadata);

        for pos in cross_positions {
            validate_size_lots(pos.size_lots)?;

            let position_side = match pos.side.to_lowercase().as_str() {
                "long" => Side::Bid,
                "short" => Side::Ask,
                _ => return Err(AppError::BadRequest(
                    format!("Invalid position side: {}. Use 'long' or 'short'", pos.side)
                )),
            };

            let close_side = match position_side {
                Side::Bid => Side::Ask,
                Side::Ask => Side::Bid,
            };

            let trader_pda = TraderKey::derive_pda(&authority, 0, pos.subaccount_index);
            let price_limit_usd = compute_slippage_limit_usd(
                &metadata,
                &state.market_cache,
                &state.bbo_cache,
                &pos.symbol,
                close_side,
                CLOSE_ALL_SLIPPAGE_BPS,
            )
            .await?;

            let mut ticket_builder = MarketOrderTicket::builder()
                .authority(authority)
                .trader_account(trader_pda)
                .symbol(pos.symbol.clone())
                .side(close_side)
                .num_base_lots(pos.size_lots)
                .subaccount_index(pos.subaccount_index);

            ticket_builder = ticket_builder.price(price_limit_usd);

            let ticket = ticket_builder.build().map_err(|e| {
                AppError::Phoenix(format!("Failed to build cross-margin close ticket for {}: {}", pos.symbol, e))
            })?;

            let instructions = builder
                .place_market_order(ticket)
                .await
                .map_err(|e| {
                    AppError::Phoenix(format!(
                        "Failed to build cross-margin close for {}: {}",
                        pos.symbol, e
                    ))
                })?;

            all_instructions.extend(instructions);
        }
    }

    // Process isolated positions (with close-all slippage cap)
    if !isolated_positions.is_empty() {
        let metadata = state.metadata.read().await;
        let builder = PhoenixTxBuilder::new(&metadata);

        for pos in isolated_positions {
            validate_size_lots(pos.size_lots)?;

            let position_side = match pos.side.to_lowercase().as_str() {
                "long" => Side::Bid,
                "short" => Side::Ask,
                _ => return Err(AppError::BadRequest(
                    format!("Invalid position side: {}. Use 'long' or 'short'", pos.side)
                )),
            };

            let close_side = match position_side {
                Side::Bid => Side::Ask,
                Side::Ask => Side::Bid,
            };

            let child_pda = TraderKey::derive_pda(&authority, 0, pos.subaccount_index);
            let price_limit_usd = compute_slippage_limit_usd(
                &metadata,
                &state.market_cache,
                &state.bbo_cache,
                &pos.symbol,
                close_side,
                CLOSE_ALL_SLIPPAGE_BPS,
            )
            .await?;

            let mut ticket_builder = MarketOrderTicket::builder()
                .authority(authority)
                .trader_account(child_pda)
                .symbol(pos.symbol.clone())
                .side(close_side)
                .num_base_lots(pos.size_lots)
                .subaccount_index(pos.subaccount_index);

            ticket_builder = ticket_builder.price(price_limit_usd);

            let ticket = ticket_builder.build().map_err(|e| {
                AppError::Phoenix(format!("Failed to build isolated close ticket for {}: {}", pos.symbol, e))
            })?;

            let instructions = builder
                .place_market_order(ticket)
                .await
                .map_err(|e| {
                    AppError::Phoenix(format!(
                        "Failed to build isolated close for {}: {}",
                        pos.symbol, e
                    ))
                })?;

            all_instructions.extend(instructions);
        }
    }

    // Check instruction count limits
    // Solana has a ~1232 byte transaction size limit
    // Each market order instruction takes ~3-4 accounts (~100-150 bytes)
    // Conservative limit: 6 market orders per transaction
    const MAX_INSTRUCTIONS: usize = 24; // ~6 market orders (4 ix each)
    if all_instructions.len() > MAX_INSTRUCTIONS {
        return Err(AppError::BadRequest(format!(
            "Too many instructions ({}). Max {} per transaction. Close positions individually.",
            all_instructions.len(),
            MAX_INSTRUCTIONS
        )));
    }

    let all_instructions = state.wrap_flight(all_instructions, authority);

    Ok(Json(serialize_instructions(
        all_instructions,
        format!("Close {} positions", req.positions.len()),
    )))
}

// ---------------------------------------------------------------------------
// Collateral & subaccount handlers (new)
// ---------------------------------------------------------------------------

async fn transfer_collateral(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TransferCollateralRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building transfer collateral: sub {} -> sub {}",
        req.from_subaccount_index,
        req.to_subaccount_index
    );

    let authority = parse_authority(&req.authority)?;

    // Validate subaccount indices (0 = cross-margin, 1-100 = isolated)
    if req.from_subaccount_index > 100 || req.to_subaccount_index > 100 {
        return Err(AppError::BadRequest(
            "subaccount indices must be between 0 and 100".to_string(),
        ));
    }
    if req.from_subaccount_index == req.to_subaccount_index {
        return Err(AppError::BadRequest(
            "from and to subaccount indices must be different".to_string(),
        ));
    }

    let src_pda = TraderKey::derive_pda(&authority, 0, req.from_subaccount_index);
    let dst_pda = TraderKey::derive_pda(&authority, 0, req.to_subaccount_index);

    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    let instructions = if let Some(amount_usdc) = req.amount_usdc {
        validate_amount(amount_usdc)?;
        builder
            .build_transfer_collateral(authority, src_pda, dst_pda, amount_usdc)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build transfer collateral: {}", e))
            })?
    } else {
        // Sweep all collateral — only valid for child→parent (to cross-margin)
        if req.to_subaccount_index != 0 {
            return Err(AppError::BadRequest(
                "amount_usdc is required when destination is not cross-margin (index 0)"
                    .to_string(),
            ));
        }
        builder
            .build_transfer_collateral_child_to_parent(authority, src_pda, dst_pda)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build transfer collateral: {}", e))
            })?
    };

    Ok(Json(serialize_instructions(
        instructions,
        format!(
            "Transfer collateral: sub {} -> sub {}",
            req.from_subaccount_index, req.to_subaccount_index
        ),
    )))
}

async fn register_subaccount(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterSubaccountRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building register subaccount: index {}",
        req.subaccount_index
    );

    validate_subaccount_index(req.subaccount_index)?;
    let authority = parse_authority(&req.authority)?;

    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    // Register the subaccount (index 0 = cross-margin, 1-100 = isolated)
    let mut instructions = builder
        .build_register_trader(authority, 0, req.subaccount_index)
        .map_err(|e| AppError::Phoenix(format!("Failed to build register trader: {}", e)))?;

    // For isolated subaccounts, sync parent capabilities to the new child
    if req.subaccount_index > 0 {
        let parent_pda = TraderKey::derive_pda(&authority, 0, 0);
        let child_pda = TraderKey::derive_pda(&authority, 0, req.subaccount_index);
        let sync_ixs = builder
            .build_sync_parent_to_child(authority, parent_pda, child_pda)
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build sync parent to child: {}", e))
            })?;
        instructions.extend(sync_ixs);
    }

    Ok(Json(serialize_instructions(
        instructions,
        format!("Register subaccount {}", req.subaccount_index),
    )))
}

// ---------------------------------------------------------------------------
// Multi-limit & cancel stop-loss handlers
// ---------------------------------------------------------------------------

fn parse_direction(s: &str) -> Result<Direction, AppError> {
    match s.to_lowercase().as_str() {
        "less_than" | "lessthan" | "lt" => Ok(Direction::LessThan),
        "greater_than" | "greaterthan" | "gt" => Ok(Direction::GreaterThan),
        _ => Err(AppError::BadRequest(format!(
            "Invalid direction: {}. Use less_than or greater_than",
            s
        ))),
    }
}

async fn place_multi_limit_orders(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MultiLimitOrderRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building multi-limit order: {} bids + {} asks on {}",
        req.bids.len(),
        req.asks.len(),
        req.symbol
    );

    if req.bids.is_empty() && req.asks.is_empty() {
        return Err(AppError::BadRequest(
            "At least one bid or ask is required".to_string(),
        ));
    }

    const MAX_ORDERS: usize = 10;
    let total = req.bids.len() + req.asks.len();
    if total > MAX_ORDERS {
        return Err(AppError::BadRequest(format!(
            "Too many orders: {} (max {}). Reduce to fit in a single Solana transaction.",
            total, MAX_ORDERS
        )));
    }

    for (i, bid) in req.bids.iter().enumerate() {
        validate_price(bid.price).map_err(|_| {
            AppError::BadRequest(format!("bids[{}]: price must be a positive finite number", i))
        })?;
        validate_size_lots(bid.size_lots).map_err(|_| {
            AppError::BadRequest(format!("bids[{}]: size_lots must be greater than 0", i))
        })?;
    }
    for (i, ask) in req.asks.iter().enumerate() {
        validate_price(ask.price).map_err(|_| {
            AppError::BadRequest(format!("asks[{}]: price must be a positive finite number", i))
        })?;
        validate_size_lots(ask.size_lots).map_err(|_| {
            AppError::BadRequest(format!("asks[{}]: size_lots must be greater than 0", i))
        })?;
    }

    let authority = parse_authority(&req.authority)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, 0);
    let slide = req.slide.unwrap_or(true);

    let bid_tuples: Vec<(f64, u64)> = req.bids.iter().map(|o| (o.price, o.size_lots)).collect();
    let ask_tuples: Vec<(f64, u64)> = req.asks.iter().map(|o| (o.price, o.size_lots)).collect();

    state.ensure_market(&req.symbol).await.map_err(|_| {
        AppError::BadRequest(format!("Unknown symbol: {}", req.symbol))
    })?;
    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    let instructions = builder
        .build_multi_limit_order(
            authority,
            trader_pda,
            &req.symbol,
            &bid_tuples,
            &ask_tuples,
            slide,
        )
        .map_err(|e| AppError::Phoenix(format!("Failed to build multi-limit order: {}", e)))?;

    let instructions = state.wrap_flight(instructions, authority);

    Ok(Json(serialize_instructions(
        instructions,
        format!(
            "Multi-limit order: {} bids + {} asks on {}",
            req.bids.len(),
            req.asks.len(),
            req.symbol
        ),
    )))
}

async fn cancel_stop_loss(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CancelStopLossRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building cancel stop-loss: {} direction {} on {}",
        req.authority,
        req.direction,
        req.symbol
    );

    let authority = parse_authority(&req.authority)?;
    let direction = parse_direction(&req.direction)?;
    let subaccount_index = req.subaccount_index.unwrap_or(0);
    validate_subaccount_index(subaccount_index)?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, subaccount_index);

    state.ensure_market(&req.symbol).await.map_err(|_| {
        AppError::BadRequest(format!("Unknown symbol: {}", req.symbol))
    })?;
    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    let instructions = builder
        .build_cancel_bracket_leg(authority, trader_pda, &req.symbol, direction)
        .map_err(|e| AppError::Phoenix(format!("Failed to build cancel stop-loss: {}", e)))?;

    Ok(Json(serialize_instructions(
        instructions,
        format!(
            "Cancel {} bracket leg on {}",
            req.direction, req.symbol
        ),
    )))
}

/// POST /api/tx/set-position-sltp — place (or replace) SL and/or TP triggers on
/// an existing open position. These are first-class position-conditional orders
/// (the same mechanism entry-time TP/SL uses), so they show + cancel through the
/// existing Positions UI and /cancel-stop-loss path. The position must already
/// be open; the conditional-orders account is created on-chain on first use.
async fn set_position_sltp(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SetPositionSlTpRequest>,
) -> Result<Json<TxResponse>, AppError> {
    tracing::info!(
        "Building set-position-sltp: {} {} sl={:?} tp={:?} on {}",
        req.authority,
        req.side,
        req.stop_loss_price,
        req.take_profit_price,
        req.symbol
    );

    let authority = parse_authority(&req.authority)?;
    let side = parse_side(&req.side)?;
    let subaccount_index = req.subaccount_index.unwrap_or(0);
    validate_subaccount_index(subaccount_index)?;
    let bracket = build_bracket(req.stop_loss_price, req.take_profit_price)?.ok_or_else(|| {
        AppError::BadRequest(
            "Provide at least one of stop_loss_price or take_profit_price".to_string(),
        )
    })?;
    let trader_pda = TraderKey::derive_pda(&authority, 0, subaccount_index);

    state
        .ensure_market(&req.symbol)
        .await
        .map_err(|_| AppError::BadRequest(format!("Unknown symbol: {}", req.symbol)))?;
    let metadata = state.metadata.read().await;
    let builder = PhoenixTxBuilder::new(&metadata);

    let mut instructions = Vec::new();

    // Position-conditional (trigger) orders live in a per-trader
    // `conditional_orders` account. It's created lazily on first use — if it
    // doesn't exist yet the place ix fails with InvalidAccountData, so we
    // prepend the create instruction when the account is absent.
    let cond_addr = get_conditional_orders_address(&trader_pda);
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet.solana.com".to_string());
    if crate::services::flight::get_account_data(&rpc_url, &cond_addr)
        .await
        .is_none()
    {
        let create_ixs = builder
            .build_create_conditional_orders_account(
                authority,
                authority,
                trader_pda,
                CONDITIONAL_ORDERS_CAPACITY,
            )
            .map_err(|e| {
                AppError::Phoenix(format!("Failed to build create-conditional-orders-account: {}", e))
            })?;
        instructions.extend(create_ixs);
    }

    append_bracket_legs(
        &mut instructions,
        &builder,
        authority,
        trader_pda,
        &req.symbol,
        side,
        &bracket,
    )?;

    // NOTE: do NOT Flight-wrap these — they're position-conditional triggers,
    // not fee-eligible placements. Builder fees apply to the entry/exit fills.

    Ok(Json(serialize_instructions(
        instructions,
        format!("Set SL/TP on {} position", req.symbol),
    )))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        // Cross-margin
        .route("/market-order", post(market_order))
        .route("/limit-order", post(limit_order))
        .route("/cancel-orders", post(cancel_orders))
        .route("/deposit", post(deposit))
        .route("/withdraw", post(withdraw))
        // Isolated margin
        .route("/isolated-market-order", post(isolated_market_order))
        .route("/isolated-limit-order", post(isolated_limit_order))
        // Collateral & subaccounts
        .route("/transfer-collateral", post(transfer_collateral))
        .route("/register-subaccount", post(register_subaccount))
        // Batch operations
        .route("/close-all-positions", post(close_all_positions))
        // Multi-limit & bracket management
        .route("/place-multi-limit-orders", post(place_multi_limit_orders))
        .route("/cancel-stop-loss", post(cancel_stop_loss))
        .route("/set-position-sltp", post(set_position_sltp))
}
