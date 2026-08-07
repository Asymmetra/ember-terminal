use anyhow::{anyhow, Result};
use dashmap::DashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

use phoenix_rise::{ExchangeMarketConfig, PhoenixClient, PhoenixHttpClient, PhoenixMetadata};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

use crate::services::bbo_cache::BboCache;
use crate::services::broadcast::BroadcastHub;
use crate::services::flight::FlightConfig;
use crate::services::leaderboard::LeaderboardCache;
use crate::services::market_cache::MarketCache;

pub struct AppState {
    pub http_client: PhoenixHttpClient,
    pub ws_client: PhoenixClient,
    pub metadata: Arc<RwLock<PhoenixMetadata>>,
    pub market_cache: Arc<MarketCache>,
    /// Short-TTL Hawkeye BBO cache, backstopping the slippage cap when the
    /// realtime WS orderbook is empty.
    pub bbo_cache: Arc<BboCache>,
    pub broadcast: Arc<BroadcastHub>,
    pub markets: Arc<RwLock<Vec<ExchangeMarketConfig>>>,
    /// Tracks pubkeys with an active trader relay to prevent duplicates (BE-BUG-1).
    pub active_trader_relays: Arc<DashSet<String>>,
    /// Wallets we've seen via WS subscriptions. Used by /health/memory
    /// for ops monitoring and by the relay's auto-discovery logic.
    pub known_traders: Arc<DashSet<String>>,
    /// Flight builder-fee config (None = disabled; orders go out unwrapped).
    pub flight: Option<FlightConfig>,
    /// Community leaderboard — on-chain trader universe, scanned + ranked on a
    /// timer (see `main.rs`). Needs a getProgramAccounts-capable SOLANA_RPC_URL.
    pub leaderboard: Arc<LeaderboardCache>,
}

impl AppState {
    pub async fn new() -> Result<Self> {
        tracing::info!("Connecting to Phoenix via SDK...");

        // SDK reads PHOENIX_API_URL, PHOENIX_WS_URL, PHOENIX_API_KEY from env
        let http_client = PhoenixHttpClient::new_from_env()
            .map_err(|e| anyhow!("PhoenixHttpClient init failed: {:?}", e))?;

        // Fetch exchange config to verify connectivity and get market metadata
        let exchange = http_client.exchange().get_exchange().await?;
        let markets = exchange.markets.clone();
        let symbols: Vec<String> = markets.iter().map(|m| m.symbol.clone()).collect();
        tracing::info!("Found {} markets: {:?}", symbols.len(), symbols);

        // Build metadata for tx builder
        let metadata = PhoenixMetadata::new(exchange.into());

        // Create SDK high-level client — manages the WS connection with
        // auto-reconnect and automatic resubscription. The low-level
        // PhoenixWSClient has no reconnect; using it directly left us
        // zombied after the first upstream disconnect.
        let ws_client = PhoenixClient::new_from_env()
            .await
            .map_err(|e| anyhow!("PhoenixClient init failed: {:?}", e))?;

        let market_cache = Arc::new(MarketCache::new());
        let broadcast = Arc::new(BroadcastHub::new(&symbols));

        // Load known traders from disk (populated by the relay as WS
        // subscriptions arrive; persisted across restarts so the
        // /health/memory counter doesn't reset on every redeploy).
        let known_traders = Arc::new(DashSet::new());
        let traders_path = std::path::Path::new("known_traders.json");
        if traders_path.exists() {
            match std::fs::read_to_string(traders_path) {
                Ok(contents) => {
                    if let Ok(list) = serde_json::from_str::<Vec<String>>(&contents) {
                        let count = list.len();
                        for pubkey in list {
                            known_traders.insert(pubkey);
                        }
                        tracing::info!("Loaded {} known traders from disk", count);
                    }
                }
                Err(e) => tracing::warn!("Failed to read known_traders.json: {}", e),
            }
        }

        // Flight builder fees — None unless FLIGHT_BUILDER_AUTHORITY is set AND
        // the builder is actually registered on-chain. The on-chain guard means
        // setting the env before registration is harmless (orders stay
        // unwrapped) rather than breaking every order against a missing builder.
        let flight = match FlightConfig::from_env() {
            None => {
                tracing::info!("Flight builder fees disabled (FLIGHT_BUILDER_AUTHORITY unset)");
                None
            }
            Some(mut f) => {
                let rpc = std::env::var("SOLANA_RPC_URL")
                    .unwrap_or_else(|_| "https://solana.publicnode.com".to_string());
                // Bound the startup RPC check so a slow/hung endpoint can't stall
                // the server bind (Render cold start). On timeout, leave Flight
                // disabled — same outcome as the "not registered" path.
                let check = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    f.registered_fee_bps(&rpc),
                )
                .await;
                match check {
                    Ok(Some(fee_bps)) => {
                        f.set_fee_bps(fee_bps); // trust the on-chain rate over env
                        tracing::info!("Flight builder registered on-chain — fees ACTIVE ({fee_bps}bps)");
                        Some(f)
                    }
                    Ok(None) => {
                        tracing::warn!(
                            "FLIGHT_BUILDER_AUTHORITY set but the builder is NOT registered on Flight \
                             (or the RPC check failed) — builder fees DISABLED until it's registered \
                             and the service restarts"
                        );
                        None
                    }
                    Err(_) => {
                        tracing::warn!(
                            "Flight registration check timed out (3s) — builder fees DISABLED until \
                             restart; server still binds"
                        );
                        None
                    }
                }
            }
        };

        // Community leaderboard cache. The trader-universe scan
        // (getProgramAccounts over ~16k accounts) is heavy and any single free
        // RPC handles it only intermittently, so we give it a failover chain:
        // a dedicated SOLANA_RPC_URL first (if set — most reliable), then public
        // endpoints that empirically serve this call (api.mainnet.solana.com is
        // fastest; publicnode + mainnet-beta as further fallbacks). Extra keyed
        // endpoints can be appended via SOLANA_RPC_FALLBACKS (comma-separated)
        // — e.g. drpc/ankr URLs that require an API key. The cache starts
        // empty/stale and is populated by the background refresh in main.rs.
        let mut rpc_urls: Vec<String> = Vec::new();
        let push_unique = |urls: &mut Vec<String>, u: String| {
            let u = u.trim().to_string();
            if !u.is_empty() && !urls.contains(&u) {
                urls.push(u);
            }
        };
        if let Ok(u) = std::env::var("SOLANA_RPC_URL") {
            push_unique(&mut rpc_urls, u);
        }
        for d in [
            "https://api.mainnet.solana.com",
            "https://solana.publicnode.com",
            "https://api.mainnet-beta.solana.com",
        ] {
            push_unique(&mut rpc_urls, d.to_string());
        }
        if let Ok(extra) = std::env::var("SOLANA_RPC_FALLBACKS") {
            for u in extra.split(',') {
                push_unique(&mut rpc_urls, u.to_string());
            }
        }
        tracing::info!("Leaderboard RPC failover chain: {} endpoint(s)", rpc_urls.len());
        let enrich_top = std::env::var("LEADERBOARD_ENRICH_TOP")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(200);
        let leaderboard = Arc::new(LeaderboardCache::new(rpc_urls, enrich_top));

        Ok(Self {
            http_client,
            ws_client,
            metadata: Arc::new(RwLock::new(metadata)),
            market_cache,
            bbo_cache: Arc::new(BboCache::new()),
            broadcast,
            markets: Arc::new(RwLock::new(markets)),
            active_trader_relays: Arc::new(DashSet::new()),
            known_traders,
            flight,
            leaderboard,
        })
    }

    /// Wrap order-placement instructions in a Flight proxy (builder fee) when
    /// Flight is configured; otherwise return them unchanged. Safe to call on
    /// any instruction set — non-order ixs pass through.
    pub fn wrap_flight(&self, ixs: Vec<Instruction>, trader_authority: Pubkey) -> Vec<Instruction> {
        match &self.flight {
            Some(f) => f.wrap(ixs, trader_authority),
            None => ixs,
        }
    }

    /// Re-fetch exchange config from Phoenix API and update metadata + markets.
    pub async fn refresh_metadata(&self) -> Result<()> {
        let exchange = self.http_client.exchange().get_exchange().await?;
        let new_markets = exchange.markets.clone();
        let symbols: Vec<String> = new_markets.iter().map(|m| m.symbol.clone()).collect();
        let new_metadata = PhoenixMetadata::new(exchange.into());

        {
            let mut metadata = self.metadata.write().await;
            *metadata = new_metadata;
        }
        {
            let mut markets = self.markets.write().await;
            *markets = new_markets;
        }

        tracing::info!("Metadata refreshed — {} markets: {:?}", symbols.len(), symbols);
        Ok(())
    }

    /// Look up a market symbol; if not found, refresh metadata once and retry.
    pub async fn ensure_market(&self, symbol: &str) -> Result<()> {
        {
            let metadata = self.metadata.read().await;
            if metadata.get_market(symbol).is_some() {
                return Ok(());
            }
        }
        tracing::info!("Market '{}' not found — refreshing metadata", symbol);
        self.refresh_metadata().await?;
        {
            let metadata = self.metadata.read().await;
            metadata
                .get_market(symbol)
                .ok_or_else(|| anyhow::anyhow!("Unknown symbol after refresh: {}", symbol))?;
        }
        Ok(())
    }

    pub async fn shutdown(&self) {
        self.ws_client.shutdown();
        tracing::info!("AppState shutdown complete");
    }
}
