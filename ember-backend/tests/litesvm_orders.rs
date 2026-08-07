//! Order-building tests that run entirely offline, against LiteSVM.
//!
//! Why this exists: the E2E suite in `tests/` signs and simulates against
//! Solana mainnet, which needs a funded wallet. That's a hard prerequisite for
//! anyone who just cloned the repo. These tests exercise the *same*
//! `PhoenixTxBuilder` path the backend's `/api/tx/*` routes use, but against an
//! in-process SVM seeded with Phoenix's own fixture — no wallet, no funds, no
//! network round-trip per assertion.
//!
//! Running them needs Phoenix's on-chain program binaries.
//!
//! Option 1 — pull them from mainnet, no Phoenix checkout required:
//!
//! ```text
//! export PHOENIX_MAINNET_BPF_PROGRAMS=1
//! export PHOENIX_MAINNET_RPC_URL=<your RPC URL>
//! cargo test --test litesvm_orders
//! ```
//!
//! Option 2 — point at a local Phoenix build:
//!
//! ```text
//! export PHOENIX_REPO_ROOT=/path/to/phoenix
//! cargo test --test litesvm_orders
//! ```
//!
//! With neither set, every test here **skips** rather than fails — `cargo test`
//! stays green on a fresh clone.

use phoenix_rise::api::PhoenixMetadata;
use phoenix_rise::core::{MarketOrderTicket, PhoenixTxBuilder};
use phoenix_rise::math::direction::Side;
use phoenix_rise_litesvm_test::{
    SdkLocalnetContext, default_sdk_localnet_fixture, find_sdk_localnet_program_paths,
    phoenix_metadata_from_fixture,
};

/// Build a ready-to-use localnet context, or `None` when the protocol program
/// artifacts aren't available in this environment.
fn try_context() -> Option<(SdkLocalnetContext, PhoenixMetadata)> {
    let fixture = default_sdk_localnet_fixture().ok()?;
    let program_paths = find_sdk_localnet_program_paths()?;
    let metadata = phoenix_metadata_from_fixture(&fixture);

    let mut ctx = SdkLocalnetContext::new_with_programs(fixture, program_paths, []);
    ctx.execute_setup();
    Some((ctx, metadata))
}

/// Emit the skip reason once, so a green run without artifacts is still
/// self-explaining rather than silently vacuous.
fn skip_notice(test: &str) {
    eprintln!(
        "SKIP {test}: Phoenix program artifacts unavailable. \
         Set PHOENIX_MAINNET_BPF_PROGRAMS=1 (+ PHOENIX_MAINNET_RPC_URL) \
         or PHOENIX_REPO_ROOT to run it."
    );
}

/// A market order built exactly the way `/api/tx/market-order` builds it should
/// land on-chain. This is the single most valuable thing to cover offline: it
/// catches ticket-construction and account-ordering regressions that otherwise
/// only surface when a real user signs a real transaction.
#[tokio::test]
async fn market_order_executes_against_localnet() {
    let Some((mut ctx, metadata)) = try_context() else {
        skip_notice("market_order_executes_against_localnet");
        return;
    };

    let taker = ctx.actor("taker0");
    let authority = ctx.actor_pubkey("taker0");
    let trader_account = ctx.actor_trader("taker0");

    let builder = PhoenixTxBuilder::new(&metadata);

    let ticket = MarketOrderTicket::builder()
        .authority(authority)
        .trader_account(trader_account)
        .symbol("BTC".to_string())
        .side(Side::Bid)
        .num_base_lots(1)
        .subaccount_index(0)
        .build()
        .expect("market order ticket should build");

    let instructions = builder
        .place_market_order(ticket)
        .await
        .expect("SDK should build place_market_order instructions");

    assert!(
        !instructions.is_empty(),
        "expected at least one instruction for a market order"
    );

    ctx.send_instructions(instructions, &taker.seed, "market order");
}

/// Documents a real SDK footgun: `MarketOrderTicket` accepts `num_base_lots(0)`
/// and `place_market_order` happily returns a well-formed instruction for it.
/// Nothing upstream rejects a zero-size order, so **callers must validate size
/// themselves** — otherwise you hand a user a transaction to sign that does
/// nothing. Every `/api/tx/*` route in this repo calls `validate_size_lots`
/// before touching the builder, which is why this repo is safe.
///
/// If a future SDK release starts rejecting zero-lot orders, this test fails
/// and tells us the guard is now redundant.
#[tokio::test]
async fn zero_size_order_is_not_rejected_by_the_sdk() {
    let Some((ctx, metadata)) = try_context() else {
        skip_notice("zero_size_order_is_not_rejected_by_the_sdk");
        return;
    };

    let authority = ctx.actor_pubkey("taker0");
    let trader_account = ctx.actor_trader("taker0");
    let builder = PhoenixTxBuilder::new(&metadata);

    let ticket = MarketOrderTicket::builder()
        .authority(authority)
        .trader_account(trader_account)
        .symbol("BTC".to_string())
        .side(Side::Bid)
        .num_base_lots(0)
        .subaccount_index(0)
        .build();

    let ticket = ticket.expect("SDK currently accepts a zero-lot ticket");
    let instructions = builder
        .place_market_order(ticket)
        .await
        .expect("SDK currently builds instructions for a zero-lot order");

    assert!(
        !instructions.is_empty(),
        "SDK behaviour changed: zero-lot orders are now rejected upstream, so the \
         validate_size_lots() guards in src/routes/trade.rs may be redundant"
    );
}
