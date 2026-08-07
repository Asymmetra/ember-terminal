use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use std::sync::Arc;

use crate::state::AppState;

/// GET /api/trades/:symbol/recent — Recent market trades from relay buffer
async fn get_recent_trades(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Json<serde_json::Value> {
    let trades = state.market_cache.get_recent_trades(&symbol);
    Json(serde_json::json!({ "trades": trades }))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/{symbol}/recent", get(get_recent_trades))
}
