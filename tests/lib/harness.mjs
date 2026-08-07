// Shared E2E harness for the Ember test suite.
//
// Every test goes through the same flow: ask the backend to BUILD an unsigned
// instruction set, deserialize it, compile a V0 tx, sign with the funded test
// wallet, SIMULATE, and (only with --send) send + confirm on mainnet. This
// keeps each test small and makes "dry-run" (simulate-only) the safe default.
//
// Usage from a test module:
//   import { env, loadWallet, connection, buildSignSendConfirm, SEND } from "./lib/harness.mjs";

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createPrivateKey, sign as edSign } from "crypto";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

// Request a generous compute-unit ceiling so heavier flows (Flight-wrapped
// orders, multi-leg conditional orders) aren't capped by Solana's 200k default.
const COMPUTE_UNIT_LIMIT = 1_000_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(TESTS_DIR, "..");

/** True when `--send` is passed — actually broadcast + confirm transactions. */
export const SEND = process.argv.includes("--send");

/** Read RPC_URL (from env or tests/.env) + BACKEND (deployed by default). */
export function env() {
  let RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    try {
      for (const line of readFileSync(resolve(TESTS_DIR, ".env"), "utf8").split("\n")) {
        const m = line.match(/^\s*RPC_URL\s*=\s*(.*)$/);
        if (m) { RPC_URL = m[1].trim().replace(/^["']|["']$/g, ""); break; }
      }
    } catch { /* no .env */ }
  }
  const BACKEND = (process.env.BACKEND || "http://localhost:3001").replace(/\/$/, "");
  if (!RPC_URL) throw new Error("RPC_URL not set (export RPC_URL=… or add it to tests/.env)");
  return { RPC_URL, BACKEND };
}

/** Load the funded test-wallet keypair (KEYPAIR_PATH or .keys/test-wallet.json). */
export function loadWallet() {
  const path = process.env.KEYPAIR_PATH || resolve(REPO_ROOT, ".keys", "test-wallet.json");
  const secret = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function connection(rpcUrl) {
  return new Connection(rpcUrl, "confirmed");
}

/** Sign a message with the wallet's ed25519 key using Node's native crypto
 *  (no extra deps). Returns a base64 signature — exactly what the frontend
 *  sends to /api/onboard/activate-referral after Phantom's signMessage.
 *  `secretKey64` is the web3.js 64-byte secretKey (32-byte seed || pubkey). */
export function signMessageEd25519(message, secretKey64) {
  const seed = Buffer.from(secretKey64.slice(0, 32));
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  return edSign(null, Buffer.from(bytes), key).toString("base64");
}

/** Reconstruct web3.js instructions from the backend's JSON `instructions`. */
export function deserializeIxs(instructions) {
  return instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(ix.data, "base64"),
      }),
  );
}

/** POST a tx-build request; throws on non-2xx with the backend error. */
export async function postBuild(BACKEND, endpoint, body) {
  const res = await fetch(`${BACKEND}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Allow callers to pass a pre-stringified body (u64-precision-safe).
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${endpoint}: non-JSON ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} — ${data.error || text.slice(0, 200)}`);
  return data;
}

/**
 * Build (via backend) → sign → simulate → optionally send+confirm.
 * Returns { simulated, sent, ok, err, logs?, units?, sig? }.
 * Never throws on a simulation/confirmation error — returns it so the caller
 * can decide whether it's expected (e.g. "no position" for a precondition).
 */
export async function buildSignSendConfirm({ conn, kp, BACKEND, endpoint, body, send = SEND }) {
  const data = await postBuild(BACKEND, endpoint, body);
  if (!data.instructions || data.instructions.length === 0) {
    throw new Error(`${endpoint}: backend returned no instructions`);
  }
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ...deserializeIxs(data.instructions),
  ];
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);

  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (sim.value.err) {
    return { simulated: true, sent: false, ok: false, err: sim.value.err, logs: sim.value.logs };
  }
  if (!send) {
    return { simulated: true, sent: false, ok: true, units: sim.value.unitsConsumed };
  }
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return { simulated: true, sent: true, ok: conf.value.err === null, err: conf.value.err, sig };
}

/** GET /api/trader/:pubkey → JSON, or null. */
export async function getTrader(BACKEND, pubkey) {
  const res = await fetch(`${BACKEND}/api/trader/${pubkey}`);
  if (!res.ok) return null;
  return res.json();
}

/** GET /api/orderbook/:symbol → { bestBid, bestAsk, mid } in USD (or nulls). */
export async function getBook(BACKEND, symbol) {
  try {
    const res = await fetch(`${BACKEND}/api/orderbook/${symbol}`);
    if (!res.ok) return { bestBid: null, bestAsk: null, mid: null };
    const b = await res.json();
    const bestBid = b.bids?.[0]?.price ?? null;
    const bestAsk = b.asks?.[0]?.price ?? null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
    return { bestBid, bestAsk, mid };
  } catch {
    return { bestBid: null, bestAsk: null, mid: null };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
