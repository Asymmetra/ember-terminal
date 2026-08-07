import { useEffect, useRef, useState } from "react";
import { api, type MarginView } from "@/lib/api";

export type MarginResult = {
  /** Protocol-exact margin, or null when no Hawkeye value is available yet. */
  data: MarginView | null;
  /** "hawkeye" when `data` is a fresh on-chain value; "estimate" when the
   *  caller should fall back to its off-chain approximation. */
  source: "hawkeye" | "estimate";
  loading: boolean;
};

/** Abort a Hawkeye margin simulation that takes too long, so the order form
 *  never blocks on the RPC round-trip. */
const TIMEOUT_MS = 1500;

/**
 * Fetch protocol-exact account margin for `authority`/`subaccountIndex` from the
 * Hawkeye `view_margin` endpoint. Refetches when those — or `refreshKey` (pass
 * the account's collateral so a deposit/fill re-pulls it) — change.
 *
 * On error/timeout it keeps the last good value if there is one; otherwise it
 * returns `data: null` so the caller falls back to its own estimate. It never
 * throws and never blocks (per the product decision that the form must always
 * remain usable).
 */
export function useMarginView(
  authority: string | null,
  subaccountIndex = 0,
  refreshKey?: unknown,
): MarginResult {
  const [data, setData] = useState<MarginView | null>(null);
  const [loading, setLoading] = useState(false);
  const lastGood = useRef<MarginView | null>(null);

  useEffect(() => {
    if (!authority) {
      lastGood.current = null;
      setData(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    setLoading(true);

    api
      .getMargin(authority, subaccountIndex, controller.signal)
      .then((m) => {
        if (cancelled) return;
        lastGood.current = m;
        setData(m);
      })
      .catch(() => {
        // Keep the last good value if we have one; otherwise null → estimate.
        if (!cancelled) setData(lastGood.current);
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [authority, subaccountIndex, refreshKey]);

  return { data, source: data ? "hawkeye" : "estimate", loading };
}
