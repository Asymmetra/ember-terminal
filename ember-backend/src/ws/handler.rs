use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures::stream::StreamExt;
use futures::SinkExt;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::task::JoinHandle;

use crate::state::AppState;
use crate::ws::messages::{ClientMessage, ServerMessage};

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ServerMessage>();

    // BE-BUG-2 FIX: Track forwarder tasks so we can abort them on
    // unsubscribe or disconnect.
    let mut forwarders: HashMap<String, JoinHandle<()>> = HashMap::new();

    // Forward messages from mpsc channel to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Process incoming messages from client
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                    match client_msg {
                        ClientMessage::Subscribe {
                            channel,
                            symbol,
                            authority,
                            ..
                        } => {
                            let key = if channel == "trader_margin" {
                                let pubkey = authority.as_deref().unwrap_or("unknown");
                                format!("trader_margin:{}", pubkey)
                            } else {
                                format!(
                                    "{}:{}",
                                    channel,
                                    symbol.as_deref().unwrap_or("*")
                                )
                            };

                            // Skip duplicate subscriptions from the same client
                            if forwarders.contains_key(&key) {
                                tracing::debug!("Already subscribed to {}, skipping", key);
                                continue;
                            }

                            tracing::info!("Client subscribing to {}", key);

                            if channel == "trader_margin" {
                                let broadcast_rx =
                                    state.broadcast.subscribe_or_create(&key);
                                let tx_clone = tx.clone();
                                let mut sub_rx = broadcast_rx;

                                // BE-BUG-1 FIX: Only start relay if not already running.
                                if let Some(pubkey) = authority {
                                    let relay_ws = state.ws_client.clone();
                                    let relay_bcast = state.broadcast.clone();
                                    let relay_active = state.active_trader_relays.clone();
                                    let relay_pubkey = pubkey.clone();
                                    tokio::spawn(async move {
                                        crate::ws::relay::start_trader_relay(
                                            relay_ws,
                                            relay_bcast,
                                            relay_active,
                                            relay_pubkey,
                                        )
                                        .await;
                                    });
                                }

                                let handle = tokio::spawn(async move {
                                    loop {
                                        match sub_rx.recv().await {
                                            Ok(msg) => {
                                                if tx_clone.send(msg).is_err() {
                                                    break; // WS client disconnected
                                                }
                                            }
                                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                                tracing::warn!("WS forwarder lagged by {} messages, continuing", n);
                                                // Skip dropped messages, keep running
                                            }
                                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                                break; // Broadcast channel shut down
                                            }
                                        }
                                    }
                                });
                                forwarders.insert(key, handle);
                            } else if let Some(broadcast_rx) =
                                state.broadcast.subscribe(&key)
                            {
                                let tx_clone = tx.clone();
                                let mut sub_rx = broadcast_rx;
                                let handle = tokio::spawn(async move {
                                    loop {
                                        match sub_rx.recv().await {
                                            Ok(msg) => {
                                                if tx_clone.send(msg).is_err() {
                                                    break; // WS client disconnected
                                                }
                                            }
                                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                                tracing::warn!("WS forwarder lagged by {} messages, continuing", n);
                                                // Skip dropped messages, keep running
                                            }
                                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                                break; // Broadcast channel shut down
                                            }
                                        }
                                    }
                                });
                                forwarders.insert(key, handle);
                            }
                        }
                        // BE-BUG-2 FIX: Actually unsubscribe by aborting
                        // the forwarder task (which drops the broadcast
                        // receiver, decrementing subscriber count).
                        ClientMessage::Unsubscribe {
                            channel,
                            symbol,
                            authority,
                        } => {
                            let key = if channel == "trader_margin" {
                                let pubkey = authority.as_deref().unwrap_or("unknown");
                                format!("trader_margin:{}", pubkey)
                            } else {
                                format!(
                                    "{}:{}",
                                    channel,
                                    symbol.as_deref().unwrap_or("*")
                                )
                            };

                            if let Some(handle) = forwarders.remove(&key) {
                                handle.abort();
                                tracing::info!("Client unsubscribed from {}", key);
                            }
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // BE-BUG-2 FIX: Abort all remaining forwarders on disconnect.
    // This drops broadcast receivers, which decrements subscriber counts
    // and allows trader relays to detect zero subscribers and shut down.
    for (key, handle) in forwarders.drain() {
        handle.abort();
        tracing::debug!("Cleaned up forwarder for {} on disconnect", key);
    }

    send_task.abort();
}
