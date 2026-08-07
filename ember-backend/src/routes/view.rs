//! Hawkeye read-only "view" endpoints (phoenix-rise 0.1.10).
//!
//! Each handler simulates a Phoenix Hawkeye view instruction against
//! `SOLANA_RPC_URL` (via `PhoenixHawkeyeClient`, which sets `sig_verify=false` +
//! `replace_recent_blockhash`, so no signature and no state mutation) and decodes
//! the program's return data into protocol-exact margin / liquidation / BBO
//! values. These replace off-chain risk approximations in the frontend.
//!
//! Values come back in raw protocol units (quote-lots, ticks); we convert to
//! USD (quote-lots ÷ 1e6, matching the leaderboard) and price (via the market's
//! `MarketCalculator::ticks_to_price`) so the client consumes human values.
//!
//! These endpoints are additive and read-only — they don't touch any existing
//! trading path. The frontend wiring (and the slippage-cap rewrite) build on
//! top of them.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use phoenix_rise::math::Ticks;
use phoenix_rise::core::PhoenixHawkeyeClient;
use serde::Deserialize;
use solana_pubkey::Pubkey;

use crate::error::AppError;
use crate::state::AppState;

/// USDC has 6 decimals; quote-lots are denominated in it (same constant the
/// leaderboard uses).
const QUOTE_LOT_DECIMALS: i32 = 6;

fn ql_to_usd(lots: i64) -> f64 {
    lots as f64 / 10f64.powi(QUOTE_LOT_DECIMALS)
}

fn rpc_url() -> Result<String, AppError> {
    std::env::var("SOLANA_RPC_URL")
        .map_err(|_| AppError::Phoenix("SOLANA_RPC_URL not configured".into()))
}

#[derive(Deserialize)]
struct MarginQuery {
    authority: String,
    #[serde(default)]
    subaccount_index: u8,
}

/// GET /api/view/margin?authority=…&subaccount_index=0
/// Protocol-exact account margin: collateral, free/effective/withdrawable
/// collateral, initial/maintenance margin, uPnL, unsettled funding.
async fn view_margin(
    State(state): State<Arc<AppState>>,
    Query(q): Query<MarginQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = Pubkey::from_str(&q.authority)
        .map_err(|e| AppError::BadRequest(format!("invalid authority: {e}")))?;

    let metadata = state.metadata.read().await;
    let client = PhoenixHawkeyeClient::new(rpc_url()?, &metadata);
    let m = client
        .view_margin(authority, 0, q.subaccount_index)
        .await
        .map_err(|e| AppError::Phoenix(format!("view_margin sim failed: {e}")))?
        .value;

    Ok(Json(serde_json::json!({
        "authority": q.authority,
        "subaccountIndex": q.subaccount_index,
        "positionCount": m.position_count,
        "isLiquidatable": m.is_liquidatable != 0,
        "riskState": m.risk_state,
        "riskTier": m.risk_tier,
        "collateralUsd": ql_to_usd(m.collateral_quote_lots),
        "effectiveCollateralUsd": ql_to_usd(m.effective_collateral_quote_lots),
        "freeCollateralUsd": ql_to_usd(m.free_collateral_quote_lots),
        "withdrawableCollateralUsd": ql_to_usd(m.withdrawable_collateral_quote_lots as i64),
        "initialMarginUsd": ql_to_usd(m.initial_margin_quote_lots as i64),
        "maintenanceMarginUsd": ql_to_usd(m.maintenance_margin_quote_lots as i64),
        "unrealizedPnlUsd": ql_to_usd(m.unrealized_pnl_quote_lots),
        "discountedUnrealizedPnlUsd": ql_to_usd(m.discounted_unrealized_pnl_quote_lots),
        "unsettledFundingUsd": ql_to_usd(m.unsettled_funding_quote_lots),
    })))
}

#[derive(Deserialize)]
struct LiqQuery {
    authority: String,
    symbol: String,
    #[serde(default)]
    subaccount_index: u8,
}

/// GET /api/view/liquidation-price?authority=…&symbol=SOL&subaccount_index=0
/// Protocol-exact liquidation price for the trader's CURRENT position in
/// `symbol` (accounts for the real per-asset maintenance schedule + cross
/// portfolio). `status`/`side` come straight from the program.
async fn view_liquidation_price(
    State(state): State<Arc<AppState>>,
    Query(q): Query<LiqQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = Pubkey::from_str(&q.authority)
        .map_err(|e| AppError::BadRequest(format!("invalid authority: {e}")))?;
    let symbol = q.symbol.to_ascii_uppercase();

    let metadata = state.metadata.read().await;
    let asset_id = metadata
        .get_market(&symbol)
        .map(|m| m.asset_id)
        .ok_or_else(|| AppError::BadRequest(format!("unknown market {symbol}")))?;

    let client = PhoenixHawkeyeClient::new(rpc_url()?, &metadata);
    let r = client
        .view_liquidation_price(authority, 0, q.subaccount_index, asset_id)
        .await
        .map_err(|e| AppError::Phoenix(format!("view_liquidation_price sim failed: {e}")))?
        .value;

    let calc = metadata
        .get_market_calculator(&symbol)
        .ok_or_else(|| AppError::Phoenix(format!("no market calculator for {symbol}")))?;

    Ok(Json(serde_json::json!({
        "authority": q.authority,
        "symbol": symbol,
        "subaccountIndex": q.subaccount_index,
        "assetId": r.asset_id,
        "status": r.status,
        "side": r.side,
        "liquidationPrice": calc.ticks_to_price(Ticks::new_saturating(r.liquidation_price_ticks)),
        "markPrice": calc.ticks_to_price(Ticks::new_saturating(r.mark_price_ticks)),
        "effectiveCollateralUsd": ql_to_usd(r.effective_collateral_quote_lots),
        "maintenanceMarginUsd": ql_to_usd(r.maintenance_margin_quote_lots as i64),
        "entryPriceQuoteLotsPerBaseLot": r.entry_price_quote_lots_per_base_lot,
    })))
}

/// GET /api/view/bbo/:symbol
/// Protocol-exact best bid/ask + mark/index prices straight from the program's
/// orderbook view (no aggregation lag, no tick rounding).
async fn view_bbo(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let symbol = symbol.to_ascii_uppercase();

    let metadata = state.metadata.read().await;
    if metadata.get_market(&symbol).is_none() {
        return Err(AppError::BadRequest(format!("unknown market {symbol}")));
    }

    let client = PhoenixHawkeyeClient::new(rpc_url()?, &metadata);
    let r = client
        .view_bbo(&symbol)
        .await
        .map_err(|e| AppError::Phoenix(format!("view_bbo sim failed: {e}")))?
        .value;

    let calc = metadata
        .get_market_calculator(&symbol)
        .ok_or_else(|| AppError::Phoenix(format!("no market calculator for {symbol}")))?;

    Ok(Json(serde_json::json!({
        "symbol": symbol,
        // Flag-gated accessors: an absent book side serializes as null, not the
        // raw 0-tick field (which would convert to a misleading price of 0).
        "bestBid": r.best_bid_ticks().map(|t| calc.ticks_to_price(Ticks::new_saturating(t))),
        "bestAsk": r.best_ask_ticks().map(|t| calc.ticks_to_price(Ticks::new_saturating(t))),
        "markPrice": calc.ticks_to_price(Ticks::new_saturating(r.mark_price_ticks)),
        "indexPrice": calc.ticks_to_price(Ticks::new_saturating(r.index_price_ticks)),
        "markPriceLastUpdatedSlot": r.mark_price_last_updated_slot,
        "indexPriceLastUpdatedSlot": r.index_price_last_updated_slot,
    })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/margin", get(view_margin))
        .route("/liquidation-price", get(view_liquidation_price))
        .route("/bbo/{symbol}", get(view_bbo))
}
