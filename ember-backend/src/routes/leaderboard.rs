use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct LeaderboardQuery {
    /// Page size for the active board (default 250, max 1000).
    pub limit: Option<usize>,
    /// Offset into the ranked active list (infinite scroll).
    pub offset: Option<usize>,
    /// Search across the FULL universe (active + dormant) by authority
    /// substring. When present, `limit`/`offset` are ignored.
    pub q: Option<String>,
}

/// GET /api/leaderboard — ranked active traders + aggregate stats.
///   ?limit=&offset=  paginate the active board
///   ?q=<substr>      search every registered wallet (incl. dormant)
async fn get_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(q): Query<LeaderboardQuery>,
) -> Json<serde_json::Value> {
    let snap = state.leaderboard.snapshot().await;

    if let Some(query) = q.q.as_ref().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
        // Full-universe search — match any authority (dormant included). Capped
        // so a 1-char query can't return 16k rows.
        let matches: Vec<_> = snap
            .traders
            .iter()
            .filter(|t| t.authority.to_lowercase().contains(&query))
            .take(100)
            .cloned()
            .collect();
        return Json(serde_json::json!({
            "stats": snap.stats,
            "traders": matches,
            "total": snap.stats.active_traders,
            "query": query,
            "generatedAt": snap.generated_at_ms,
            "stale": snap.stale,
            "error": snap.error,
        }));
    }

    // Default board: the active prefix, paginated.
    let limit = q.limit.unwrap_or(250).clamp(1, 1000);
    let offset = q.offset.unwrap_or(0);
    let active: Vec<_> = snap
        .traders
        .iter()
        .filter(|t| t.active)
        .skip(offset)
        .take(limit)
        .cloned()
        .collect();

    Json(serde_json::json!({
        "stats": snap.stats,
        "traders": active,
        "total": snap.stats.active_traders,
        "offset": offset,
        "limit": limit,
        "generatedAt": snap.generated_at_ms,
        "stale": snap.stale,
        "error": snap.error,
    }))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", get(get_leaderboard))
}
