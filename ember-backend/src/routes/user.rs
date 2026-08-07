//! Wallet-level ("user") views.
//!
//! Phoenix distinguishes a **trader** (one PDA/subaccount) from a **user** (the
//! wallet authority that owns them all). `/api/trader/:pubkey/*` answers "how is
//! this subaccount doing"; the routes here answer "how is this *wallet* doing"
//! by aggregating every subaccount server-side.
//!
//! This matters because a trader running isolated positions has one PDA per
//! market. Summing those client-side means N requests and an easy off-by-one
//! when a new subaccount appears mid-session — Phoenix already does the
//! aggregation, so prefer these when you want a portfolio-level number.

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use solana_pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;

use crate::error::AppError;
use crate::state::AppState;
use phoenix_rise::types::funding::FundingHourlyQuery;
use phoenix_rise::types::trader_http::{
    PnlQueryParams, PnlResolution, UserLiquidationHistoryQueryParams,
};
use phoenix_rise::types::trades::TradeHistoryQueryParams;

fn parse_pubkey(s: &str) -> Result<Pubkey, AppError> {
    Pubkey::from_str(s).map_err(|e| AppError::BadRequest(format!("Invalid pubkey: {}", e)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PnlQuery {
    resolution: Option<String>,
    start_time: Option<i64>,
    end_time: Option<i64>,
    limit: Option<i64>,
}

/// GET /api/user/:pubkey/pnl — PnL across every subaccount this wallet owns.
async fn get_user_pnl(
    State(state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
    Query(q): Query<PnlQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = parse_pubkey(&pubkey)?;

    // Accept the same resolution strings Phoenix's API uses on the wire.
    let resolution = match q.resolution.as_deref().unwrap_or("1d") {
        "1m" => PnlResolution::Minute1,
        "5m" => PnlResolution::Minute5,
        "15m" => PnlResolution::Minute15,
        "1h" => PnlResolution::Hour1,
        "4h" => PnlResolution::Hour4,
        "1d" => PnlResolution::Day1,
        "1w" => PnlResolution::Week1,
        "1M" => PnlResolution::Month1,
        other => {
            return Err(AppError::BadRequest(format!(
                "Unknown resolution '{}' (expected one of 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M)",
                other
            )));
        }
    };

    let mut params = PnlQueryParams::new(resolution);
    params.start_time = q.start_time;
    params.end_time = q.end_time;
    params.limit = Some(q.limit.unwrap_or(500).clamp(1, 1000));

    let points = state
        .http_client
        .get_user_pnl(&authority, params)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch user PnL: {}", e)))?;

    Ok(Json(serde_json::json!({
        "authority": pubkey,
        "pnl": points,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    limit: Option<i64>,
    cursor: Option<String>,
    market_symbol: Option<String>,
}

/// GET /api/user/:pubkey/liquidations — liquidation history for the wallet.
///
/// There is no trader-scoped equivalent worth using: liquidations are what you
/// most want to see across the whole account, not per subaccount.
async fn get_user_liquidations(
    State(state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = parse_pubkey(&pubkey)?;

    let params = UserLiquidationHistoryQueryParams {
        symbol: q.market_symbol,
        limit: Some(q.limit.unwrap_or(100).clamp(1, 100)),
        cursor: q.cursor,
        ..Default::default()
    };

    let response = state
        .http_client
        .get_user_liquidation_history(&authority, params)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch liquidation history: {}", e)))?;

    Ok(Json(serde_json::json!({
        "authority": pubkey,
        "liquidations": response,
    })))
}

/// GET /api/user/:pubkey/trades — fills across every subaccount.
async fn get_user_trades(
    State(state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = parse_pubkey(&pubkey)?;

    let limit = q.limit.unwrap_or(100).clamp(1, 1000);
    let mut params = TradeHistoryQueryParams::new().with_limit(limit);
    if let Some(c) = q.cursor {
        params = params.with_cursor(c);
    }
    if let Some(m) = q.market_symbol {
        params = params.with_market_symbol(m);
    }

    let response = state
        .http_client
        .get_user_trade_history(&authority, params)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch user trade history: {}", e)))?;

    Ok(Json(serde_json::json!({
        "authority": pubkey,
        "trades": response.data,
        "has_more": response.has_more,
        "next_cursor": response.next_cursor,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HourlyFundingQuery {
    limit: Option<i64>,
    cursor: Option<String>,
    market_symbol: Option<String>,
}

/// GET /api/user/:pubkey/funding-hourly — funding paid/received, bucketed hourly.
///
/// Useful for attributing PnL: a position that looks flat on price can still be
/// bleeding funding, and this is the series that shows it.
async fn get_user_funding_hourly(
    State(state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
    Query(q): Query<HourlyFundingQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = parse_pubkey(&pubkey)?;

    let params = FundingHourlyQuery {
        symbol: q.market_symbol,
        // 168 = one week of hourly buckets.
        limit: Some(q.limit.unwrap_or(168).clamp(1, 1000)),
        cursor: q.cursor,
        ..Default::default()
    };

    let response = state
        .http_client
        .get_user_hourly_funding_history(&authority, params)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch hourly funding: {}", e)))?;

    Ok(Json(serde_json::json!({
        "authority": pubkey,
        "funding": response,
    })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/{pubkey}/pnl", get(get_user_pnl))
        .route("/{pubkey}/liquidations", get(get_user_liquidations))
        .route("/{pubkey}/trades", get(get_user_trades))
        .route("/{pubkey}/funding-hourly", get(get_user_funding_hourly))
}
