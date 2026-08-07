use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;

use crate::error::AppError;
use crate::phoenix::types::MarketInfo;
use crate::state::AppState;
use phoenix_rise::types::funding::FundingRateHistoryQuery;

async fn list_markets(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<MarketInfo>>, AppError> {
    let markets = state.markets.read().await;
    let result: Vec<MarketInfo> = markets.iter().map(MarketInfo::from).collect();
    Ok(Json(result))
}

async fn get_market(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<Json<MarketInfo>, AppError> {
    let markets = state.markets.read().await;
    let market = markets
        .iter()
        .find(|m| m.symbol.eq_ignore_ascii_case(&symbol))
        .ok_or_else(|| AppError::MarketNotFound(symbol.clone()))?;

    Ok(Json(MarketInfo::from(market)))
}

/// GET /api/markets/:symbol/calendar — trading hours for the market.
///
/// Perps trade continuously, but Phoenix's real-world-asset markets (equities,
/// commodities) follow the underlying venue's session calendar. A client that
/// ignores this will happily submit an order into a closed market and get a
/// confusing on-chain rejection, so surface the calendar and gate the UI on it.
async fn get_calendar(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let calendar = state
        .http_client
        .get_market_calendar(&symbol)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch market calendar: {}", e)))?;

    Ok(Json(serde_json::json!({
        "symbol": symbol,
        "calendar": calendar,
    })))
}

/// GET /api/markets/:symbol/calendar/next — the next open/close transition.
///
/// Cheaper than the full calendar when all you need is a "closes in 12m" badge
/// or a countdown before the session flips.
async fn get_calendar_next(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let next = state
        .http_client
        .get_next_market_calendar_transition(&symbol)
        .await
        .map_err(|e| {
            AppError::Phoenix(format!("Failed to fetch next calendar transition: {}", e))
        })?;

    Ok(Json(serde_json::json!({
        "symbol": symbol,
        "next": next,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingQuery {
    start_time: Option<i64>,
    end_time: Option<i64>,
    limit: Option<i64>,
}

/// GET /api/markets/:symbol/funding — market-wide funding rate history.
///
/// Distinct from `/api/trader/:pubkey/funding`, which is what a specific trader
/// actually paid or received. This is the market's published rate over time —
/// what you chart to show whether longs or shorts are paying.
async fn get_market_funding(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
    Query(q): Query<FundingQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let params = FundingRateHistoryQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        limit: Some(q.limit.unwrap_or(100).clamp(1, 1000)),
    };

    let history = state
        .http_client
        .get_market_funding_rate_history(&symbol, params)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch funding rate history: {}", e)))?;

    Ok(Json(serde_json::json!({
        "symbol": symbol,
        "funding": history,
    })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_markets))
        .route("/{symbol}", get(get_market))
        .route("/{symbol}/calendar", get(get_calendar))
        .route("/{symbol}/calendar/next", get(get_calendar_next))
        .route("/{symbol}/funding", get(get_market_funding))
}
