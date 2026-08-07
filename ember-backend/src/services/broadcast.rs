use crate::phoenix::types::WsServerMessage;
use dashmap::DashMap;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

pub struct BroadcastHub {
    channels: DashMap<String, broadcast::Sender<WsServerMessage>>,
}

impl BroadcastHub {
    pub fn new(symbols: &[String]) -> Self {
        let channels = DashMap::new();

        for symbol in symbols {
            for channel_type in &["orderbook", "trades", "stats", "candles"] {
                let key = format!("{}:{}", channel_type, symbol);
                let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
                channels.insert(key, tx);
            }
        }

        // Global mids channel
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        channels.insert("mids:*".to_string(), tx);

        Self { channels }
    }

    pub fn subscribe(&self, key: &str) -> Option<broadcast::Receiver<WsServerMessage>> {
        self.channels.get(key).map(|tx| tx.subscribe())
    }

    /// Subscribe to a channel, creating it on-demand if it doesn't exist.
    /// Used for per-trader channels like trader_margin:<pubkey>.
    pub fn subscribe_or_create(&self, key: &str) -> broadcast::Receiver<WsServerMessage> {
        self.channels
            .entry(key.to_string())
            .or_insert_with(|| {
                let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
                tx
            })
            .subscribe()
    }

    /// Check if a channel has any active subscribers.
    pub fn has_subscribers(&self, key: &str) -> bool {
        self.channels
            .get(key)
            .map(|tx| tx.receiver_count() > 0)
            .unwrap_or(false)
    }

    pub fn send(&self, key: &str, msg: WsServerMessage) {
        if let Some(tx) = self.channels.get(key) {
            let _ = tx.send(msg);
        }
    }

    /// Remove a dynamically-created channel (e.g. trader_margin:<pubkey>).
    /// Prevents unbounded DashMap growth from one-off trader subscriptions.
    pub fn remove_channel(&self, key: &str) {
        self.channels.remove(key);
    }

    /// Total number of registered channels (for observability).
    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    /// Sum of `receiver_count()` across every channel — how many
    /// browser-side WS subscribers are currently attached.
    pub fn total_subscribers(&self) -> usize {
        self.channels.iter().map(|r| r.value().receiver_count()).sum()
    }

    /// Breakdown of subscribers per channel-kind (orderbook / trades /
    /// trader_margin / etc.) so we can see which kind is holding the
    /// most attention.
    pub fn subscribers_by_prefix(&self) -> std::collections::BTreeMap<String, usize> {
        let mut out: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for r in self.channels.iter() {
            let prefix = r.key().split(':').next().unwrap_or("?").to_string();
            *out.entry(prefix).or_insert(0) += r.value().receiver_count();
        }
        out
    }
}
