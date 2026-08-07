use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use std::sync::Arc;

use crate::error::AppError;
use crate::phoenix::types::OrderbookSnapshot;
use crate::state::AppState;

async fn get_orderbook(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<Json<OrderbookSnapshot>, AppError> {
    if let Some(cached) = state.market_cache.get_orderbook(&symbol) {
        return Ok(Json(cached));
    }

    Err(AppError::MarketNotFound(format!(
        "No orderbook data for {}",
        symbol
    )))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/{symbol}", get(get_orderbook))
}
