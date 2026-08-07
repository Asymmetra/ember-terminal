"use client";

import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";

// The Flight program owns one `builder_state` account per registered builder
// (216 bytes). Enumerating them with getProgramAccounts gives the full
// ecosystem of builder codes — fee rates + adoption — straight from chain.
const FLIGHT_PROGRAM_ID = new PublicKey("F1ightu9cujFYo34k9CabifLrJT8qzfDVM2Q7BqhJn2W");
const BUILDER_STATE_SIZE = 216;
const AUTHORITY_OFFSET = 8;   // pubkey (32)
const TRADER_ACCT_OFFSET = 40; // pubkey (32)
const FEE_BPS_OFFSET = 80;    // u64 LE

export interface FlightBuilder {
  authority: string;
  traderAccount: string;
  feeBps: number;
}

export interface FlightEcosystem {
  builders: FlightBuilder[];
  count: number;
  feeMin: number;
  feeMax: number;
  feeMedian: number;
  /** Sorted unique fees → count, for a distribution chart. */
  distribution: Array<{ bps: number; count: number }>;
}

function parseBuilder(pubkeyData: Uint8Array): FlightBuilder {
  const authority = new PublicKey(pubkeyData.slice(AUTHORITY_OFFSET, AUTHORITY_OFFSET + 32)).toBase58();
  const traderAccount = new PublicKey(pubkeyData.slice(TRADER_ACCT_OFFSET, TRADER_ACCT_OFFSET + 32)).toBase58();
  const dv = new DataView(pubkeyData.buffer, pubkeyData.byteOffset, pubkeyData.byteLength);
  const feeBps = Number(dv.getBigUint64(FEE_BPS_OFFSET, true));
  return { authority, traderAccount, feeBps };
}

export async function fetchFlightEcosystem(connection: Connection): Promise<FlightEcosystem> {
  const accts = await connection.getProgramAccounts(FLIGHT_PROGRAM_ID, {
    filters: [{ dataSize: BUILDER_STATE_SIZE }],
  });
  const builders = accts
    .map((a) => parseBuilder(a.account.data as Uint8Array))
    .sort((x, y) => y.feeBps - x.feeBps);
  const fees = builders.map((b) => b.feeBps).sort((a, b) => a - b);
  const distMap = new Map<number, number>();
  for (const f of fees) distMap.set(f, (distMap.get(f) ?? 0) + 1);
  return {
    builders,
    count: builders.length,
    feeMin: fees.length ? fees[0] : 0,
    feeMax: fees.length ? fees[fees.length - 1] : 0,
    feeMedian: fees.length ? fees[Math.floor(fees.length / 2)] : 0,
    distribution: [...distMap.entries()].map(([bps, count]) => ({ bps, count })).sort((a, b) => a.bps - b.bps),
  };
}

// One ecosystem-wide getProgramAccounts is heavy-ish; cache per session.
let cache: FlightEcosystem | null = null;

export function useFlightEcosystem(): { data: FlightEcosystem | null; loading: boolean; error: boolean } {
  const { connection } = useConnection();
  const [data, setData] = useState<FlightEcosystem | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    setLoading(true);
    fetchFlightEcosystem(connection)
      .then((e) => { if (cancelled) return; cache = e; setData(e); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connection]);
  return { data, loading, error };
}
