//! Flight builder-fee integration (phoenix-rise 0.1.3 "builder codes").
//!
//! Two distinct concerns live here:
//!
//! 1. **Ember's order routing** (`FlightConfig`): which builder THIS deployment
//!    routes its order fees to. That target is a per-deployment choice
//!    (`FLIGHT_BUILDER_AUTHORITY` env). The fee RATE is read from on-chain (the
//!    builder-state account), so it always matches reality — no need to also
//!    configure it. Activation is gated on the builder actually being
//!    registered on-chain, so setting the env before registration is harmless.
//!
//! 2. **Generic builder management** (`builder_status`, free fn): read any
//!    wallet's builder-code setup straight from chain so the UI can let ANY
//!    admin connect and manage their own builder (register / update fee /
//!    withdraw) — not tied to this deployment's routing target.
//!
//! The backend only builds instructions (never signs). Order placement ixs are
//! wrapped via `PhoenixFlightClient::try_wrap_order_instruction` (non-order ixs
//! pass through).

use base64::Engine;
use serde::Serialize;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use std::str::FromStr;

use phoenix_rise::ix::flight::get_flight_builder_state_address;
use phoenix_rise::{PhoenixFlightClient, TraderKey};

/// Byte offset of `fee_bps` (u64 LE) within the Flight builder-state account.
/// Layout (216 bytes): disc(8) · authority(32) · trader_account(32) · u64(8) ·
/// **fee_bps(8 @ 80)** · … (verified against the live mainnet account).
const BUILDER_STATE_FEE_OFFSET: usize = 80;

#[derive(Clone)]
pub struct FlightConfig {
    client: PhoenixFlightClient,
    pub builder_authority: Pubkey,
    /// Fee in basis points. Seeded from env as a fallback but overwritten with
    /// the on-chain registered rate at startup.
    pub fee_bps: u64,
}

impl FlightConfig {
    /// Build from env. `None` (Flight disabled) when `FLIGHT_BUILDER_AUTHORITY`
    /// is unset or invalid.
    pub fn from_env() -> Option<Self> {
        let raw = std::env::var("FLIGHT_BUILDER_AUTHORITY").ok()?;
        if raw.trim().is_empty() {
            return None;
        }
        let builder_authority = match Pubkey::from_str(raw.trim()) {
            Ok(pk) => pk,
            Err(e) => {
                tracing::warn!("FLIGHT_BUILDER_AUTHORITY invalid ({e}); Flight disabled");
                return None;
            }
        };
        let builder_pda_index = env_u8("FLIGHT_BUILDER_PDA_INDEX", 0);
        let builder_subaccount_index = env_u8("FLIGHT_BUILDER_SUBACCOUNT_INDEX", 0);
        let fee_bps = std::env::var("FLIGHT_FEE_BPS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(10);
        Some(Self {
            client: PhoenixFlightClient::new(
                builder_authority,
                builder_pda_index,
                builder_subaccount_index,
            ),
            builder_authority,
            fee_bps,
        })
    }

    /// The builder's own trader subaccount PDA — where fee credit accrues.
    pub fn builder_trader_account(&self) -> Pubkey {
        self.client.builder_trader_account()
    }

    /// On-chain registered fee (bps) for this builder, or `None` if the builder
    /// isn't registered (or the RPC check failed — fail-safe so live orders are
    /// never wrapped against a missing builder).
    pub async fn registered_fee_bps(&self, rpc_url: &str) -> Option<u64> {
        let state_pda = get_flight_builder_state_address(&self.builder_authority);
        let data = get_account_data(rpc_url, &state_pda).await?;
        parse_builder_fee_bps(&data)
    }

    /// Overwrite the display fee with the on-chain rate (call once at startup).
    pub fn set_fee_bps(&mut self, fee_bps: u64) {
        self.fee_bps = fee_bps;
    }

    /// Wrap each order-placement ix in a Flight proxy. Non-order ixs pass
    /// through unchanged. On a wrap error the original ix is kept.
    pub fn wrap(&self, ixs: Vec<Instruction>, trader_authority: Pubkey) -> Vec<Instruction> {
        ixs.into_iter()
            .map(|ix| {
                let original = ix.clone();
                self.client
                    .try_wrap_order_instruction(ix, trader_authority)
                    .unwrap_or_else(|e| {
                        tracing::warn!("Flight wrap failed ({e:?}); sending unwrapped ix");
                        original
                    })
            })
            .collect()
    }
}

/// Generic, on-chain builder-code status for ANY authority — powers the
/// builder-management UI so any admin can inspect/manage their own builder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuilderStatus {
    pub builder_authority: String,
    pub builder_trader_account: String,
    pub registered: bool,
    pub fee_bps: Option<u64>,
}

/// Read a wallet's builder-code setup directly from chain.
pub async fn builder_status(rpc_url: &str, authority: &Pubkey) -> BuilderStatus {
    let trader_account = TraderKey::derive_pda(authority, 0, 0);
    let state_pda = get_flight_builder_state_address(authority);
    let fee_bps = get_account_data(rpc_url, &state_pda)
        .await
        .and_then(|d| parse_builder_fee_bps(&d));
    BuilderStatus {
        builder_authority: authority.to_string(),
        builder_trader_account: trader_account.to_string(),
        registered: fee_bps.is_some(),
        fee_bps,
    }
}

fn parse_builder_fee_bps(data: &[u8]) -> Option<u64> {
    let end = BUILDER_STATE_FEE_OFFSET + 8;
    if data.len() < end {
        return None;
    }
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[BUILDER_STATE_FEE_OFFSET..end]);
    Some(u64::from_le_bytes(b))
}

/// `getAccountInfo` → raw account bytes, or `None` if the account doesn't exist
/// or the RPC call fails. Shared with the trade routes for on-chain existence
/// checks (e.g. has the conditional-orders account been created yet?).
pub(crate) async fn get_account_data(rpc_url: &str, pubkey: &Pubkey) -> Option<Vec<u8>> {
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
        "params": [pubkey.to_string(), { "encoding": "base64" }],
    });
    let resp = crate::services::http::shared_client()
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .ok()?;
    let v: serde_json::Value = resp.json().await.ok()?;
    let val = v.get("result")?.get("value")?;
    if val.is_null() {
        return None;
    }
    let b64 = val.get("data")?.get(0)?.as_str()?;
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
}

fn env_u8(key: &str, default: u8) -> u8 {
    std::env::var(key)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(default)
}
