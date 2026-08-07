use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use dashmap::DashMap;
use phoenix_rise::types::candles::{CandlesQueryParams, Timeframe};
use serde::Deserialize;
use std::str::FromStr;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::state::AppState;

/// Short TTL for the "live" candles query (no `before`), which the chart
/// re-polls every few seconds with the same params. Historical pages are not
/// cached (per-unique-range → would bloat the map). The key space here is just
/// (symbol × timeframe × limit), so it stays small and bounded.
const CANDLE_TTL: Duration = Duration::from_secs(2);
/// Hard cap on cached entries. `limit` is caller-controlled (1..=1000), so the
/// key space isn't truly tiny — cap + prune keeps memory bounded under abuse.
const MAX_CANDLE_CACHE_ENTRIES: usize = 512;

fn candle_cache() -> &'static DashMap<String, (Instant, serde_json::Value)> {
    static C: OnceLock<DashMap<String, (Instant, serde_json::Value)>> = OnceLock::new();
    C.get_or_init(DashMap::new)
}

#[derive(Deserialize)]
pub struct CandleQuery {
    pub timeframe: Option<String>,
    pub limit: Option<u32>,
    /// Upper bound (exclusive) in ms for the returned candles. Used by the
    /// client to page backward through history when the user scrolls left.
    pub before: Option<i64>,
}

async fn get_candles(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
    Query(query): Query<CandleQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tf_str = query
        .timeframe
        .unwrap_or_else(|| "1m".to_string())
        .to_lowercase();
    let limit = query.limit.unwrap_or(300).min(1000);

    let timeframe = Timeframe::from_str(&tf_str)
        .map_err(|e| AppError::BadRequest(format!("Invalid timeframe: {}", e)))?;

    // Cache only the live query (no `before`) — the hot path the chart re-polls.
    // Normalize the symbol's case (the SDK uppercases before hitting Phoenix) so
    // `sol`/`SOL`/`sOl` share one entry rather than amplifying the key space.
    let cache_key = query
        .before
        .is_none()
        .then(|| format!("{}|{tf_str}|{limit}", symbol.to_uppercase()));
    if let Some(key) = &cache_key {
        if let Some(hit) = candle_cache().get(key) {
            if hit.0.elapsed() < CANDLE_TTL {
                return Ok(Json(hit.1.clone()));
            }
        }
    }

    let mut params = CandlesQueryParams::new(&symbol, timeframe).with_limit(limit);
    if let Some(before_ms) = query.before {
        params = params.with_end_time(before_ms);
    }

    let candles = state
        .http_client
        .candles()
        .get_candles(params)
        .await
        .map_err(|e| AppError::Phoenix(format!("Failed to fetch candles: {}", e)))?;

    let value = serde_json::json!(candles);
    if let Some(key) = cache_key {
        let cache = candle_cache();
        // Bound memory: drop expired entries before inserting once we hit the
        // cap. Self-healing and cheap; prevents unbounded growth from enumerated
        // `limit`/symbol-case variants on this public endpoint.
        if cache.len() >= MAX_CANDLE_CACHE_ENTRIES {
            cache.retain(|_, v| v.0.elapsed() < CANDLE_TTL);
        }
        cache.insert(key, (Instant::now(), value.clone()));
    }
    Ok(Json(value))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/{symbol}", get(get_candles))
}
