//! Fetch all subaccounts (cross-margin + isolated) for an authority in one call.
//!
//! phoenix-rise 0.1.7 removed `TradersClient::get_trader` / `get_trader_state`,
//! which used to return every subaccount under an authority's PDA in a single
//! request. The new SDK only exposes per-PDA lookups (`get_trader_by_pubkey`,
//! `get_trader_subaccount`) — enumerating those would turn the leaderboard's
//! per-trader enrichment (hundreds of traders per refresh) into thousands of
//! round-trips.
//!
//! The underlying perp-api endpoint `/trader/{authority}/state` is still live
//! and public (verified against prod), and the SDK still exports the
//! `TraderStateResponse` type, so we hit it directly via the shared reqwest
//! client — the same "proxy a perp-api endpoint the SDK doesn't wrap" pattern
//! already used for `/v1/invite/check` in `routes/onboarding.rs`. This
//! preserves the previous one-call-per-authority behavior exactly.

use phoenix_rise::types::trader_http::{TraderStateResponse, TraderView};
use solana_pubkey::Pubkey;

fn perp_api_url() -> String {
    std::env::var("PHOENIX_API_URL")
        .unwrap_or_else(|_| "https://perp-api.phoenix.trade".to_string())
}

/// Fetch all subaccounts under PDA index 0 (the only PDA index Ember uses) for
/// `authority`, in API order. An unknown authority returns an empty `Vec` (the
/// endpoint answers `200` with `traders: []`), matching the old `get_trader`
/// behavior. Network/HTTP/JSON failures surface as an `Err(String)`.
pub async fn fetch_subaccounts(authority: &Pubkey) -> Result<Vec<TraderView>, String> {
    let url = format!("{}/trader/{}/state?pda_index=0", perp_api_url(), authority);
    let resp = crate::services::http::shared_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("trader-state request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("trader-state returned {}", resp.status().as_u16()));
    }

    let state: TraderStateResponse = resp
        .json()
        .await
        .map_err(|e| format!("trader-state bad json: {e}"))?;

    Ok(state.traders)
}
