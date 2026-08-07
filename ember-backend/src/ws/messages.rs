use serde::Deserialize;

// Re-export WsServerMessage from phoenix types for use in handler
pub use crate::phoenix::types::WsServerMessage as ServerMessage;

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum ClientMessage {
    #[serde(rename = "subscribe")]
    Subscribe {
        channel: String,
        symbol: Option<String>,
        authority: Option<String>,
        timeframe: Option<String>,
    },
    #[serde(rename = "unsubscribe")]
    Unsubscribe {
        channel: String,
        symbol: Option<String>,
        authority: Option<String>,
    },
}
