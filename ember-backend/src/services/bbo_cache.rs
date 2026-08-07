//! Short-TTL cache of protocol-exact best-bid/offer fetched via Hawkeye
//! `view_bbo`.
//!
//! The slippage cap prefers the realtime WS orderbook (`services::market_cache`);
//! this cache backstops the rare case where that book is empty (cold boot, WS
//! reconnect, never-subscribed symbol) so a burst of orders (e.g. close-all)
//! doesn't issue one RPC simulation per order. Entries expire by age.

use dashmap::DashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy)]
pub struct BboEntry {
    pub best_bid: f64,
    pub best_ask: f64,
    pub fetched_at_ms: i64,
}

#[derive(Default)]
pub struct BboCache {
    entries: DashMap<String, BboEntry>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

impl BboCache {
    pub fn new() -> Self {
        Self {
            entries: DashMap::new(),
        }
    }

    /// Return a cached BBO for `symbol` if present and younger than `max_age_ms`.
    pub fn get(&self, symbol: &str, max_age_ms: i64) -> Option<BboEntry> {
        let entry = *self.entries.get(&symbol.to_uppercase())?;
        (now_ms() - entry.fetched_at_ms <= max_age_ms).then_some(entry)
    }

    pub fn put(&self, symbol: &str, best_bid: f64, best_ask: f64) {
        self.entries.insert(
            symbol.to_uppercase(),
            BboEntry {
                best_bid,
                best_ask,
                fetched_at_ms: now_ms(),
            },
        );
    }
}
