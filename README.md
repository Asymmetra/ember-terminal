# Ember Terminal

A high-performance perpetuals trading terminal for [Phoenix](https://phoenix.trade) on Solana. Built with a Rust/Axum backend and Next.js frontend, Ember brings a Bloomberg-grade trading experience to on-chain perpetual futures.

> **Who this repo is for:**
> - **Traders / Phoenix users** — try the live app at the URL below. Connect Phantom, deposit USDC, trade. No setup needed.
> - **Developers building on Phoenix** — Ember is a working reference implementation of the [Phoenix Rise SDK](https://docs.phoenix.trade/sdk/rise). The [Building on Phoenix](#building-on-phoenix) section indexes the canonical patterns this codebase demonstrates and documents the gotchas we hit along the way.
> - **AI coding agents** — every integration pattern lives at a single file path. Read the [Pattern → File index](#pattern--file-index) and open the linked files directly; each is self-contained and heavily commented.

## Live Deployment

- **Frontend**: https://ember.asymmetra.xyz
- **Backend**: https://ember-api.asymmetra.xyz
- **WebSocket**: wss://ember-api.asymmetra.xyz/ws

Try it: open the frontend URL, click **IGNITE TERMINAL**, connect Phantom, deposit some USDC, place a trade. The whole flow runs against Solana mainnet — fees are real but small (sub-cent for limit orders).

## Markets

Ember supports every perp market Phoenix lists. The market set is loaded
dynamically from `/api/markets` at runtime — new markets appear without
a code change. Each market exposes its `maxLeverage` and `isolatedOnly`
flags so the UI can adapt automatically (e.g. SKR forces isolated mode).

## What It Does

Ember Terminal connects directly to Phoenix's on-chain perpetuals markets and provides:

- **Live orderbook** with depth visualization and dynamic row scaling
- **Real-time price chart** powered by Lightweight Charts (TradingView engine)
- **Collateral-first order entry** (Jupiter-style) — enter USDC collateral + leverage, position size computed automatically
- **Market & limit orders** — transactions built server-side, signed via Phantom wallet
- **TP/SL bracket orders** — take-profit and stop-loss levels auto-placed with each position
- **Isolated margin trading** with subaccount management (subaccounts 1–100; index 0 = cross-margin)
- **Isolated-only markets** — SKR and any future isolated-only markets force isolated mode; cross-margin attempts return 400
- **Phoenix activation state** — detects unactivated wallets (flags < 63) and shows actionable onboarding UI instead of silently failing
- **Dynamic subaccount collateral** — CollateralModal displays true effective collateral per subaccount (not per-position allocated margin)
- **Position management** — view open positions, close individual or close all with confirmation
- **Deposit/withdraw USDC** collateral directly from the terminal
- **Portfolio summary bar** — collateral, unrealized PnL, portfolio value, margin usage
- **Onboarding** — modal flow for unactivated wallets, with two paths (referral code or invite/access code), or "browse anyway" for read-only exploration
- **Profile** — `/profile` is a full trader-analytics dashboard for the connected wallet (or any wallet via `?trader=<pubkey>`): a risk-adjusted scorecard (Sharpe, Sortino, Calmar, max drawdown, profit factor, win rate, expectancy, payoff — each with a methodology tooltip and a heuristic quality band), lifetime headline + a windowed stats strip that smart-defaults to the narrowest window containing trades, an equity/drawdown curve, a daily-PnL calendar heatmap, a trade-PnL distribution, an activity-by-hour view with behavioral tiles, a per-market breakdown, a cursor-paginated trade journal, a market benchmark (your return vs SOL/BTC buy-&-hold over the same window), and head-to-head comparison against any pasted wallet or a suggested profile. (`/accounts` redirects here.)
- **Wallet Lookup** — `/lookup` is a support/debugging tool: paste any Solana wallet to inspect every Phoenix interaction it has had — onboarding/activation state, all subaccounts (cross + isolated) with positions and open orders, and a unified activity timeline merging fills, deposits, withdraws, transfers, and funding (each row linked to Solscan; cross→isolated transfers annotated to the order they fund).
- **Stats** — `/stats` developer-facing dashboard streaming live cadence/latency/spread data for every Phoenix WS channel, with API playground snippets for replicating in another stack
- **Multi-market switching** with instant data refresh (no stale state)
- **Resizable panels** — drag to resize any section, layout persists across sessions
- **WebSocket streaming** — orderbook, trades, stats, and trader state update in real time
- **Slippage protection** — configurable max slippage (200bps default, 500bps for close-all) on all 4 market order paths
- **Error boundaries** — independent crash isolation for Chart, Orderbook, Order Entry, and Positions sections with retry
- **Trade deduplication** — 30-second guard preventing duplicate transaction submissions across all 9 TX paths
- **Wallet connect** with Phantom

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│  Next.js 16 · React 19 · Zustand · Lightweight Charts   │
│  Phantom Wallet Adapter · TailwindCSS 4                 │
└──────────┬──────────────────────┬───────────────────────┘
           │ REST (HTTPS)         │ WebSocket (WSS)
           ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│                   Ember Backend                         │
│              Rust · Axum · Tokio                         │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ REST Routes  │  │  WS Handler  │  │  TX Builder   │  │
│  │ /api/*       │  │  /ws         │  │  (instructions│  │
│  │ markets,     │  │  orderbook,  │  │   for Phantom │  │
│  │ orderbook,   │  │  trades,     │  │   to sign)    │  │
│  │ trader,      │  │  stats,      │  │               │  │
│  │ candles      │  │  trader_     │  │               │  │
│  │              │  │  margin      │  │               │  │
│  └──────┬───── ┘  └──────┬──────┘  └───────────────┘  │
│         │                │                              │
│         ▼                ▼                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │      Phoenix Rise SDK (crates.io: phoenix-rise)  │    │
│  └──────────────────────┬──────────────────────────┘    │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Phoenix Protocol    │
              │   Solana Mainnet      │
              └───────────────────────┘
```

**Key design decisions:**

- **Backend builds, frontend signs** — the Rust backend constructs transaction instructions using the Phoenix SDK. The frontend deserializes them, simulates via RPC, and the user signs with Phantom. Private keys never leave the wallet.
- **No local database** — Phoenix on-chain state is the source of truth. REST fetches current state, WebSocket streams updates into Zustand stores.
- **SDK WebSocket relay** — the backend maintains a persistent upstream WS connection to Phoenix and fans out updates to all connected browser clients.

## Building on Phoenix

This codebase is a working reference for [Phoenix Rise SDK](https://docs.phoenix.trade/sdk/rise) integration. If you're building your own trading UI, bot, mobile client, or analytics tool against Phoenix, the patterns here map directly to what you'll need.

### Integration patterns demonstrated

| Pattern | What it does | Canonical file |
|---|---|---|
| TX instruction building | Construct Solana TX instructions server-side using `phoenix-rise`; serialize as JSON for the browser to deserialize and sign with Phantom. Private keys never touch the server. | `ember-backend/src/services/tx_builder.rs` |
| WS relay (fan-out) | One persistent upstream connection to `wss://perp-api.phoenix.trade/ws` multiplexed to N browser clients via Tokio `broadcast` channels. | `ember-backend/src/ws/relay.rs` |
| Direct WS (no relay) | Browser connects to Phoenix WS directly — what you'd use in a mobile / React Native client where running a backend adds little value. Includes a subscription reconciler that diffs desired vs current and sends only deltas. | `ember-frontend/src/hooks/useObservability.ts` |
| Sign + simulate + submit | Frontend deserializes the backend's instructions, simulates via RPC, prompts Phantom, sends, confirms. | `ember-frontend/src/lib/solana.ts` |
| Live PnL from mark price | Computes per-tick PnL as `(markPx − entryPx) × size` between backend refreshes — matches Phoenix's on-chain accounting. | `ember-frontend/src/hooks/useLivePositionPnl.ts` |
| Trader state read | Fetch positions, orders, balances, fills, funding from the Phoenix SDK and shape for the UI. | `ember-backend/src/routes/trader.rs` |
| Onboarding (off-chain) | Proxy Phoenix's `/v1/invite/*` activation routes for the dual-path (referral / access code) flow. | `ember-backend/src/routes/onboarding.rs` |
| Builder fees (Flight) | Charge a fee on top of routed orders, credited to a builder account — wrap each order-placement ix via `PhoenixFlightClient::try_wrap_order_instruction` (non-order ixs pass through). One-time registration via `create_register_builder_ix`. | `ember-backend/src/services/flight.rs` |
| Snippet generation | Per-channel TypeScript + Rust code snippets generated from a single source descriptor — useful as a template for your own integration. | `ember-frontend/src/lib/observability/snippets.ts` |

For deeper architectural rationale on the observability and snippet machinery, see `ember-frontend/src/app/stats/DESIGN.md`.

### Phoenix SDK gotchas

Things that surprised us during this build. Worth knowing before you hit them yourself:

- **`subscribe_to_market` publishes at ~1Hz, exactly.** Empirically verified across BTC, SOL, ETH, and microcap markets — same cadence regardless of liquidity. p95 ≤ 1.07s with no silent gaps. Don't expect sub-second oracle updates from this channel; if you need higher frequency for visible chart motion, subscribe to `orderbook` (~2Hz on liquid markets) alongside and interpolate locally.
- **Use `markPx`, not `oraclePx`, for PnL.** Phoenix's `unrealized_pnl` field is computed from mark, not oracle. Mark is EMA-smoothed (≈5bp typical gap vs oracle) and clipped to an execution band — anything else creates drift between your UI's PnL and what Phoenix's on-chain math says.
- **`openInterest` is in BASE asset units, NOT USD.** `openInterest: 10.34` for BTC means "10.34 BTC of OI", not $10.34. Multiply by `markPx` for USD. (We hit this in our own `/stats` overview — see `ember-frontend/src/components/stats/MarketOverview.tsx` for the correct calc.)
- **The `/v1/invite/*` system is NOT an on-chain gate.** Any wallet can register, deposit, and trade without ever activating an invite. Phoenix stores `invite_code_used` per wallet, but if a user hits Phoenix's own UI first they bypass your activation flow entirely. If you need real referral attribution, track activations server-side.
- **Stagger subscribes on connect.** Phoenix's server queues `subscribe` messages; flooding 100+ in one synchronous burst on `onopen` adds seconds to time-to-first-data. Split into batches with small (~250ms) gaps — see `useObservability.ts:reconcile`.
- **Subscribe only to what you'll consume.** High-volume channels (orderbook at ~10Hz × N markets) compete for bandwidth on the single WebSocket and starve lower-volume channels. The observability page demonstrates a reconciler that adds/removes subscriptions on demand instead of subscribing to everything at once.
- **Flight builder fees are a single on-chain rate — no per-order fee.** `register_builder` stores one `fee_bps` in the builder-state PDA; the `proxy_instruction` wrapper carries no fee (it just routes the inner order so the program reads the registered rate). So tiered/dynamic per-order fees aren't possible without protocol support — pick one rate (changeable later via `update_fee`). The fee is charged on **notional** and accrues to the builder's trader account, withdrawable as normal collateral (no special claim instruction). `try_wrap_order_instruction` only wraps placement ixs (market, limit, stop-loss, conditional variants) and passes everything else through.

### Phoenix WS protocol cheat-sheet

```ts
const ws = new WebSocket("wss://perp-api.phoenix.trade/ws");

// Subscribe — every channel uses the same envelope
ws.send(JSON.stringify({
  type: "subscribe",
  subscription: { channel: "market", symbol: "BTC" },
}));

// Channels and the shape of their inbound messages:
//   market       → { oraclePx, markPx, midPx, openInterest, prevDayPx, dayNtlVlm, funding }   (1Hz)
//   allMids      → { mids: { SYMBOL: price, ... }, slot }                                     (global heartbeat)
//   fundingRate  → { symbol, funding }                                                        (per-epoch)
//   orderbook    → { bids: [[px, sz], ...], asks: [[px, sz], ...] }                           (~2Hz on liquid)
//   trades       → { trades: [{ side, px, sz, ts }] }                                         (event-driven)
//   candles      → { candle: { o, h, l, c, v }, timeframe }                                   (per-interval)

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.channel === "market") { /* m.oraclePx, m.markPx, ... */ }
};

// Unsubscribe — same envelope with type: "unsubscribe"
```

### Pattern → File index

If you only want to read one file to learn each pattern, here's the canonical answer:

- "How do I build a market or limit order?" → `ember-backend/src/services/tx_builder.rs`
- "How do I subscribe to Phoenix's WebSocket directly?" → `ember-frontend/src/hooks/useObservability.ts`
- "How do I sign + simulate + submit a transaction?" → `ember-frontend/src/lib/solana.ts`
- "How do I compute live position PnL?" → `ember-frontend/src/hooks/useLivePositionPnl.ts`
- "How do I fetch a trader's positions, orders, and fills?" → `ember-backend/src/routes/trader.rs`
- "How do I list markets and their config?" → `ember-backend/src/routes/markets.rs`
- "How do I onboard a wallet with an invite/referral code?" → `ember-backend/src/routes/onboarding.rs`
- "How do I generate working code snippets for any Phoenix WS channel?" → `ember-frontend/src/lib/observability/snippets.ts`

## API Surface

### Data Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/markets` | All markets with `isolatedOnly` and `maxLeverage` fields per market |
| `GET /api/markets/:symbol` | Single market config |
| `GET /api/orderbook/:symbol` | Live orderbook |
| `GET /api/candles/:symbol` | OHLCV candlestick data |
| `GET /api/trades/:symbol/recent` | Recent market trades feed |
| `GET /api/trader/:pubkey` | Trader account state (all subaccounts) |
| `GET /api/trader/:pubkey/subaccounts` | List of subaccounts (cross + isolated) |
| `GET /api/trader/:pubkey/orders` | Order history (cursor-paginated) |
| `GET /api/trader/:pubkey/trades` | Fill history (cursor-paginated) |
| `GET /api/trader/:pubkey/funding` | Funding-payment history |
| `GET /api/trader/:pubkey/pnl` | Cumulative PnL time-series (`?resolution=&limit=`) |
| `GET /api/trader/:pubkey/collateral-history` | Deposit / withdraw / transfer events |

### Onboarding Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/onboard/check/:pubkey` | Whether a wallet has activated, and which invite code (if any) it used |
| `POST /api/onboard/activate-referral` | Activate a wallet with another trader's referral code |
| `POST /api/onboard/activate-access-code` | Activate a wallet with an allowlist/access code |

### Flight (builder fees)

| Endpoint | Description |
|----------|-------------|
| `GET /api/flight/config` | Whether builder fees are active, the fee (bps), and the builder account that collects them — drives the order-entry fee disclosure |

### Health Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check (process is up) |
| `GET /health/memory` | RSS / heap / known-trader count for ops monitoring |
| `GET /health/relay` | Upstream Phoenix WS relay state |
| `GET /health/ws` | Active downstream WS subscriber counts by prefix |

### Transaction Endpoints

All transaction endpoints are under `/api/tx/`:

| Endpoint | Description |
|----------|-------------|
| `POST /api/tx/market-order` | Cross-margin market order |
| `POST /api/tx/limit-order` | Cross-margin limit order |
| `POST /api/tx/isolated-market-order` | Isolated margin market order — **requires `subaccount_index` (1–100)** |
| `POST /api/tx/isolated-limit-order` | Isolated margin limit order — **requires `subaccount_index` (1–100)** |
| `POST /api/tx/cancel-orders` | Cancel open orders |
| `POST /api/tx/deposit` | Deposit USDC collateral |
| `POST /api/tx/withdraw` | Withdraw USDC collateral |
| `POST /api/tx/transfer-collateral` | Transfer collateral between subaccounts |
| `POST /api/tx/register-subaccount` | Register a new isolated margin subaccount |
| `POST /api/tx/close-all-positions` | Close every open position in one transaction |
| `POST /api/tx/place-multi-limit-orders` | Batch multiple limit orders (up to 10) in one transaction |
| `POST /api/tx/cancel-stop-loss` | Cancel a specific TP/SL bracket leg by direction |

> **Note:** `/api/tx/isolated-limit-order` and `/api/tx/isolated-market-order` require an explicit `subaccount_index` field (integer 1–100). Omitting it returns `400 Bad Request`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (Turbopack), React 19, TypeScript, TailwindCSS 4 |
| State | Zustand 5 (12 stores: market, multiOrder, orderbook, trade, trader, tradeDetail, profileDetail, stats, statsChart, statsChartHistory, toast, ui) |
| Charts | Lightweight Charts 4 (TradingView engine) + `liveline` (live streaming series on `/stats`) |
| Wallet | Phantom via @solana/wallet-adapter-react |
| Backend | Rust, Axum 0.8, Tokio, Tower-HTTP |
| SDK | [`phoenix-rise`](https://crates.io/crates/phoenix-rise) (Rust crate from crates.io) |
| Chain | Solana mainnet |
| Layout | react-resizable-panels with localStorage persistence |

## Repo Structure

```
ember-terminal/
├── ember-backend/              # Rust/Axum API server
│   └── src/
│       ├── main.rs             # Server entrypoint, CORS, routing
│       ├── config.rs           # Environment-based configuration
│       ├── routes/             # REST endpoints
│       │   ├── markets.rs      # GET /api/markets, /api/markets/:symbol
│       │   ├── orderbook.rs    # GET /api/orderbook/:symbol
│       │   ├── candles.rs      # GET /api/candles/:symbol
│       │   ├── trades.rs       # GET /api/trades/:symbol/recent
│       │   ├── trader.rs       # GET /api/trader/:pubkey (+ /trades, /orders, /funding, /pnl, ...)
│       │   ├── trade.rs        # POST /api/tx/* (orders, deposit, withdraw, transfer, close-all, ...)
│       │   └── onboarding.rs   # /api/onboard/* (activation + invite proxy)
│       ├── ws/                 # WebSocket server
│       │   ├── handler.rs      # Client connection management
│       │   ├── relay.rs        # Upstream Phoenix WS → client fan-out
│       │   └── messages.rs     # Subscribe/unsubscribe protocol
│       ├── services/           # Business logic
│       │   ├── tx_builder.rs   # Transaction instruction construction
│       │   ├── broadcast.rs    # WS broadcast channels
│       │   └── market_cache.rs # In-memory market data cache
│       └── phoenix/            # SDK type wrappers
│
├── ember-frontend/             # Next.js trading terminal UI
│   └── src/
│       ├── app/                # App router: / (landing) + /terminal + /profile
│       │                       #   + /lookup + /stats + /accounts (→ /profile redirect)
│       ├── components/
│       │   ├── landing/        # Landing page (particle animation, hero)
│       │   ├── terminal/       # Trading terminal (Chart, Orderbook, OrderEntry,
│       │   │                   #   Positions, MarketHeader, PortfolioSummaryBar, ...)
│       │   ├── profile/        # Analytics dashboard (ScoreCard, EquityChart, PnlCalendar,
│       │   │                   #   PnlDistribution, BenchmarkPanel, ComparePanel, ...)
│       │   ├── lookup/         # Wallet inspector (WalletOverviewCard, ActivityTimeline, ...)
│       │   ├── stats/          # Observability dashboard (LiveComparisonChart, SourceTable, ...)
│       │   ├── onboarding/     # Activation gate + modal
│       │   ├── layout/         # TerminalGrid (resizable panel layout)
│       │   └── shared/         # PageNav, WalletButton, ErrorBoundary, Toasts, ...
│       ├── stores/             # Zustand state (12 stores)
│       ├── hooks/              # Custom hooks (WS, trader sync, tx builder, useTraderProfile)
│       ├── lib/                # Utilities (API client, WS client, formatting, metrics)
│       ├── providers/          # React context providers (wallet, etc.)
│       └── types/              # Shared TypeScript types
│
├── tests/                      # Automated E2E suite
│   ├── run.mjs                 # Canonical entry point — simulate by default, --send to broadcast
│   └── lib/harness.mjs         # build → sign → simulate → (optionally) send + confirm
│
├── .github/workflows/
│   ├── ci.yml                  # clippy + cargo test + tsc + lint + build
│   └── deploy.yml              # Example: push to main → SSH-triggered container deploy
├── Dockerfile                  # Multi-stage Rust build for production
└── .gitignore
```

## Local Development

### Prerequisites

- **Rust** (1.75+) — [rustup.rs](https://rustup.rs)
- **Node.js** (20+) — [nodejs.org](https://nodejs.org)
- **Solana RPC URL** — free tier from [Helius](https://helius.dev), [QuickNode](https://quicknode.com), or similar (public RPC rate-limits transaction flows)

### Backend

```bash
cd ember-backend

# No env vars required for defaults (Phoenix public API, port 3001)
# Optional: CORS_ORIGIN, PHOENIX_API_KEY, RUST_LOG
cargo run
```

The backend starts on `http://localhost:3001`. Health check: `GET /health`.

### Frontend

```bash
cd ember-frontend
npm install

# Create .env.local with your RPC URL
cat > .env.local << 'EOF'
NEXT_PUBLIC_SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
EOF

npm run dev
```

Open `http://localhost:3000`. The landing page loads first — click **IGNITE TERMINAL** to enter the trading interface.

## Deployment

Frontend on **Vercel**, backend as a **Docker container on any host that runs long-lived processes**. That constraint is the whole story: the backend holds a persistent upstream WebSocket to Phoenix and fans it out to browsers, so it cannot go on a serverless platform that freezes idle instances.

### 1. Backend — any container host

Built from the repo-root `Dockerfile`. It needs exactly three things:

- one long-lived container (no scale-to-zero),
- outbound WebSocket access to Phoenix,
- `CORS_ORIGIN` set to your frontend's origin.

Nothing in the image is host-specific. The reference deployment uses a self-hosted box, but Fly, Railway, Render, ECS, or a plain VPS with `docker compose` all work.

Deploys can run from CI. `.github/workflows/deploy.yml` is a working example of the pattern for a host whose control plane is firewalled off the public internet — CI opens an SSH connection and triggers the deploy locally, rather than the host exposing a webhook endpoint:

```
git push origin main
  └─ GitHub Actions
       └─ ssh $HOST "deploy $APP_UUID"    # key is command-restricted
            └─ platform API over loopback → build → restart
```

If you copy that pattern, restrict the deploy key in `authorized_keys` to a single wrapper command that validates its argument. A key that can only invoke one deploy script cannot open a shell if it leaks.

Two things that will cost you an afternoon otherwise:

- **In-container health checks fail against a healthy app.** The slim Debian runtime image ships neither `curl` nor `wget`, so any platform that probes by shelling one of them *inside* the container sees a failure and may roll back a deploy that actually started fine. `/health` is the right liveness probe — call it from outside.
- **The image sets and exposes `PORT=10000`.** Point your platform's router at that, or override `PORT`.

### 2. Frontend — Vercel

Vercel project with **Root Directory** set to `ember-frontend`. Environment:

- `NEXT_PUBLIC_API_URL` = your backend origin, e.g. `https://api.example.com`
- `NEXT_PUBLIC_WS_URL` = the same host over WebSocket, e.g. `wss://api.example.com/ws`
- `NEXT_PUBLIC_SOLANA_RPC` = your Solana RPC URL

> **Changing the backend origin? You must also edit `ember-frontend/vercel.json`.**
> It pins a Content-Security-Policy whose `connect-src` allowlists the API host
> explicitly. When this backend last changed origin, swapping `NEXT_PUBLIC_API_URL` alone
> left **every** request blocked in the browser: the build succeeded, the deploy
> went green, the page rendered, and the only evidence was in the browser
> console. Add the new origin under both `https://` and `wss://`, and check the
> hardcoded fallbacks in `src/hooks/useObservability.ts`,
> `src/lib/observability/snippets.ts` and `src/components/stats/SourceTable.tsx`.

### Ongoing Updates

Both halves deploy on `git push origin main` — Vercel from its own git integration, the backend through the GitHub Actions workflow above.

### Forking this

Set `CORS_ORIGIN` to your frontend origin, and put that same backend origin in `vercel.json`'s CSP — those two are the only wiring that has to agree across the two halves.

## Environment Variables

### Backend (runtime)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port. The production Dockerfile sets `10000`. |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed origin(s), comma-separated |
| `PHOENIX_API_URL` | `https://perp-api.phoenix.trade` | Phoenix REST API |
| `PHOENIX_WS_URL` | `wss://perp-api.phoenix.trade/ws` | Phoenix WebSocket |
| `PHOENIX_API_KEY` | — | Optional API key |
| `RUST_LOG` | `ember_backend=info` | Log level filter |
| `FLIGHT_BUILDER_AUTHORITY` | — | Flight builder wallet that collects fees. **Unset = builder fees disabled** (orders go out unwrapped). |
| `FLIGHT_FEE_BPS` | `10` | Builder fee in basis points (display) — **must equal the on-chain registered rate**. |
| `FLIGHT_BUILDER_PDA_INDEX` | `0` | Builder trader PDA index. |
| `FLIGHT_BUILDER_SUBACCOUNT_INDEX` | `0` | Builder subaccount index. |

### Frontend (build-time)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Backend REST URL |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` | Backend WebSocket URL |
| `NEXT_PUBLIC_SOLANA_RPC` | — | Solana RPC endpoint (required) |

> **Note:** `NEXT_PUBLIC_*` variables are baked in at build time. Changing them requires a redeploy.

## How Trading Works

1. User connects Phantom wallet
2. Frontend fetches trader account data from backend (which queries Phoenix SDK)
3. User enters USDC collateral amount and leverage multiplier — position size is computed automatically
4. User selects order type (market or limit), side (long/short), and optionally sets TP/SL levels
5. Backend builds the transaction instructions using Phoenix SDK
6. Frontend deserializes instructions, simulates the transaction via Solana RPC
7. Phantom prompts the user to sign
8. Signed transaction is sent to Solana
9. Frontend confirms the transaction on-chain, then refreshes trader state
10. WebSocket streams deliver real-time updates for positions, orderbook, and trades

## Testing

The automated E2E suite (`tests/e2e-expanded.mjs`) drives the full trade
lifecycle against the live backend using a funded test wallet. It covers
multi-market cross-margin orders, isolated subaccount flows, cross↔isolated
collateral transfers, and per-market coverage across the Phoenix listing.

```bash
cd tests
npm install

# Point the tests at your own funded test wallet (gitignored — see .keys/)
cp .env.example .env  # fill in RPC_URL with a mainnet Solana RPC
export KEYPAIR_PATH=/absolute/path/to/your/test-wallet.json
node e2e-expanded.mjs
```

Each test prints `PASS` / `FAIL`; a clean run finishes with the wallet
back at its starting collateral balance and zero open orders/positions.

> **Point the suite at a backend.** `tests/lib/harness.mjs` defaults to
> `http://localhost:3001`. Export `BACKEND=https://your-api.example.com` to run
> it against a deployed instance instead.

> **Note:** Tests transact on Solana mainnet with real fees. Use a wallet
> funded with a small balance (≤ $20 USDC) reserved for testing, and don't
> run the suite repeatedly in a tight loop.

## Known Limitations

| Area | Detail |
|------|--------|
| Activation state check | Uses `flags >= 63` rather than strict bitmask `(flags & 63) === 63`. Works correctly for Phoenix's current sequential activation lifecycle; would misclassify a wallet if Phoenix ever sets non-sequential high bits without first setting all lower bits. Low practical risk. |
| Collateral state propagation | After a `transfer-collateral` transaction confirms, `/api/trader/` may return stale balances for ~5–10 seconds. The UI reflects the lag until the next WebSocket-triggered refresh. |
| Frontend E2E coverage | The automated test suite (`tests/e2e-expanded.mjs`) covers the full backend/API layer with real on-chain transactions. UI-specific features (activation state display, CollateralModal balance) are verified by code review; no browser-driven test harness exists yet. |

## Future Work

Features planned but not yet implemented, roughly by priority:

- **Testnet toggle** — switch between mainnet and Phoenix devnet without code changes
- **Trader percentile ranking** — "your Sharpe beats X% of Phoenix traders" on `/profile`. Needs new stateful backend infra (trader discovery + a scheduled metrics-snapshot job + a percentile endpoint); the current backend is a stateless Phoenix proxy, so this is deferred. The dashboard ships self-comparison + market benchmark + head-to-head in the meantime.
- **Advanced orders** — trailing stops, bracket orders with multiple TP levels, OCO
- **Referral tracking** — backend counters for invite-code redemptions (currently Phoenix-side only; no aggregate query)
- **Copy trading** — follow and mirror another trader's positions in real time
- **PWA / mobile** — installable app with responsive layout for mobile trading

## Contributing

Pull requests welcome. A few notes if you're forking or sending changes:

- The Phoenix SDK is upstream — depend on the `phoenix-rise` crate from
  crates.io. Do not vendor it back into this repo.
- Run `tsc --noEmit` before opening a frontend PR; `cargo clippy -- -D warnings`
  for backend changes.
- The automated test suite must remain non-interactive — no browser
  drivers, no manual sign-in steps.
- Never commit secrets. `.gitignore` covers `.keys/`, `.env*` (except
  `.env.example`), `.vercel/`, and `known_traders.json`; if you add a
  new kind of secret file, extend the ignore rules first.

## License

MIT — see [LICENSE](./LICENSE). Use it for anything, commercial included. The
only obligation is keeping the copyright notice on copies of this source.

### Third-party licenses

Nothing in this repo's dependency chain restricts that. The Phoenix components
are permissively licensed, and this project consumes them as published packages
rather than vendoring their source, so no additional attribution is required
here:

| Component | License | How it's used |
|---|---|---|
| [`phoenix-rise`](https://github.com/Ellipsis-Labs/rise-public) | MIT | crates.io dependency — the Rust SDK |
| `phoenix-rise-litesvm-test` | MIT | crates.io dev-dependency — localnet test fixtures |
| `@solana/web3.js` | Apache-2.0 | npm dependency |
| Next.js, React, Tailwind, Zustand | MIT | npm dependencies |

If you *do* vendor Phoenix's SDK source into a fork, MIT requires you to carry
their copyright notice alongside it — depending on the published crate, as this
repo does, avoids the question entirely.

### Disclaimer

This is reference software for learning how to build on Phoenix. It places real
orders against a live perpetual-futures protocol on Solana mainnet. Nothing here
is financial advice, and trading perpetuals carries risk of total loss. Run the
test suite with a small dedicated wallet, and read Phoenix's own
[risk warning](https://docs.phoenix.trade/phoenix/margin-and-risk/risk-warning)
before trading. Provided "as is", without warranty — see LICENSE.
