use serde::{Deserialize, Serialize};

// --- Orderbook types (for cache + API response) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderbookLevel {
    pub price: f64,
    pub size: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderbookSnapshot {
    pub symbol: String,
    pub bids: Vec<OrderbookLevel>,
    pub asks: Vec<OrderbookLevel>,
    pub timestamp: i64,
}

// --- Frontend-facing market info ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketInfo {
    pub symbol: String,
    pub asset_id: u32,
    pub market_status: String,
    pub market_pubkey: String,
    pub tick_size: u64,
    pub base_lots_decimals: i8,
    pub taker_fee: f64,
    pub maker_fee: f64,
    pub max_leverage: f64,
    pub funding_interval_seconds: u32,
    pub isolated_only: bool,
}

impl From<&phoenix_rise::api::ExchangeMarketConfig> for MarketInfo {
    fn from(m: &phoenix_rise::api::ExchangeMarketConfig) -> Self {
        Self {
            symbol: m.symbol.clone(),
            asset_id: m.asset_id,
            market_status: format!("{:?}", m.market_status),
            market_pubkey: m.market_pubkey.clone(),
            tick_size: m.tick_size,
            base_lots_decimals: m.base_lots_decimals,
            taker_fee: m.taker_fee,
            maker_fee: m.maker_fee,
            max_leverage: m
                .leverage_tiers
                .first()
                .map(|t| t.max_leverage)
                .unwrap_or(1.0),
            funding_interval_seconds: m.funding_interval_seconds,
            isolated_only: m.isolated_only,
        }
    }
}

// --- WebSocket messages (our internal broadcast format) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsServerMessage {
    pub channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub data: serde_json::Value,
}
