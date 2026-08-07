use axum::Router;
use std::sync::Arc;

use crate::state::AppState;

pub mod candles;
pub mod flight;
pub mod leaderboard;
pub mod markets;
pub mod onboarding;
pub mod orderbook;
pub mod trade;
pub mod trader;
pub mod trades;
pub mod view;

pub fn api_router() -> Router<Arc<AppState>> {
    Router::new()
        .nest("/markets", markets::router())
        .nest("/orderbook", orderbook::router())
        .nest("/candles", candles::router())
        .nest("/trades", trades::router())
        .nest("/trader", trader::router())
        .nest("/tx", trade::router())
        .nest("/onboard", onboarding::router())
        .nest("/flight", flight::router())
        .nest("/leaderboard", leaderboard::router())
        .nest("/view", view::router())
}
