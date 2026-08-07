"use client";

import { useStatsStore } from "@/stores/statsStore";
import type { TraderPosition } from "@/types/trader";

/**
 * Single source of truth for the live PnL of an OPEN position.
 *
 * Why a hook (vs. inline math everywhere):
 * - Before this, four components — Positions, PortfolioSummaryBar,
 *   MarketHeader, TradeDetailPanel — each redid `(mark − entry) × size`
 *   independently. Drift risk if the formula ever needs to change
 *   (e.g. funding inclusion, sign convention) compounds with every fork.
 *
 * Semantics (verified empirically by tests/pnl-accuracy.mjs):
 * - `markToMarket` = `(mark − entry) * size` (long) or `(entry − mark) * size`
 *   (short). Matches Phoenix's per-position `unrealizedPnl` exactly.
 * - `unsettledFunding` = funding accrued this epoch but not yet settled.
 *   Realized at the next 8h boundary; intentionally NOT folded into the
 *   headline mark-to-market number per the user's chosen convention
 *   (matches Hyperliquid/Binance display semantics).
 * - `accumulatedFunding` = lifetime funding for this position. Already
 *   realized; surface in the trade-detail panel, not in the live PnL.
 *
 * Why we recompute instead of trusting the REST snapshot's `unrealized_pnl`:
 * - Phoenix's `trader_margin` WS only emits on margin events (fills,
 *   settlements, deposits). Mark price ticks are streamed separately on
 *   the `stats` channel. Between margin events, the REST snapshot's PnL
 *   is stale; this recompute keeps the displayed value live to the
 *   per-symbol mark stream.
 *
 * If you're tempted to "fix" this by using `pos.unrealized_pnl` directly:
 * don't. The REST value is correct only at fetch time. Use this hook.
 */
export interface LivePositionPnl {
  markToMarket: number;
  unsettledFunding: number;
  accumulatedFunding: number;
  /** The mark price used for the calculation (live from WS, fallback REST). */
  mark: number;
  /** Notional in USD (size × mark). */
  notional: number;
  /** True when we had to fall back to the REST snapshot's mark price. */
  isStale: boolean;
}

export function getLivePositionPnl(
  position: TraderPosition,
  liveMark: number | undefined,
): LivePositionPnl {
  const isLong = position.side.toLowerCase() === "long";
  const fallbackMark = position.mark_price;
  const mark = liveMark && liveMark > 0 ? liveMark : fallbackMark;
  const isStale = !(liveMark && liveMark > 0);

  // Mark-to-market only. Funding is tracked separately and shown in detail panels.
  // Falls back to Phoenix's snapshot value if mark or entry is missing.
  const markToMarket =
    mark > 0 && position.entry_price > 0
      ? isLong
        ? (mark - position.entry_price) * position.size
        : (position.entry_price - mark) * position.size
      : position.unrealized_pnl;

  const notional = mark > 0 ? position.size * mark : position.position_value;

  return {
    markToMarket,
    unsettledFunding: position.unsettled_funding ?? 0,
    accumulatedFunding: position.accumulated_funding ?? 0,
    mark,
    notional,
    isStale,
  };
}

/** React hook variant that subscribes to the per-symbol mark from statsStore. */
export function useLivePositionPnl(position: TraderPosition): LivePositionPnl {
  const liveMark = useStatsStore((s) => s.markPrices[position.symbol]);
  return getLivePositionPnl(position, liveMark);
}
