import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  TransactionInstruction,
} from "@solana/web3.js";

// Dynamic priority-fee + compute-budget helpers.
//
// We already simulate every trade, so we get `unitsConsumed` for free — sizing
// an explicit compute-unit limit from it avoids both under-provisioning and
// overpaying. The compute-unit *price* (priority fee) is derived from recent
// network prioritization fees so it adapts to congestion, clamped to a sane
// floor/ceiling and cached briefly so a burst of trades doesn't refetch.

const FLOOR_MICRO_LAMPORTS = 10_000; // never send 0 → some priority even when quiet
const CEILING_MICRO_LAMPORTS = 1_000_000; // cap per-CU cost
const CACHE_TTL_MS = 8_000;
const MAX_CU_LIMIT = 1_400_000; // Solana per-tx ceiling
const MIN_CU_LIMIT = 10_000;
const DEFAULT_CU_LIMIT = 200_000; // when simulation gave no number

let cached: { fee: number; at: number } | null = null;

/** Recent-prioritization-fee-based CU price (micro-lamports), clamped + cached.
 *  Falls back to the floor if the RPC doesn't support the call or errors. */
export async function getPriorityFeeMicroLamports(
  connection: Connection,
  writableAccounts: PublicKey[],
): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.fee;

  let fee = FLOOR_MICRO_LAMPORTS;
  try {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writableAccounts.slice(0, 128),
    });
    const fees = recent
      .map((r) => r.prioritizationFee)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    if (fees.length > 0) {
      const p75 = fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))];
      fee = Math.max(FLOOR_MICRO_LAMPORTS, Math.min(CEILING_MICRO_LAMPORTS, p75));
    }
  } catch {
    // RPC lacks the method or failed — fall back to the floor (fee already set).
  }

  cached = { fee, at: now };
  return fee;
}

/** The two ComputeBudget instructions to prepend: an explicit CU limit sized
 *  from the simulation's `unitsConsumed` (+20% headroom) and a CU price. */
export function computeBudgetIxs(
  unitsConsumed: number | null | undefined,
  microLamports: number,
): TransactionInstruction[] {
  const units =
    unitsConsumed && unitsConsumed > 0
      ? Math.min(MAX_CU_LIMIT, Math.max(MIN_CU_LIMIT, Math.ceil(unitsConsumed * 1.2)))
      : DEFAULT_CU_LIMIT;
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

/** Unique writable account keys across a set of instructions (for the
 *  prioritization-fee lookup). */
export function writableAccounts(instructions: TransactionInstruction[]): PublicKey[] {
  const seen = new Map<string, PublicKey>();
  for (const ix of instructions) {
    for (const k of ix.keys) {
      if (k.isWritable) seen.set(k.pubkey.toBase58(), k.pubkey);
    }
  }
  return Array.from(seen.values());
}
