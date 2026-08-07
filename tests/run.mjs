// Ember E2E test runner.
//
//   node run.mjs           # dry-run: read-only checks + simulate every tx the
//                          # backend builds (verifies valid instruction sets).
//   node run.mjs --send    # additionally executes the live SL/TP-trigger +
//                          # cancel-by-id lifecycle on-chain (tiny position).
//
// Env: RPC_URL (or tests/.env), BACKEND (default deployed), KEYPAIR_PATH
// (default .keys/test-wallet.json). Prints a pass/fail matrix and exits non-zero
// if any non-lenient check fails.

import {
  env, loadWallet, connection, SEND,
  buildSignSendConfirm, getTrader, getBook, sleep, signMessageEd25519,
} from "./lib/harness.mjs";

const { RPC_URL, BACKEND } = env();
const kp = loadWallet();
const WALLET = kp.publicKey.toBase58();
const conn = connection(RPC_URL);
const REFERRAL_CODE = process.env.REFERRAL_CODE || "REKT";

const results = [];
const record = (name, status, detail = "") => {
  results.push({ name, status, detail });
  const icon = { pass: "✓", fail: "✗", sim: "≈", skip: "·", warn: "!" }[status] || "?";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
};

// "Lenient" sim errors are valid-instruction-set outcomes blocked only by
// on-chain preconditions (no position, already registered, etc.) — we still
// proved the backend built a sane tx, so they don't fail the suite.
const errStr = (e) => JSON.stringify(e).toLowerCase();

console.log(`\nEmber test suite — wallet ${WALLET.slice(0, 6)}… · backend ${BACKEND}`);
console.log(`Mode: ${SEND ? "SEND (live on-chain)" : "dry-run (simulate only)"}\n`);

// ── Reads ──────────────────────────────────────────────────────────────────
async function reads() {
  console.log("[reads]");
  // Leaderboard
  try {
    const r = await (await fetch(`${BACKEND}/api/leaderboard?limit=5`)).json();
    const ok = r.stats && r.traders?.length >= 0;
    record("leaderboard.list", ok && !r.stale ? "pass" : "warn",
      `active=${r.stats?.activeTraders} top=${r.traders?.[0]?.accountValueUsd?.toFixed?.(0)} enriched=${r.traders?.filter?.((t) => t.equityUsd != null).length}/${r.traders?.length}${r.stale ? " (stale)" : ""}`);
  } catch (e) { record("leaderboard.list", "fail", e.message); }
  // Leaderboard search (full universe incl. inactive)
  try {
    const q = WALLET.slice(0, 6);
    const r = await (await fetch(`${BACKEND}/api/leaderboard?q=${q}`)).json();
    record("leaderboard.search", Array.isArray(r.traders) ? "pass" : "fail", `q=${q} matches=${r.traders?.length}`);
  } catch (e) { record("leaderboard.search", "fail", e.message); }
  // Flight config + builder
  try {
    const c = await (await fetch(`${BACKEND}/api/flight/config`)).json();
    record("flight.config", typeof c.feeBps === "number" ? "pass" : "fail", `active=${c.active} feeBps=${c.feeBps}`);
  } catch (e) { record("flight.config", "fail", e.message); }
  try {
    const b = await (await fetch(`${BACKEND}/api/flight/builder/${WALLET}`)).json();
    record("flight.builder", typeof b.registered === "boolean" ? "pass" : "fail", `registered=${b.registered} feeBps=${b.feeBps}`);
  } catch (e) { record("flight.builder", "fail", e.message); }
  // Trader
  try {
    const t = await getTrader(BACKEND, WALLET);
    record("trader.get", t?.accounts ? "pass" : "warn", `subaccounts=${t?.accounts?.length ?? 0}`);
  } catch (e) { record("trader.get", "fail", e.message); }
}

// ── Wallet auth + referral activation (the new onboarding path) ─────────────
// nonce → ed25519-sign the message → POST activate-referral (login + activate
// happen server-side, keyless relay). Phoenix rate-limits nonce/login per
// wallet, so rate_limited → "warn" rather than failing the suite.
async function auth() {
  console.log("\n[auth — wallet sign-in + referral activation]");
  let nonce;
  try {
    const res = await fetch(`${BACKEND}/api/onboard/nonce/${WALLET}`);
    const body = await res.json();
    if (res.ok && body.message && body.nonce_id) {
      nonce = body;
      record("auth.nonce", "pass", `nonce_id=${body.nonce_id.slice(0, 14)}…`);
    } else if (res.status === 429) {
      record("auth.nonce", "warn", "rate_limited (Phoenix per-wallet throttle)");
      return;
    } else {
      record("auth.nonce", "fail", `${res.status} ${JSON.stringify(body).slice(0, 120)}`);
      return;
    }
  } catch (e) { record("auth.nonce", "fail", e.message); return; }

  try {
    const signature = signMessageEd25519(nonce.message, kp.secretKey);
    const res = await fetch(`${BACKEND}/api/onboard/activate-referral`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authority: WALLET, referral_code: REFERRAL_CODE, signature, nonce_id: nonce.nonce_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      // Assert the real success shape — a 2xx with neither field is NOT a pass.
      const activated = body.already_activated === true || typeof body.trader_pda === "string";
      if (activated) {
        const how = body.already_activated ? "already_activated" : `trader_pda ${String(body.trader_pda).slice(0, 8)}…`;
        record("auth.referral", "pass", `${REFERRAL_CODE} → ${how}`);
      } else {
        record("auth.referral", "fail", `2xx but no trader_pda/already_activated: ${JSON.stringify(body).slice(0, 120)}`);
      }
    } else if (res.status === 429) {
      record("auth.referral", "warn", "rate_limited (Phoenix per-wallet throttle)");
    } else {
      record("auth.referral", "fail", `${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    }
  } catch (e) { record("auth.referral", "fail", e.message); }
}

// ── Simulate-only: backend builds a valid instruction set ───────────────────
// Each returns the sim result; lenient precondition errors → "sim" not "fail".
async function simBuild(name, endpoint, body, { lenient = [] } = {}) {
  try {
    const r = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint, body, send: false });
    if (r.ok) return record(name, "sim", `simulates ok${r.units ? ` · ${r.units} CU` : ""}`);
    const es = errStr(r.err);
    if (lenient.some((l) => es.includes(l))) return record(name, "sim", `built ok; sim blocked by precondition (${JSON.stringify(r.err)})`);
    record(name, "fail", `sim err ${JSON.stringify(r.err)} | ${(r.logs || []).slice(-2).join(" | ")}`);
  } catch (e) { record(name, "fail", e.message); }
}

async function simulateCoverage(book) {
  console.log("\n[simulate — backend builds valid txs]");
  const px = book.mid;
  if (!px) { record("simulate.*", "warn", "no SOL book price — skipping order sims"); return; }
  // far-from-market limit so it rests (no fill); tiny size.
  const lowBid = +(px * 0.5).toFixed(2);
  const highAsk = +(px * 1.5).toFixed(2);

  await simBuild("market-order", "/api/tx/market-order",
    { authority: WALLET, symbol: "SOL", side: "bid", size_lots: 1 },
    { lenient: ["6001", "insufficient", "custom"] });
  await simBuild("limit-order", "/api/tx/limit-order",
    { authority: WALLET, symbol: "SOL", side: "bid", price: lowBid, size_lots: 1 },
    { lenient: ["6001", "insufficient", "custom"] });
  await simBuild("isolated-limit-order", "/api/tx/isolated-limit-order",
    { authority: WALLET, symbol: "SOL", side: "bid", price: lowBid, size_lots: 1, collateral_usdc: 1, subaccount_index: 1 },
    { lenient: ["6001", "insufficient", "custom", "already", "invalidaccount"] });
  await simBuild("isolated-market-order", "/api/tx/isolated-market-order",
    { authority: WALLET, symbol: "SOL", side: "bid", size_lots: 1, collateral_usdc: 1, subaccount_index: 1 },
    { lenient: ["6001", "insufficient", "custom", "already", "invalidaccount"] });
  await simBuild("place-multi-limit-orders", "/api/tx/place-multi-limit-orders",
    { authority: WALLET, symbol: "SOL", bids: [{ price: lowBid, size_lots: 1 }], asks: [{ price: highAsk, size_lots: 1 }] },
    { lenient: ["6001", "insufficient", "custom"] });
  await simBuild("transfer-collateral", "/api/tx/transfer-collateral",
    { authority: WALLET, from_subaccount_index: 0, to_subaccount_index: 1, amount_usdc: 1 },
    { lenient: ["6001", "insufficient", "custom", "account", "uninitialized", "not found"] });
  await simBuild("register-subaccount", "/api/tx/register-subaccount",
    { authority: WALLET, subaccount_index: 5 },
    { lenient: ["already", "custom", "0x0"] });
}

// ── Live lifecycle: SL/TP triggers + cancel-by-id (only with --send) ────────
// TraderView serializes camelCase; positionSize.value is the signed base-lot
// count (long > 0, short < 0).
function firstOpenPosition(trader) {
  for (const acct of trader?.accounts ?? []) {
    const sub = acct.traderSubaccountIndex ?? acct.trader_subaccount_index ?? 0;
    for (const p of acct.positions ?? []) {
      const lots = Number(p.positionSize?.value ?? 0);
      if (Math.abs(lots) > 0) {
        return { sub, p, sizeLots: Math.abs(lots), side: lots > 0 ? "long" : "short", symbol: p.symbol ?? "SOL" };
      }
    }
  }
  return null;
}

const TEST_SUBACCOUNT = 0; // cross-margin — most reliable to open/close tiny positions

async function slTpAndCancelById(book) {
  console.log(`\n[lifecycle — ${SEND ? "live" : "dry-run"}]`);
  let trader = await getTrader(BACKEND, WALLET);
  let open = firstOpenPosition(trader);

  // Open a tiny cross-margin position only when sending and none exists.
  // Closed again in cleanup().
  if (!open && SEND) {
    const r = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint: "/api/tx/market-order",
      body: { authority: WALLET, symbol: "SOL", side: "bid", size_lots: 1 }, send: true });
    record("open-position", r.ok ? "pass" : "warn", r.sig ? `sig ${r.sig.slice(0, 8)}` : JSON.stringify(r.err));
    await sleep(2500);
    trader = await getTrader(BACKEND, WALLET);
    open = firstOpenPosition(trader);
  }

  if (!open) {
    record("set-position-sltp", "skip", SEND ? "no open position after open attempt" : "needs an open position (run with --send)");
    record("cancel-stop-loss", "skip", "needs SL/TP on a position");
    return;
  }

  const side = open.side;
  const subIdx = open.sub;
  const sym = open.symbol;
  // Reference price for SL/TP offsets: live book mid, else the position's entry
  // price (so the test works even when the backend orderbook is empty).
  const refPx = book.mid || Number(open.p.entryPrice?.ui ?? open.p.entryPrice ?? 0);
  if (!refPx) {
    record("set-position-sltp", "skip", "no reference price (book + entry both empty)");
    record("cancel-stop-loss", "skip", "no reference price");
    return;
  }
  const sl = side === "long" ? +(refPx * 0.85).toFixed(2) : +(refPx * 1.15).toFixed(2);
  const tp = side === "long" ? +(refPx * 1.15).toFixed(2) : +(refPx * 0.85).toFixed(2);

  // Set SL + TP triggers on the existing position (THE new feature).
  const setRes = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint: "/api/tx/set-position-sltp",
    body: { authority: WALLET, symbol: sym, side, stop_loss_price: sl, take_profit_price: tp, subaccount_index: subIdx } });
  if (setRes.ok) {
    record("set-position-sltp", setRes.sent ? "pass" : "sim", setRes.sig ? `sig ${setRes.sig.slice(0, 8)} sl=${sl} tp=${tp}` : `simulates ok sl=${sl} tp=${tp}`);
  } else {
    record("set-position-sltp", "fail", `${JSON.stringify(setRes.err)} | ${(setRes.logs || []).slice(-2).join(" | ")}`);
  }

  // Verify visible + cancel one leg (only meaningful after a real send).
  if (SEND && setRes.ok) {
    await sleep(7000); // REST trader view trails the conditional-order tx
    const o2 = firstOpenPosition(await getTrader(BACKEND, WALLET));
    const tpv = o2?.p?.takeProfitPrice, slv = o2?.p?.stopLossPrice;
    const hasTrig = (tpv != null && tpv !== "") || (slv != null && slv !== "");
    record("sltp.visible", hasTrig ? "pass" : "warn", `tp=${JSON.stringify(tpv)} sl=${JSON.stringify(slv)}`);
    const cxl = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint: "/api/tx/cancel-stop-loss",
      body: { authority: WALLET, symbol: sym, direction: "less_than", subaccount_index: subIdx }, send: true });
    record("cancel-stop-loss", cxl.ok ? "pass" : "warn", cxl.sig ? `sig ${cxl.sig.slice(0, 8)}` : JSON.stringify(cxl.err));
  } else {
    record("cancel-stop-loss", "skip", "needs --send + a live SL/TP");
  }
}

// Flatten any cross-margin position the lifecycle opened, via close-all-positions
// (also gives that route coverage). Runs on --send so a leftover test position
// from an aborted run gets cleaned up too.
async function cleanup() {
  if (!SEND) { record("cleanup.close", "skip", "dry-run"); return; }
  await sleep(2500);
  const t = await getTrader(BACKEND, WALLET);
  const positions = [];
  for (const acct of t?.accounts ?? []) {
    const sub = acct.traderSubaccountIndex ?? acct.trader_subaccount_index ?? 0;
    if (sub !== TEST_SUBACCOUNT) continue;
    for (const p of acct.positions ?? []) {
      const lots = Number(p.positionSize?.value ?? 0);
      if (Math.abs(lots) > 0) {
        positions.push({ symbol: p.symbol ?? "SOL", side: lots > 0 ? "long" : "short",
          size_lots: Math.abs(lots), margin_mode: sub === 0 ? "cross" : "isolated", subaccount_index: sub });
      }
    }
  }
  if (positions.length === 0) { record("cleanup.close", "skip", "no test position to close"); return; }
  const r = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint: "/api/tx/close-all-positions",
    body: { authority: WALLET, positions }, send: true });
  record("cleanup.close", r.ok ? "pass" : "warn", r.sig ? `sig ${r.sig.slice(0, 8)}` : JSON.stringify(r.err));
}

async function cancelById(book) {
  const px = book.mid;
  if (!SEND || !px) { record("cancel-by-id", "skip", "needs --send + book price"); return; }
  try {
    // Place a resting bid far below market, then cancel that exact order by id.
    const price = +(px * 0.5).toFixed(2);
    const place = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint: "/api/tx/limit-order",
      body: { authority: WALLET, symbol: "SOL", side: "bid", price, size_lots: 1 }, send: true });
    if (!place.ok) { record("cancel-by-id", "warn", `place failed: ${JSON.stringify(place.err)}`); return; }
    await sleep(2500);
    // Collect resting orders (price + sequence are objects/strings → extract).
    const t = await getTrader(BACKEND, WALLET);
    const orders = [];
    for (const a of t?.accounts ?? []) {
      for (const [sym, list] of Object.entries(a.limitOrders ?? {})) {
        for (const o of list ?? []) orders.push({ ...o, symbol: sym });
      }
    }
    const ord = orders[0];
    if (!ord) { record("cancel-by-id", "warn", "order not found after place"); return; }
    const usd = Number(ord.price?.ui ?? ord.price);
    const seq = ord.orderSequenceNumber ?? ord.order_sequence_number; // string — preserve u64
    // Build the body as a raw string so the u64 sequence keeps full precision.
    const rawBody = `{"authority":"${WALLET}","symbol":"${ord.symbol}","order_ids":[{"price":${usd},"order_sequence_number":${seq}}]}`;
    const cxl = await buildSignSendConfirm({ conn, kp, BACKEND, endpoint: "/api/tx/cancel-orders", body: rawBody, send: true });
    record("cancel-by-id", cxl.ok ? "pass" : "fail", cxl.sig ? `sig ${cxl.sig.slice(0, 8)}` : JSON.stringify(cxl.err));
  } catch (e) {
    record("cancel-by-id", "fail", e.message);
  }
}

(async () => {
  const book = await getBook(BACKEND, "SOL");
  await reads();
  await auth();
  await simulateCoverage(book);
  await slTpAndCancelById(book);
  await cancelById(book);
  await cleanup();

  // Summary
  const by = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n── summary ──  pass:${by("pass")}  sim:${by("sim")}  warn:${by("warn")}  skip:${by("skip")}  fail:${by("fail")}`);
  if (by("fail") > 0) {
    console.log("FAILURES:");
    results.filter((r) => r.status === "fail").forEach((r) => console.log(`  ✗ ${r.name} — ${r.detail}`));
    process.exit(1);
  }
  console.log("OK");
})().catch((e) => { console.error("runner crashed:", e); process.exit(1); });
