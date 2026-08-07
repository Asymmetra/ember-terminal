use anyhow::Result;
use axum::{routing::get, Router};
use std::sync::Arc;
use tokio::net::TcpListener;
use axum::http::{HeaderValue, Method};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod config;
mod error;
mod phoenix;
mod routes;
mod services;
mod state;
mod ws;

use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("ember_backend=info".parse()?),
        )
        .init();

    tracing::info!("Starting Ember Terminal backend...");

    let state = AppState::new().await?;
    let state = Arc::new(state);

    // Start the market data relay (SDK WS subscriptions)
    let relay_symbols = {
        let markets = state.markets.read().await;
        markets.iter().map(|m| m.symbol.clone()).collect::<Vec<_>>()
    };
    ws::relay::start_relay(
        state.ws_client.clone(),
        state.market_cache.clone(),
        state.broadcast.clone(),
        relay_symbols,
        Some(state.known_traders.clone()),
    )
    .await;

    // Periodic metadata refresh (every 5 minutes)
    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
            interval.tick().await; // skip immediate first tick
            loop {
                interval.tick().await;
                if let Err(e) = state.refresh_metadata().await {
                    tracing::warn!("Metadata refresh failed: {}", e);
                }
            }
        });
    }

    // Community leaderboard refresh. One getProgramAccounts scan of the trader
    // universe + bounded REST enrichment, cached in memory. Runs once at
    // startup then on an interval (LEADERBOARD_REFRESH_SECS, default 180).
    {
        let state = state.clone();
        let secs = std::env::var("LEADERBOARD_REFRESH_SECS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(180);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(secs));
            loop {
                interval.tick().await;
                state.leaderboard.refresh(&state.http_client).await;
            }
        });
    }

    let cors = {
        let allowed_origins = std::env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:3000".to_string());
        let origins: Vec<HeaderValue> = allowed_origins
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        tracing::info!("CORS allowed origins: {:?}", origins);
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(Any)
    };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/health/ws", get({
            let state = state.clone();
            move || {
                let state = state.clone();
                async move {
                    let markets = state.markets.read().await;
                    let symbols: Vec<String> = markets.iter().map(|m| m.symbol.clone()).collect();
                    drop(markets);

                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;

                    let mut stale = Vec::new();
                    let mut fresh = Vec::new();
                    for sym in &symbols {
                        if let Some(snap) = state.market_cache.get_orderbook(sym) {
                            let age_secs = (now_ms - snap.timestamp) / 1000;
                            if age_secs > 120 {
                                stale.push(serde_json::json!({"symbol": sym, "age_secs": age_secs}));
                            } else {
                                fresh.push(serde_json::json!({"symbol": sym, "age_secs": age_secs}));
                            }
                        } else {
                            stale.push(serde_json::json!({"symbol": sym, "age_secs": null}));
                        }
                    }

                    let healthy = stale.is_empty();
                    let status = if healthy { "ok" } else { "degraded" };

                    axum::Json(serde_json::json!({
                        "status": status,
                        "fresh": fresh.len(),
                        "stale": stale.len(),
                        "stale_markets": stale,
                    }))
                }
            }
        }))
        .route("/health/memory", get({
            // Memory observability endpoint. Read process RSS from /proc on
            // Linux (Render is Linux containers) and report sizes of every
            // in-memory data structure that could plausibly grow without
            // bound. If RSS climbs but the structures stay flat, the leak is
            // in something we don't own (likely the phoenix-rise SDK's
            // internal state — exchange_cache or subscription registry).
            let state = state.clone();
            move || {
                let state = state.clone();
                async move {
                    fn read_rss_kb() -> Option<u64> {
                        let s = std::fs::read_to_string("/proc/self/status").ok()?;
                        for line in s.lines() {
                            if let Some(rest) = line.strip_prefix("VmRSS:") {
                                return rest.split_whitespace().next()?.parse::<u64>().ok();
                            }
                        }
                        None
                    }
                    fn read_vmsize_kb() -> Option<u64> {
                        let s = std::fs::read_to_string("/proc/self/status").ok()?;
                        for line in s.lines() {
                            if let Some(rest) = line.strip_prefix("VmSize:") {
                                return rest.split_whitespace().next()?.parse::<u64>().ok();
                            }
                        }
                        None
                    }
                    let rss_kb = read_rss_kb();
                    let vmsize_kb = read_vmsize_kb();
                    let market_cache = state.market_cache.sizes();
                    let by_prefix = state.broadcast.subscribers_by_prefix();
                    axum::Json(serde_json::json!({
                        "process": {
                            "rss_mb": rss_kb.map(|k| k as f64 / 1024.0),
                            "vm_size_mb": vmsize_kb.map(|k| k as f64 / 1024.0),
                        },
                        "broadcast": {
                            "channels": state.broadcast.channel_count(),
                            "subscribers_total": state.broadcast.total_subscribers(),
                            "subscribers_by_prefix": by_prefix,
                        },
                        "market_cache": market_cache,
                        "active_trader_relays": state.active_trader_relays.len(),
                        "known_traders": state.known_traders.len(),
                    }))
                }
            }
        }))
        .route("/health/relay", get({
            let state = state.clone();
            move || {
                let state = state.clone();
                async move {
                    let markets = state.markets.read().await;
                    let symbols: Vec<String> = markets.iter().map(|m| m.symbol.clone()).collect();
                    drop(markets);

                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;

                    let statuses = state.market_cache.relay_status(&symbols);
                    let mut dead_channels: Vec<serde_json::Value> = Vec::new();
                    for s in &statuses {
                        for (ch, ts) in [
                            ("orderbook", s.orderbook_last_ms),
                            ("trades", s.trades_last_ms),
                            ("stats", s.stats_last_ms),
                            ("candles", s.candles_last_ms),
                        ] {
                            match ts {
                                Some(t) if (now_ms - t) > 300_000 => {
                                    dead_channels.push(serde_json::json!({
                                        "symbol": s.symbol, "channel": ch,
                                        "age_secs": (now_ms - t) / 1000
                                    }));
                                }
                                None => {
                                    dead_channels.push(serde_json::json!({
                                        "symbol": s.symbol, "channel": ch,
                                        "age_secs": null
                                    }));
                                }
                                _ => {}
                            }
                        }
                    }

                    let status = if dead_channels.is_empty() { "ok" } else { "degraded" };
                    axum::Json(serde_json::json!({
                        "status": status,
                        "dead_channels": dead_channels.len(),
                        "dead": dead_channels,
                        "all": statuses,
                    }))
                }
            }
        }))
        .nest("/api", routes::api_router())
        .route("/ws", get(ws::handler::ws_upgrade))
        .with_state(state.clone())
        .layer(cors)
        // gzip/br-compress JSON responses (leaderboard, markets, orderbook, etc.).
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    let cfg = config::AppConfig::from_env();
    let addr = format!("0.0.0.0:{}", cfg.port);
    tracing::info!("Listening on {}", addr);
    let listener = TcpListener::bind(&addr).await?;

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("Shutting down...");
    state.shutdown().await;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for ctrl+c");
    tracing::info!("Received shutdown signal");
}
