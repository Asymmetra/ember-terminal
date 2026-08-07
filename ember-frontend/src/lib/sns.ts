"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { getMultipleFavoriteDomains, resolve } from "@bonfida/spl-name-service";
import type { Connection } from "@solana/web3.js";
import { hydrateMap, makeMapPersister } from "@/lib/persistentMapCache";

/**
 * Solana Name Service (.sol) resolution for the leaderboard.
 *
 * We resolve each wallet's *primary* domain (the one the owner set as their
 * public handle) and show it in place of the raw address; the expanded row
 * shows both. Reverse lookups are per-wallet RPC, so we batch them
 * (getMultipleFavoriteDomains does ≤100 wallets in ~4 RPC calls) and cache the
 * result for the whole session. `null` means "resolved, no primary domain".
 */

// authority -> "name.sol" | null (resolved, none). `undefined` = not yet tried.
// Persisted across reloads (names rarely change) so we don't re-resolve every
// wallet's .sol handle on each page load.
const SNS_LS_KEY = "ember:sns:v1";
const SNS_TTL_MS = 7 * 24 * 3600_000;
const cache = new Map<string, string | null>();
hydrateMap(cache, SNS_LS_KEY, SNS_TTL_MS);
const persist = makeMapPersister(cache, SNS_LS_KEY);
const inflight = new Set<string>();

/** Synchronous peek — returns the cached name, `null` if none, `undefined` if unresolved. */
export function cachedSnsName(authority: string): string | null | undefined {
  return cache.get(authority);
}

/**
 * Resolve `.sol` primary domains for the given authorities, batching any not
 * yet in the cache. Returns a version counter that bumps as names land so the
 * caller re-renders. Safe to call with the same growing list each render — only
 * genuinely-new authorities trigger a fetch.
 */
export function useSnsNames(authorities: string[]): number {
  const { connection } = useConnection();
  const [version, setVersion] = useState(0);
  const key = authorities.join(",");

  useEffect(() => {
    const pending = authorities.filter((a) => !cache.has(a) && !inflight.has(a));
    if (pending.length === 0) return;
    pending.forEach((a) => inflight.add(a));

    let cancelled = false;
    (async () => {
      for (let i = 0; i < pending.length; i += 100) {
        const chunk = pending.slice(i, i + 100);
        try {
          const names = await getMultipleFavoriteDomains(
            connection,
            chunk.map((a) => new PublicKey(a)),
          );
          chunk.forEach((a, idx) => {
            const n = names[idx];
            cache.set(a, n ? `${n}.sol` : null);
            inflight.delete(a);
          });
        } catch {
          // Mark resolved-as-none so a transient failure doesn't loop forever.
          chunk.forEach((a) => {
            cache.set(a, null);
            inflight.delete(a);
          });
        }
        if (cancelled) return;
        persist();
        setVersion((v) => v + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `key` captures the set of authorities; connection is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connection]);

  return version;
}

/**
 * Forward-resolve a `.sol` handle to its owner wallet (for search). Returns the
 * base58 owner address, or `null` if the domain doesn't exist / can't resolve.
 */
export async function resolveSolDomain(
  connection: Connection,
  input: string,
): Promise<string | null> {
  const name = input.trim().replace(/\.sol$/i, "");
  if (!name) return null;
  try {
    const owner = await resolve(connection, name);
    const addr = owner.toBase58();
    // Cache the reverse mapping too so the row shows the handle immediately.
    cache.set(addr, `${name}.sol`);
    persist();
    return addr;
  } catch {
    return null;
  }
}
