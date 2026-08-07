//! Process-wide shared `reqwest::Client`.
//!
//! A `reqwest::Client` owns a connection pool and is cheap to share (all of its
//! methods take `&self`). Constructing one per call — the previous pattern in a
//! few hot paths — discarded keep-alive and paid a fresh TLS handshake every
//! request. A single lazily-initialized client reused everywhere fixes that.

use std::sync::OnceLock;

/// The shared client, initialized on first use. Safe to use via a `&'static`
/// reference anywhere that needs to make outbound HTTP/RPC calls.
pub fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}
