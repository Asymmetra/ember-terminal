//! Community leaderboard — enumerates the full Phoenix trader universe on-chain
//! and ranks active traders by account value.
//!
//! ## How the universe is built (cheap, one RPC call)
//! One `getProgramAccounts` on the Phoenix program, filtered to `Trader`
//! accounts by their 8-byte discriminant, with a `dataSlice` that fetches ONLY
//! the two fields we rank on — `authority` (32 bytes) and `quote_lot_collateral`
//! (i64). That keeps a ~16k-account scan to ~640 KB instead of ~16 MB.
//!
//! On-chain `Trader` layout (verified against phoenix-rise 0.1.3
//! `accounts/trader.rs`):
//! ```text
//! disc(8) · sequence_number(16) · key(32) · authority(32 @ 56) ·
//! state.quote_lot_collateral(i64 @ 88) · …
//! ```
//! `quote_lot_collateral / 10^6` = USD (quote-lot decimals are fixed at 6, per
//! `MarketCalculator::quote_lots_to_usd`).
//!
//! One authority owns several trader PDAs (cross subaccount + one per isolated
//! position), so we group by authority and sum collateral. "Active" = total
//! collateral > 0 (on a perp DEX you can't hold a position without margin, so
//! this is a sound activeness proxy).
//!
//! ## Enrichment (bounded REST)
//! Per-wallet PnL/equity isn't on-chain-cheap and the REST API has no batch
//! endpoint, so after ranking we enrich only the top N leaders via
//! `get_trader` (TraderView → equity, unrealized PnL, # positions). Everyone
//! else shows account value from the scan; full per-trader detail loads lazily
//! on row-expand in the UI via the existing `/api/trader/*` endpoints.
//!
//! The whole thing runs on a timer (see `main.rs`) and is served from an
//! in-memory snapshot, so the board is near-real-time, never computed
//! per-request.

use base64::Engine;
use phoenix_rise::accounts::ACCOUNT_DISCRIMINANTS;
use phoenix_rise::{PhoenixHttpClient, PnlQueryParams, PnlResolution};
use serde::Serialize;
use solana_pubkey::Pubkey;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

/// Phoenix mainnet program id (owns every trader PDA). Stable on mainnet.
const PHOENIX_PROGRAM_ID: &str = "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih";

/// Byte offsets within the on-chain `Trader` account (see module docs).
const AUTHORITY_OFFSET: usize = 56;
const SLICE_LEN: usize = 40; // authority(32) + quote_lot_collateral(8)
/// Quote-lot decimals (fixed at 6 in the SDK's `MarketCalculator`).
const QUOTE_LOT_DECIMALS: i32 = 6;
/// Minimum account value (in quote lots) to count as "active". $1.00 — filters
/// out the long tail of dust accounts that registered but never meaningfully
/// funded, so the ranking + aggregate stats reflect real traders. Dormant /
/// sub-$1 accounts are still reachable via search.
const ACTIVE_MIN_LOTS: i64 = 1_000_000;

/// One ranked trader on the board.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub rank: u32,
    pub authority: String,
    /// Summed collateral across the authority's subaccounts, in USD.
    pub account_value_usd: f64,
    /// Number of trader PDAs (subaccounts) this authority owns.
    pub subaccounts: u32,
    /// True once collateral > 0 (the active set). Dormant accounts are kept for
    /// search but flagged so the UI can exclude them from the ranking.
    pub active: bool,
    // --- enriched (top-N only; None otherwise) ---
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equity_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unrealized_pnl_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_positions: Option<u32>,
    /// ROUGH estimated lifetime trading volume in USD, backed out of cumulative
    /// taker fees ÷ a flat assumed taker-fee rate. Approximate: taker-side only,
    /// and real per-market fee rates vary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume_usd: Option<f64>,
}

/// Aggregate stats across the whole universe, shown in the board header.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardStats {
    /// Trader PDAs (cross + isolated subaccounts).
    pub total_accounts: u32,
    /// Unique authorities (wallets that ever registered).
    pub total_traders: u32,
    /// Authorities with collateral > 0.
    pub active_traders: u32,
    /// Sum of all active collateral, in USD.
    pub total_collateral_usd: f64,
    pub median_account_value_usd: f64,
    pub avg_account_value_usd: f64,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardSnapshot {
    pub stats: LeaderboardStats,
    /// Full universe ranked by account value desc (active first, dormant —
    /// value 0 — at the tail). Held in memory so search can reach every wallet;
    /// the default board view slices the active prefix.
    pub traders: Vec<LeaderboardEntry>,
    pub generated_at_ms: i64,
    /// True until the first successful scan completes.
    pub stale: bool,
    /// Set when the last refresh failed (e.g. RPC can't do getProgramAccounts).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct LeaderboardCache {
    /// Ordered RPC endpoints tried in turn for the scan (failover chain). A
    /// dedicated provider (if configured) sits first; public endpoints follow.
    rpc_urls: Vec<String>,
    /// Number of top leaders to enrich with REST detail each refresh.
    enrich_top: usize,
    inner: RwLock<Arc<LeaderboardSnapshot>>,
}

impl LeaderboardCache {
    pub fn new(rpc_urls: Vec<String>, enrich_top: usize) -> Self {
        Self {
            rpc_urls,
            enrich_top,
            inner: RwLock::new(Arc::new(LeaderboardSnapshot {
                stale: true,
                ..Default::default()
            })),
        }
    }

    /// Current cached snapshot (cheap Arc clone).
    pub async fn snapshot(&self) -> Arc<LeaderboardSnapshot> {
        self.inner.read().await.clone()
    }

    /// Scan + rank, store immediately, then enrich the top leaders in a second
    /// pass and store again. Storing the scan result first means the board
    /// appears within ~1s of a successful scan instead of blocking for minutes
    /// on the (slow, sequential) REST enrichment — which matters most right
    /// after a redeploy when the cache starts empty. On scan failure the
    /// previous snapshot is kept and the error recorded.
    pub async fn refresh(&self, http: &PhoenixHttpClient) {
        let accounts = match fetch_trader_accounts(&self.rpc_urls).await {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!("Leaderboard scan failed: {e}");
                let prev = self.inner.read().await.clone();
                let mut next = (*prev).clone();
                next.error = Some(e.to_string());
                *self.inner.write().await = Arc::new(next);
                return;
            }
        };

        let mut snap = build_base_snapshot(accounts);
        let active = snap.stats.active_traders;
        // Publish the scan result immediately (account values + ranking).
        *self.inner.write().await = Arc::new(snap.clone());
        tracing::info!("Leaderboard scan published: {active} active traders");

        // Second pass: enrich the top leaders, then republish. The frontend
        // also lazily enriches rows as they scroll into view, so deeper rows
        // fill in regardless of this bounded server-side pass.
        let n = self.enrich_top.min(snap.traders.len());
        enrich_top_n(&mut snap.traders, http, n).await;
        *self.inner.write().await = Arc::new(snap);
        tracing::info!("Leaderboard enriched (top {n})");
    }
}

/// Build the ranked snapshot from a raw scan — synchronous, no enrichment.
fn build_base_snapshot(accounts: Vec<(String, i64)>) -> LeaderboardSnapshot {
    let total_accounts = accounts.len() as u32;

    // Group PDAs by authority: (summed collateral lots, subaccount count).
    let mut by_auth: HashMap<String, (i64, u32)> = HashMap::new();
    for (authority, lots) in accounts {
        let e = by_auth.entry(authority).or_insert((0, 0));
        e.0 = e.0.saturating_add(lots);
        e.1 += 1;
    }
    let total_traders = by_auth.len() as u32;

    // Rank by account value desc (active first; dormant tail at value 0).
    let mut ranked: Vec<(String, i64, u32)> = by_auth
        .into_iter()
        .map(|(a, (lots, subs))| (a, lots, subs))
        .collect();
    ranked.sort_by_key(|t| std::cmp::Reverse(t.1));

    // Aggregate stats over the active set (account value > $1).
    let active: Vec<&(String, i64, u32)> = ranked.iter().filter(|t| t.1 > ACTIVE_MIN_LOTS).collect();
    let active_traders = active.len() as u32;
    let total_lots: i128 = active.iter().map(|t| t.1 as i128).sum();
    let total_collateral_usd = lots_i128_to_usd(total_lots);
    let avg_account_value_usd = if active_traders > 0 {
        total_collateral_usd / active_traders as f64
    } else {
        0.0
    };
    // Median of the active set (already sorted desc within `ranked`).
    let median_account_value_usd = if active.is_empty() {
        0.0
    } else {
        lots_to_usd(active[active.len() / 2].1)
    };

    let traders: Vec<LeaderboardEntry> = ranked
        .iter()
        .enumerate()
        .map(|(i, (authority, lots, subs))| LeaderboardEntry {
            rank: i as u32 + 1,
            authority: authority.clone(),
            account_value_usd: lots_to_usd(*lots),
            subaccounts: *subs,
            active: *lots > ACTIVE_MIN_LOTS,
            equity_usd: None,
            unrealized_pnl_usd: None,
            open_positions: None,
            volume_usd: None,
        })
        .collect();

    LeaderboardSnapshot {
        stats: LeaderboardStats {
            total_accounts,
            total_traders,
            active_traders,
            total_collateral_usd,
            median_account_value_usd,
            avg_account_value_usd,
        },
        traders,
        generated_at_ms: now_ms(),
        stale: false,
        error: None,
    }
}

/// Enrich the first `n` (active) leaders in place with REST detail (equity /
/// uPnL / #positions). Sequential with a small inter-call delay to stay under
/// the REST rate limit; `enrich_trader` retries transient failures so active
/// rows reliably populate rather than dropping to "—".
async fn enrich_top_n(traders: &mut [LeaderboardEntry], http: &PhoenixHttpClient, n: usize) {
    for entry in traders.iter_mut().take(n) {
        if !entry.active {
            break;
        }
        if let Ok(pk) = Pubkey::from_str(&entry.authority) {
            if let Some((equity, upnl, positions, volume)) = enrich_trader(http, &pk).await {
                entry.equity_usd = Some(equity);
                entry.unrealized_pnl_usd = Some(upnl);
                entry.open_positions = Some(positions);
                entry.volume_usd = volume;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Flat taker-fee rate used to back out a ROUGH lifetime-volume estimate from a
/// trader's cumulative taker fees (`volume ≈ cumulative_taker_fee / rate`).
/// Phoenix's documented default taker fee is 0.05%; real per-market rates vary,
/// so this is an approximation (and taker-side only). Override with
/// `LEADERBOARD_TAKER_FEE_RATE`.
const DEFAULT_TAKER_FEE_RATE: f64 = 0.0005;

fn taker_fee_rate() -> f64 {
    std::env::var("LEADERBOARD_TAKER_FEE_RATE")
        .ok()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|r| *r > 0.0)
        .unwrap_or(DEFAULT_TAKER_FEE_RATE)
}

/// Rough lifetime-volume estimate (USD) from cumulative taker fees. Best-effort
/// and independent of the main enrichment — `None` on failure so the row still
/// shows its other stats. `cumulative_taker_fee` is monotonic from inception, so
/// the max across returned points is the lifetime total.
async fn estimate_volume(http: &PhoenixHttpClient, authority: &Pubkey) -> Option<f64> {
    // Daily resolution: monthly buckets aren't populated yet (the platform is
    // young) and 1d always has buckets. cumulative_taker_fee is monotonic from
    // inception, so the max across the returned points is the lifetime total.
    let params = PnlQueryParams::new(PnlResolution::Day1).with_limit(400);
    let points = http.traders().get_user_pnl(authority, params).await.ok()?;
    let max_fee = points
        .iter()
        .map(|p| p.cumulative_taker_fee)
        .fold(0.0_f64, f64::max);
    Some((max_fee / taker_fee_rate()).max(0.0))
}

fn lots_to_usd(lots: i64) -> f64 {
    lots as f64 / 10f64.powi(QUOTE_LOT_DECIMALS)
}
fn lots_i128_to_usd(lots: i128) -> f64 {
    lots as f64 / 10f64.powi(QUOTE_LOT_DECIMALS)
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Fetch one trader's aggregated equity / unrealized PnL / open-position count
/// from the REST `get_trader` view (summed across subaccounts). `None` only if
/// every attempt fails. Enrichment fires hundreds of these per refresh, so the
/// REST layer rate-limits some — we retry with backoff so a transient 429
/// doesn't leave an active trader showing "—".
async fn enrich_trader(
    http: &PhoenixHttpClient,
    authority: &Pubkey,
) -> Option<(f64, f64, u32, Option<f64>)> {
    let mut traders = None;
    for attempt in 0..3u32 {
        match crate::services::trader_view::fetch_subaccounts(authority).await {
            Ok(t) => {
                traders = Some(t);
                break;
            }
            Err(_) if attempt < 2 => {
                tokio::time::sleep(Duration::from_millis(200 * (attempt as u64 + 1))).await;
            }
            Err(_) => return None,
        }
    }
    let traders = traders?;
    let value = serde_json::to_value(&traders).ok()?;
    let arr = value.as_array()?;
    let mut equity = 0.0;
    let mut upnl = 0.0;
    let mut positions = 0u32;
    for sub in arr {
        equity += json_f64(sub, "portfolioValue");
        upnl += json_f64(sub, "unrealizedPnl");
        if let Some(ps) = sub.get("positions").and_then(|p| p.as_array()) {
            positions += ps.len() as u32;
        }
    }
    // Rough lifetime-volume estimate — best-effort, doesn't gate the rest.
    let volume_usd = estimate_volume(http, authority).await;
    Some((equity, upnl, positions, volume_usd))
}

/// Read a USD field from a TraderView. The SDK's JS-safe decimals serialize as
/// `{ value, decimals, ui }` (e.g. `{value:3000000, decimals:6, ui:"3.000000"}`),
/// but tolerate a bare number/string too.
fn json_f64(v: &serde_json::Value, key: &str) -> f64 {
    match v.get(key) {
        Some(serde_json::Value::Object(o)) => o
            .get("ui")
            .and_then(|u| u.as_str())
            .and_then(|s| s.parse().ok())
            .or_else(|| {
                // Fall back to value / 10^decimals.
                let value = o.get("value").and_then(json_num)?;
                let decimals = o.get("decimals").and_then(|d| d.as_i64()).unwrap_or(0);
                Some(value / 10f64.powi(decimals as i32))
            })
            .unwrap_or(0.0),
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// Coerce a JSON number-or-stringified-number to f64.
fn json_num(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// `getProgramAccounts(PHOENIX)` filtered to `Trader` accounts, sliced to
/// `authority + quote_lot_collateral`. Returns `(authority_base58, lots)`.
///
/// This is a heavy call and any single free RPC handles it only intermittently,
/// so we fail over across an ordered list of endpoints (dedicated first, then
/// public), retrying each once before moving on. A scan only succeeds-or-fails
/// as a whole, so trying several endpoints makes a transient outage on any one
/// (or a redeploy with an empty cache) far less likely to blank the board.
async fn fetch_trader_accounts(rpc_urls: &[String]) -> anyhow::Result<Vec<(String, i64)>> {
    let disc_b64 = base64::engine::general_purpose::STANDARD.encode(ACCOUNT_DISCRIMINANTS.trader);
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts",
        "params": [ PHOENIX_PROGRAM_ID, {
            "encoding": "base64",
            "dataSlice": { "offset": AUTHORITY_OFFSET, "length": SLICE_LEN },
            "filters": [
                { "memcmp": { "offset": 0, "bytes": disc_b64, "encoding": "base64" } }
            ]
        }]
    });

    let client = crate::services::http::shared_client();
    let mut last_err: Option<anyhow::Error> = None;
    for url in rpc_urls {
        for attempt in 0..2u32 {
            match fetch_trader_accounts_once(client, url, &body).await {
                Ok(out) => {
                    tracing::info!("Leaderboard scan: {} trader accounts via {url}", out.len());
                    return Ok(out);
                }
                Err(e) => {
                    tracing::warn!("scan via {url} attempt {} failed: {e}", attempt + 1);
                    last_err = Some(e);
                    if attempt == 0 {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("all RPC endpoints failed")))
}

/// One getProgramAccounts attempt (send + parse).
async fn fetch_trader_accounts_once(
    client: &reqwest::Client,
    rpc_url: &str,
    body: &serde_json::Value,
) -> anyhow::Result<Vec<(String, i64)>> {
    let resp = client
        .post(rpc_url)
        .json(body)
        .timeout(Duration::from_secs(30))
        .send()
        .await?;
    let v: serde_json::Value = resp.json().await?;
    if let Some(err) = v.get("error") {
        anyhow::bail!("getProgramAccounts error: {err}");
    }
    let result = v
        .get("result")
        .and_then(|r| r.as_array())
        .ok_or_else(|| anyhow::anyhow!("getProgramAccounts: missing result array"))?;

    let mut out = Vec::with_capacity(result.len());
    for item in result {
        let Some(b64) = item
            .get("account")
            .and_then(|a| a.get("data"))
            .and_then(|d| d.get(0))
            .and_then(|s| s.as_str())
        else {
            continue;
        };
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else {
            continue;
        };
        if bytes.len() < SLICE_LEN {
            continue;
        }
        let Ok(authority) = Pubkey::try_from(&bytes[0..32]) else {
            continue;
        };
        let mut c = [0u8; 8];
        c.copy_from_slice(&bytes[32..40]);
        out.push((authority.to_string(), i64::from_le_bytes(c)));
    }
    Ok(out)
}
