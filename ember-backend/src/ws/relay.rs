use crate::phoenix::types::{OrderbookLevel, WsServerMessage};
use crate::services::broadcast::BroadcastHub;
use crate::services::market_cache::MarketCache;
use phoenix_rise::{
    PhoenixClient, PhoenixClientEvent, PhoenixSubscription, SubscriptionKey, Timeframe,
};
use solana_pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// known_traders.json persist debouncer.
///
/// Originally we wrote the file synchronously on every newly-discovered
/// trader, on the same async task that consumes Phoenix's UnboundedReceiver
/// of market events. On Render's network-attached disk a fs::write can
/// take 100–500ms; while it's blocked, events accumulate in the unbounded
/// channel and memory grows. Multiply by 19 market relays and that's a
/// real OOM driver.
///
/// New behavior: schedule at most one persist per PERSIST_DEBOUNCE_MS,
/// off the hot path via tokio::task::spawn_blocking. If multiple new
/// traders are discovered in quick succession, they coalesce into one
/// write.
const PERSIST_DEBOUNCE_MS: i64 = 5_000;
static LAST_PERSIST_MS: AtomicI64 = AtomicI64::new(0);

fn schedule_known_traders_persist(known: Arc<dashmap::DashSet<String>>) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let last = LAST_PERSIST_MS.load(Ordering::Relaxed);
    if now_ms - last < PERSIST_DEBOUNCE_MS {
        return;
    }
    // Best-effort CAS — if two threads race, only one will win and write.
    if LAST_PERSIST_MS
        .compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed)
        .is_err()
    {
        return;
    }
    tokio::task::spawn_blocking(move || {
        let all: Vec<String> = known.iter().map(|r| r.clone()).collect();
        if let Ok(json) = serde_json::to_string_pretty(&all) {
            if let Err(e) = std::fs::write("known_traders.json", json) {
                tracing::warn!("Failed to persist known_traders.json: {}", e);
            }
        }
    });
}

/// Start the relay that feeds data from Phoenix SDK WS into broadcast channels.
/// Uses the high-level `PhoenixClient` which manages WS connection,
/// reconnection, and resubscription for us — so this layer is pure
/// event fan-out with no retry loops.
pub async fn start_relay(
    client: PhoenixClient,
    market_cache: Arc<MarketCache>,
    broadcast: Arc<BroadcastHub>,
    symbols: Vec<String>,
    known_traders: Option<Arc<dashmap::DashSet<String>>>,
) {
    for symbol in symbols {
        let c = client.clone();
        let cache = market_cache.clone();
        let bcast = broadcast.clone();
        let sym = symbol.clone();
        let traders = known_traders.clone();
        tokio::spawn(async move {
            start_market_relay(c, cache, bcast, sym, traders).await;
        });
    }
}

/// Subscribe to the full bundle (orderbook + market stats + trades + candles)
/// for a single market and forward events to broadcast. `PhoenixClient`
/// handles upstream reconnection; we just consume events until the
/// subscription channel closes (on shutdown).
async fn start_market_relay(
    client: PhoenixClient,
    cache: Arc<MarketCache>,
    broadcast: Arc<BroadcastHub>,
    symbol: String,
    known_traders: Option<Arc<dashmap::DashSet<String>>>,
) {
    tracing::info!("Starting SDK market bundle relay for {}", symbol);

    let (mut rx, _handle) = match client
        .subscribe(PhoenixSubscription::Market {
            symbol: symbol.clone(),
            candle_timeframes: vec![Timeframe::Minute1],
            include_trades: true,
        })
        .await
    {
        Ok(sub) => sub,
        Err(e) => {
            tracing::error!(
                "Failed to subscribe to market bundle for {}: {:?}",
                symbol, e
            );
            return;
        }
    };

    tracing::info!("Market bundle subscription established for {}", symbol);

    while let Some(event) = rx.recv().await {
        match event {
            PhoenixClientEvent::OrderbookUpdate {
                symbol: sym, update, ..
            } => {
                let bids: Vec<OrderbookLevel> = update
                    .orderbook
                    .bids
                    .iter()
                    .map(|&(price, size)| OrderbookLevel { price, size })
                    .collect();
                let asks: Vec<OrderbookLevel> = update
                    .orderbook
                    .asks
                    .iter()
                    .map(|&(price, size)| OrderbookLevel { price, size })
                    .collect();

                cache.update_orderbook(&sym, bids.clone(), asks.clone());
                cache.touch_relay("orderbook", &sym);

                let msg = WsServerMessage {
                    channel: "orderbook".to_string(),
                    symbol: Some(sym.clone()),
                    data: serde_json::json!({
                        "bids": bids,
                        "asks": asks,
                    }),
                };
                broadcast.send(&format!("orderbook:{}", sym), msg);
            }
            PhoenixClientEvent::MarketUpdate {
                symbol: sym, update, ..
            } => {
                cache.touch_relay("stats", &sym);
                let msg = WsServerMessage {
                    channel: "stats".to_string(),
                    symbol: Some(sym.clone()),
                    data: serde_json::json!({
                        "mark_price": update.mark_price,
                        "index_price": update.oracle_price,
                        "last_price": update.mid_price,
                        "funding_rate": update.funding_rate,
                        "open_interest": update.open_interest,
                        "volume_24h": update.day_volume_usd,
                    }),
                };
                broadcast.send(&format!("stats:{}", sym), msg);
            }
            PhoenixClientEvent::TradesUpdate {
                symbol: sym, update, ..
            } => {
                let trades: Vec<serde_json::Value> = update
                    .trades
                    .iter()
                    .map(|t| {
                        if let Some(ref known) = known_traders {
                            if !t.taker.is_empty()
                                && Pubkey::from_str(&t.taker).is_ok()
                                && known.insert(t.taker.clone())
                            {
                                tracing::debug!(
                                    "Discovered new trader from trade stream: {}",
                                    t.taker
                                );
                                // Persist asynchronously and debounced — see
                                // schedule_known_traders_persist for why.
                                schedule_known_traders_persist(known.clone());
                            }
                        }

                        let price = if t.base_amount > 0.0 {
                            t.quote_amount / t.base_amount
                        } else {
                            0.0
                        };
                        let ts_secs = t
                            .timestamp
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        serde_json::json!({
                            "price": price,
                            "size": t.base_amount,
                            "side": format!("{:?}", t.side).to_lowercase(),
                            "timestamp": ts_secs,
                        })
                    })
                    .collect();

                if !trades.is_empty() {
                    cache.touch_relay("trades", &sym);
                    cache.push_trades(&sym, &trades);
                    let msg = WsServerMessage {
                        channel: "trades".to_string(),
                        symbol: Some(sym.clone()),
                        data: serde_json::json!({ "trades": trades }),
                    };
                    broadcast.send(&format!("trades:{}", sym), msg);
                }
            }
            PhoenixClientEvent::CandleUpdate {
                symbol: sym, update, ..
            } => {
                cache.touch_relay("candles", &sym);
                let msg = WsServerMessage {
                    channel: "candles".to_string(),
                    symbol: Some(sym.clone()),
                    data: serde_json::json!({
                        "timeframe": "1m",
                        "candle": {
                            "time": update.candle.time,
                            "open": update.candle.open,
                            "high": update.candle.high,
                            "low": update.candle.low,
                            "close": update.candle.close,
                            "volume": update.candle.volume,
                        }
                    }),
                };
                broadcast.send(&format!("candles:{}", sym), msg);
            }
            _ => {
                // FundingRateUpdate / MidsUpdate / TraderUpdate / MarginUpdate
                // — not emitted by a Market bundle subscription.
            }
        }
    }

    tracing::warn!("Market bundle receiver closed for {}", symbol);
}

/// Start a per-trader relay. We subscribe at the low-level key granularity
/// (not `PhoenixSubscription::TraderMargin`) so the event payload is the raw
/// `TraderStateServerMessage` — matching the wire contract the frontend
/// currently expects on the `trader_margin` channel.
pub async fn start_trader_relay(
    client: PhoenixClient,
    broadcast: Arc<BroadcastHub>,
    active_relays: Arc<dashmap::DashSet<String>>,
    pubkey_str: String,
) {
    // BE-BUG-1 FIX: Atomically claim this relay — skip if already running.
    if !active_relays.insert(pubkey_str.clone()) {
        tracing::debug!("Trader relay already active for {}, skipping", pubkey_str);
        return;
    }

    let channel_key = format!("trader_margin:{}", pubkey_str);
    tracing::info!("Starting SDK trader relay for {}", pubkey_str);

    let authority = match Pubkey::from_str(&pubkey_str) {
        Ok(pk) => pk,
        Err(e) => {
            tracing::error!("Invalid pubkey {}: {}", pubkey_str, e);
            active_relays.remove(&pubkey_str);
            return;
        }
    };

    let sub_key = SubscriptionKey::trader(&authority, 0);
    let (mut rx, _handle) = match client
        .subscribe(PhoenixSubscription::Key(sub_key))
        .await
    {
        Ok(sub) => sub,
        Err(e) => {
            tracing::error!(
                "Failed to subscribe to trader state for {}: {:?}",
                pubkey_str, e
            );
            active_relays.remove(&pubkey_str);
            return;
        }
    };

    tracing::info!(
        "Trader state subscription established for {}",
        pubkey_str
    );

    while let Some(event) = rx.recv().await {
        // Stop if no subscribers
        if !broadcast.has_subscribers(&channel_key) {
            tracing::info!(
                "No subscribers for {}, stopping trader relay",
                channel_key
            );
            break;
        }

        if let PhoenixClientEvent::TraderUpdate { update, .. } = event {
            let data = match serde_json::to_value(&update) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("Failed to serialize trader state: {}", e);
                    continue;
                }
            };
            let msg = WsServerMessage {
                channel: "trader_margin".to_string(),
                symbol: None,
                data,
            };
            broadcast.send(&channel_key, msg);
        }
    }

    // Cleanup: release relay slot
    active_relays.remove(&pubkey_str);

    // BE-BUG-3 FIX: Remove broadcast channel if no subscribers remain.
    if !broadcast.has_subscribers(&channel_key) {
        broadcast.remove_channel(&channel_key);
        tracing::info!("Removed broadcast channel {} (no subscribers)", channel_key);
    }

    tracing::info!("Trader relay ended for {}", pubkey_str);
}
