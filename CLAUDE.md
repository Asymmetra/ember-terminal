# Ember Terminal — Contributor & Agent Guide

Conventions for working in this repo. Applies to humans and coding agents alike.

## Repository Structure

- `ember-frontend/` — Next.js frontend (TypeScript, Tailwind)
- `ember-backend/` — Rust/Axum backend (depends on the `phoenix-rise` crate from crates.io)
- `tests/` — Automated E2E suite. `tests/run.mjs` is the canonical entry point.

## Workflow

- Work on `main`. Keep changes small and self-contained.
- Never commit secrets. `.gitignore` already covers `.env*`, `.keys/`, `*keypair.json`,
  and `.vercel/` — if you add a new kind of credential file, add it there first.

## Build & Verification Gates

There is no CI pipeline — run both locally before you commit:

1. **Frontend** — `cd ember-frontend && npx tsc --noEmit && npm run lint`
2. **Backend** — `cd ember-backend && cargo clippy -- -D warnings && cargo test`

## Rules

1. **No simulated or fake data.** Real API calls only. If an endpoint is
   unavailable, surface the error — do not fabricate a plausible response.
2. **The Phoenix SDK is upstream.** Depend on the `phoenix-rise` crate from
   crates.io. Do not vendor it into this repo. Docs: https://docs.phoenix.trade/sdk/rise
3. **All testing is automated.** No browser interaction, no manual steps.
4. **Transaction building is server-side; signing is client-side.** The backend
   returns unsigned instructions; the wallet signs. The backend never holds a key.

## Testing

Two independent layers. Prefer the offline one — it needs no wallet and no funds.

### Offline: LiteSVM (no wallet required)

```bash
cd ember-backend
export PHOENIX_MAINNET_BPF_PROGRAMS=1
export PHOENIX_MAINNET_RPC_URL=<your RPC URL>
cargo test --test litesvm_orders
```

Runs the real Phoenix programs inside an in-process SVM, seeded with the SDK's
own fixture (BTC/ETH/SOL markets, funded actors). It exercises the same
`PhoenixTxBuilder` path the `/api/tx/*` routes use, so ticket-construction and
account-ordering regressions get caught without signing anything on mainnet.

Programs come either from mainnet (above) or a local Phoenix checkout via
`PHOENIX_REPO_ROOT`. **With neither set the tests skip rather than fail**, so
`cargo test` is green on a fresh clone.

### Online: mainnet E2E (wallet required)

```bash
cd tests
cp .env.example .env          # set RPC_URL
node run.mjs                  # simulate-only (safe default)
node run.mjs --send           # broadcast to mainnet — spends real funds
```

`run.mjs` simulates by default and only signs/sends with `--send`. Sending
requires a funded wallet at `.keys/test-wallet.json` (override with `KEYPAIR_PATH`).
Read-only checks run without a wallet.

## API Routes

Transaction builders — all return unsigned instructions under `/api/tx/`:

| | |
|---|---|
| `market-order` | `limit-order` |
| `isolated-market-order` | `isolated-limit-order` |
| `place-multi-limit-orders` | `cancel-orders` |
| `set-position-sltp` | `cancel-stop-loss` |
| `close-all-positions` | `register-subaccount` |
| `deposit` | `withdraw` |
| `transfer-collateral` | |

Data endpoints:

- `/api/markets`, `/api/markets/{symbol}`
- `/api/markets/{symbol}/calendar`, `/api/markets/{symbol}/calendar/next` — RWA session hours
- `/api/markets/{symbol}/funding` — market-wide funding rate history
- `/api/orderbook/{symbol}`, `/api/candles/{symbol}`, `/api/trades/{symbol}/recent`
- `/api/trader/{pubkey}` — plus `/orders`, `/trades`, `/subaccounts`, `/funding`, `/pnl`, `/collateral-history`
- `/api/user/{pubkey}/pnl`, `/liquidations`, `/trades`, `/funding-hourly` — wallet-wide,
  aggregated across every subaccount (vs `/api/trader/*`, which is per-subaccount)
- `/api/view/margin`, `/api/view/liquidation-price`, `/api/view/bbo/{symbol}`
- `/api/flight/config`, `/api/flight/builder/{pubkey}`
- `/api/leaderboard`, `/api/onboard/*`

Health: `/health`, `/health/ws`, `/health/memory`, `/health/relay`. WebSocket: `/ws`.

## Deployment

The backend is a Docker container built from the repo root `Dockerfile`; the
frontend deploys to Vercel. Both are environment-agnostic — everything
host-specific lives in environment variables, not in this repo.

**Changing the backend origin requires editing `ember-frontend/vercel.json`.**
It pins a Content-Security-Policy whose `connect-src` allowlists the API host
explicitly. Setting `NEXT_PUBLIC_API_URL` alone is not enough: the build
succeeds, the deploy goes green, the page renders, and every request is blocked
in the browser. Add the new origin under both `https://` and `wss://`.

If your host runs container health checks, note that the slim runtime image
ships neither `curl` nor `wget` — an in-container probe will fail against a
perfectly healthy app. Probe `/health` from outside the container instead.
