use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use phoenix_rise::{PhoenixHttpClient, PhoenixHttpError};
use serde::Deserialize;
use solana_pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;

use crate::error::AppError;
use crate::state::AppState;

// Onboarding routes proxy Phoenix's invite/referral/auth endpoints.
//
// The Phoenix invite system is NOT an on-chain gate — any wallet can register,
// deposit, and trade without activating an invite. We enforce the gate at the
// UI layer: new wallets either activate (referral or access code) or browse
// the terminal in view-only mode.
//
// Per the SDK, the two activation routes are NOT interchangeable:
//   /v1/invite/activate    — access code / allowlist code (field: code) — UNAUTHENTICATED
//   /v1/referral/activate  — referral code from another trader (field: referral_code).
//                            REQUIRES an authenticated wallet session (phoenix-rise 0.1.4).
//
// Because the access token is bound to a proof-of-possession key, we cannot hand
// a JWT to the browser to use directly. Instead we relay: the client fetches a
// nonce, the wallet signs it (Phantom signMessage), and we sign-in + activate in
// ONE request on a single client instance — the bearer is auto-attached from the
// in-memory session store. The backend stays keyless: only the user's signature
// passes through, never a key.

/// Build a fresh, auth-enabled Phoenix HTTP client with an isolated in-memory
/// session store (so concurrent users never share a session). `enable_auth()`
/// defaults to a `MemoryAuthSessionStore`; the only env that matters is
/// `PHOENIX_API_URL`. Cheap enough for the rare onboarding path.
fn build_auth_client() -> Result<PhoenixHttpClient, AppError> {
    PhoenixHttpClient::builder(perp_api_url())
        .enable_auth()
        .build()
        .map_err(|e| AppError::Internal(format!("auth client init failed: {e}")))
}

#[derive(Deserialize)]
pub struct ActivateReferralRequest {
    pub authority: String,
    pub referral_code: String,
    /// base64-encoded ed25519 signature of the nonce `message` (from /nonce),
    /// produced by the wallet (Phantom signMessage).
    pub signature: String,
    /// The `nonce_id` returned by the matching /nonce request.
    pub nonce_id: String,
}

#[derive(Deserialize)]
pub struct ActivateAccessCodeRequest {
    pub authority: String,
    pub code: String,
}

fn perp_api_url() -> String {
    std::env::var("PHOENIX_API_URL")
        .unwrap_or_else(|_| "https://perp-api.phoenix.trade".to_string())
}

/// Map a `Result<String, PhoenixHttpError>` from the SDK invite client into the
/// frontend's expected `{ trader_pda, already_activated }` shape, bucketing
/// errors as `invalid_code:...` or `upstream_error:...`.
fn map_activation_result(
    result: Result<String, PhoenixHttpError>,
) -> Result<Json<serde_json::Value>, AppError> {
    let err = match result {
        Ok(trader_pda) => {
            return Ok(Json(serde_json::json!({
                "trader_pda": trader_pda,
                "already_activated": false,
            })));
        }
        Err(e) => e,
    };

    // "Already activated" / "already whitelisted" → success from the user's POV
    // (a previously-activated wallet re-onboarding shouldn't be blocked). Check
    // across ALL error variants, not just ApiError.
    let message = err.to_string();
    let msg_lower = message.to_lowercase();
    if msg_lower.contains("already")
        && (msg_lower.contains("activ") || msg_lower.contains("whitelist"))
    {
        return Ok(Json(serde_json::json!({
            "trader_pda": null,
            "already_activated": true,
        })));
    }

    // Bucket the failure precisely. The SDK routes 401/403 (and auth error_codes)
    // into the distinct `Authentication` variant and 429 into `RateLimited` —
    // neither is `ApiError` — so match on the helpers, not one variant, to avoid
    // mislabeling an auth/throttle failure as a generic `upstream_error`.
    if err.is_rate_limited() {
        return Err(AppError::RateLimited(format!(
            "referral activation rate-limited, retry shortly: {err}"
        )));
    }
    if err.is_auth_error() {
        return Err(AppError::Phoenix(format!("auth_failed:{err}")));
    }
    if matches!(err.status(), Some(400) | Some(404)) || msg_lower.contains("invalid") {
        return Err(AppError::BadRequest(format!("invalid_code:{message}")));
    }
    Err(AppError::Phoenix(format!("upstream_error:{err}")))
}

// GET /api/onboard/nonce/:pubkey
// Returns: { nonce_id, message, expires_at }
// The wallet signs `message` (Phantom signMessage); the signature + nonce_id are
// then POSTed to /activate-referral. Proxies Phoenix GET /v1/auth/nonce.
async fn get_wallet_nonce(
    State(_state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = Pubkey::from_str(&pubkey)
        .map_err(|e| AppError::BadRequest(format!("invalid authority pubkey: {e}")))?;

    let client = build_auth_client()?;
    let auth = client
        .auth()
        .ok_or_else(|| AppError::Internal("auth client unavailable".to_string()))?;
    let nonce = auth
        .get_wallet_nonce(&pubkey)
        .await
        .map_err(|e| {
            if e.is_rate_limited() {
                AppError::RateLimited(format!("sign-in rate-limited, retry shortly: {e}"))
            } else {
                AppError::Phoenix(format!("nonce request failed: {e}"))
            }
        })?;

    Ok(Json(serde_json::json!({
        "nonce_id": nonce.nonce_id,
        "message": nonce.message,
        "expires_at": nonce.expires_at,
    })))
}

// POST /api/onboard/activate-referral
// Body: { authority, referral_code, signature (base64 of the nonce message), nonce_id }
// Success: { trader_pda: "<pubkey>", already_activated: bool }
// Errors (as JSON { error }):
//   400 "invalid_code:..."  — bad authority / empty code / bad signature encoding
//   502 "auth_failed:..."   — wallet sign-in (nonce/signature) rejected; re-fetch a nonce & retry
//   400 "invalid_code:..."  — Phoenix rejected the referral string
//   502 "upstream_error:..."— perp-api unreachable or 5xx
//
// Signs the wallet in (relaying the user's signature) and activates the referral
// in ONE request on a single auth-enabled client, so the access bearer is
// attached to /v1/referral/activate automatically.
async fn activate_referral(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<ActivateReferralRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = Pubkey::from_str(&req.authority).map_err(|e| {
        AppError::BadRequest(format!("invalid_code:invalid authority pubkey: {e}"))
    })?;
    let code = req.referral_code.trim();
    if code.is_empty() {
        return Err(AppError::BadRequest(
            "invalid_code:referral_code is required".to_string(),
        ));
    }
    let nonce_id = req.nonce_id.trim();
    if nonce_id.is_empty() {
        return Err(AppError::BadRequest(
            "invalid_code:nonce_id is required".to_string(),
        ));
    }
    let signature = base64::engine::general_purpose::STANDARD
        .decode(req.signature.trim())
        .map_err(|e| AppError::BadRequest(format!("invalid_code:bad signature encoding: {e}")))?;

    let client = build_auth_client()?;
    let auth = client
        .auth()
        .ok_or_else(|| AppError::Internal("auth client unavailable".to_string()))?;
    // Relay the wallet's signature to obtain a session (stored in this client's
    // in-memory store). We never hold the user's key — only their signature.
    auth.login_with_wallet_signature(&req.authority, &signature, nonce_id)
        .await
        .map_err(|e| {
            if e.is_rate_limited() {
                AppError::RateLimited(format!("sign-in rate-limited, retry shortly: {e}"))
            } else {
                AppError::Phoenix(format!("auth_failed:{e}"))
            }
        })?;

    // The bearer is now attached; activate the referral on the same client.
    map_activation_result(client.invite().activate_referral(&authority, code).await)
}

// POST /api/onboard/activate-access-code
// Body: { authority, code }
// Same response/error shape as activate_referral. Wraps Phoenix's
// /v1/invite/activate route (allowlist / access-code activation) which is
// distinct from the referral route per the rise-public SDK README.
async fn activate_access_code(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActivateAccessCodeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let authority = Pubkey::from_str(&req.authority).map_err(|e| {
        AppError::BadRequest(format!("invalid_code:invalid authority pubkey: {e}"))
    })?;
    let code = req.code.trim();
    if code.is_empty() {
        return Err(AppError::BadRequest(
            "invalid_code:code is required".to_string(),
        ));
    }

    map_activation_result(
        state
            .http_client
            .invite()
            .activate_invite(&authority, code)
            .await,
    )
}

// GET /api/onboard/check/:pubkey
// Returns: { activated: bool, whitelisted_at: Option<String>, invite_code_used: Option<String> }
// Proxies GET /v1/invite/check/{wallet} on perp-api. The Rust SDK doesn't wrap
// this endpoint so we make the HTTP call directly.
async fn check_onboarding_status(
    State(_state): State<Arc<AppState>>,
    Path(pubkey): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Validate pubkey format so we don't forward garbage to perp-api.
    let _ = Pubkey::from_str(&pubkey)
        .map_err(|e| AppError::BadRequest(format!("invalid authority pubkey: {e}")))?;

    let url = format!("{}/v1/invite/check/{}", perp_api_url(), pubkey);
    let resp = crate::services::http::shared_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Phoenix(format!("perp-api check request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        // 404 → wallet hasn't activated. Match the activated=false shape so the
        // frontend doesn't treat this as an error.
        if status == 404 {
            return Ok(Json(serde_json::json!({
                "activated": false,
                "whitelisted_at": null,
                "invite_code_used": null,
            })));
        }
        let msg = resp.text().await.unwrap_or_default();
        return Err(AppError::Phoenix(format!(
            "perp-api check returned {status}: {msg}"
        )));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| {
        AppError::Phoenix(format!("perp-api check bad json: {e}"))
    })?;

    let activated = body
        .get("whitelisted")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let whitelisted_at = body
        .get("whitelisted_at")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let invite_code_used = body
        .get("invite_code_used")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    Ok(Json(serde_json::json!({
        "activated": activated,
        "whitelisted_at": whitelisted_at,
        "invite_code_used": invite_code_used,
    })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/nonce/{pubkey}", get(get_wallet_nonce))
        .route("/activate-referral", post(activate_referral))
        .route("/activate-access-code", post(activate_access_code))
        .route("/check/{pubkey}", get(check_onboarding_status))
}
