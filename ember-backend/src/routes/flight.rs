//! Flight builder-fee status endpoint. Lets the frontend disclose the active
//! builder fee in the order-entry cost preview and link to the builder's
//! fee-earning account.

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use phoenix_rise::ix::flight::{
    create_register_builder_ix, create_update_fee_ix, RegisterBuilderParams, UpdateFeeParams,
};
use phoenix_rise::api::TraderKey;
use serde::{Deserialize, Serialize};
use solana_pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;

use crate::error::AppError;
use crate::services::flight::{builder_status, BuilderStatus};
use crate::services::tx_builder::{serialize_instructions, TxResponse};
use crate::state::AppState;

fn solana_rpc_url() -> String {
    std::env::var("SOLANA_RPC_URL").unwrap_or_else(|_| "https://solana.publicnode.com".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlightConfigResponse {
    /// True when a builder is configured (orders are wrapped + a fee applies).
    active: bool,
    /// Display fee in basis points (matches the on-chain registered rate).
    fee_bps: u64,
    /// The builder authority whose account collects fees (null when inactive).
    builder_authority: Option<String>,
    /// The builder's trader subaccount PDA where fees accrue (null when inactive).
    builder_trader_account: Option<String>,
}

async fn get_config(State(state): State<Arc<AppState>>) -> Json<FlightConfigResponse> {
    match &state.flight {
        Some(f) => Json(FlightConfigResponse {
            active: true,
            fee_bps: f.fee_bps,
            builder_authority: Some(f.builder_authority.to_string()),
            builder_trader_account: Some(f.builder_trader_account().to_string()),
        }),
        None => Json(FlightConfigResponse {
            active: false,
            fee_bps: 0,
            builder_authority: None,
            builder_trader_account: None,
        }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBuilderRequest {
    /// The builder authority (the connected wallet) to register.
    authority: String,
    /// Fee in basis points to register the builder with. Defaults to
    /// FLIGHT_FEE_BPS (or 10). This is the single on-chain rate.
    #[serde(default)]
    fee_bps: Option<u64>,
}

/// Build a one-time Flight `register_builder` instruction for the connected
/// wallet to sign (backend builds, frontend signs — same as every other tx).
/// The builder's Phoenix trader account must already exist (activated + funded).
async fn register_builder(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<RegisterBuilderRequest>,
) -> Result<Json<TxResponse>, AppError> {
    let authority = Pubkey::from_str(req.authority.trim())
        .map_err(|_| AppError::BadRequest(format!("Invalid authority: {}", req.authority)))?;
    let fee_bps = req.fee_bps.unwrap_or_else(|| {
        std::env::var("FLIGHT_FEE_BPS").ok().and_then(|s| s.trim().parse().ok()).unwrap_or(10)
    });
    // pda_index/subaccount 0 = the builder's cross-margin trader account.
    let trader_account = TraderKey::derive_pda(&authority, 0, 0);
    let params = RegisterBuilderParams::builder()
        .trader_authority(authority)
        .trader_account(trader_account)
        .trader_pda_index(0)
        .subaccount_index(0)
        .fee_bps(fee_bps)
        .build()
        .map_err(|e| AppError::Phoenix(format!("Failed to build register-builder params: {e}")))?;
    let ix: solana_instruction::Instruction = create_register_builder_ix(params)
        .map_err(|e| AppError::Phoenix(format!("Failed to build register-builder ix: {e}")))?
        .into();
    Ok(Json(serialize_instructions(
        vec![ix],
        format!("Register Flight builder ({fee_bps} bps)"),
    )))
}

/// Generic, on-chain builder-code status for ANY wallet — powers the
/// builder-management console so any admin can inspect their own builder.
async fn get_builder_status(
    State(_state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
) -> Result<Json<BuilderStatus>, AppError> {
    let authority = Pubkey::from_str(pubkey.trim())
        .map_err(|_| AppError::BadRequest(format!("Invalid pubkey: {pubkey}")))?;
    Ok(Json(builder_status(&solana_rpc_url(), &authority).await))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateFeeRequest {
    authority: String,
    fee_bps: u64,
}

/// Build a Flight `update_fee` instruction for the connected builder to sign.
async fn update_fee(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<UpdateFeeRequest>,
) -> Result<Json<TxResponse>, AppError> {
    let authority = Pubkey::from_str(req.authority.trim())
        .map_err(|_| AppError::BadRequest(format!("Invalid authority: {}", req.authority)))?;
    let params = UpdateFeeParams::builder()
        .trader_authority(authority)
        .fee_bps(req.fee_bps)
        .build()
        .map_err(|e| AppError::Phoenix(format!("Failed to build update-fee params: {e}")))?;
    let ix: solana_instruction::Instruction = create_update_fee_ix(params)
        .map_err(|e| AppError::Phoenix(format!("Failed to build update-fee ix: {e}")))?
        .into();
    Ok(Json(serialize_instructions(
        vec![ix],
        format!("Update Flight builder fee to {} bps", req.fee_bps),
    )))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/config", get(get_config))
        .route("/builder/{pubkey}", get(get_builder_status))
        .route("/register-builder", post(register_builder))
        .route("/update-fee", post(update_fee))
}
