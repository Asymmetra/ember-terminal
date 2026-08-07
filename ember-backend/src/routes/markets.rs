use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use std::sync::Arc;

use crate::error::AppError;
use crate::phoenix::types::MarketInfo;
use crate::state::AppState;

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

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_markets))
        .route("/{symbol}", get(get_market))
}
