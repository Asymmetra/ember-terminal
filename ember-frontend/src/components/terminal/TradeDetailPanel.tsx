"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTradeDetailStore } from "@/stores/tradeDetailStore";
import { useStatsStore } from "@/stores/statsStore";
import { useTraderStore } from "@/stores/traderStore";
import { useTransactionBuilder } from "@/hooks/useTransactionBuilder";
import { getLivePositionPnl } from "@/hooks/useLivePositionPnl";
import { formatPrice, formatSize, formatUsd } from "@/lib/format";
import clsx from "clsx";

function DetailRow({
  label,
  tooltip,
  tooltipTitle,
  children,
}: {
  label: string;
  tooltip?: string;
  tooltipTitle?: string;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const hasTip = !!tooltip;

  return (
    <div className="flex items-center justify-between py-1.5">
      <span
        className={clsx(
          "text-[10px] uppercase tracking-wider text-text-secondary/70",
          hasTip && "cursor-help border-b border-dotted border-text-secondary/30",
        )}
        onMouseEnter={hasTip ? (e) => {
          const rect = (e.currentTarget as HTMLSpanElement).getBoundingClientRect();
          setPos({ x: rect.left + rect.width / 2, y: rect.top });
          setShow(true);
        } : undefined}
        onMouseLeave={hasTip ? () => setShow(false) : undefined}
      >
        {label}
      </span>
      <span className="font-mono text-[11px] text-text-primary">{children}</span>
      {hasTip && show && (
        <div
          className="fixed z-[200] w-60 rounded border border-ember-border bg-[#1A1B20] px-3 py-2.5 text-left text-[10px] normal-case tracking-normal text-text-secondary/90 leading-relaxed shadow-[0_8px_32px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{
            // Clamp to viewport so tooltips on the leftmost label don't get
            // clipped against the screen edge.
            left: Math.max(8, Math.min(pos.x - 120, window.innerWidth - 248)),
            top: pos.y - 8,
            transform: "translateY(-100%)",
          }}
        >
          {tooltipTitle && (
            <div className="mb-1 font-medium text-text-primary">{tooltipTitle}</div>
          )}
          <div>{tooltip}</div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: React.ReactNode }) {
  return (
    <div className="pt-3 pb-1 mt-2 border-t border-ember-border/30">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/40">{title}</span>
    </div>
  );
}

export function TradeDetailPanel() {
  const open = useTradeDetailStore((s) => s.open);
  const detail = useTradeDetailStore((s) => s.detail);
  const close = useTradeDetailStore((s) => s.close);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && detail && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={close}
            className="fixed inset-0 z-[90] bg-black/40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: 380 }}
            animate={{ x: 0 }}
            exit={{ x: 380 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[90] w-[380px] border-l border-ember-border bg-surface-l1 shadow-[−16px_0_64px_rgba(0,0,0,0.4)] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ember-border px-4 py-3">
              <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-primary">
                {detail.type === "position" && `${detail.data.symbol}-PERP Position`}
                {detail.type === "tradeHistory" && `${detail.data.marketSymbol}-PERP Trade`}
                {detail.type === "recentTrade" && "Recent Trade"}
              </span>
              <button
                onClick={close}
                className="text-text-secondary/60 transition-colors hover:text-text-primary"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex flex-col gap-px p-4">
              {detail.type === "position" && <PositionDetail data={detail.data} />}
              {detail.type === "tradeHistory" && <TradeHistoryDetail data={detail.data} />}
              {detail.type === "recentTrade" && <RecentTradeDetail data={detail.data} />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function PositionDetail({ data }: { data: import("@/types/trader").TraderPosition }) {
  const isLong = data.side.toLowerCase() === "long";
  const markPrices = useStatsStore((s) => s.markPrices);
  // Single source of truth for live PnL — see hooks/useLivePositionPnl.ts.
  const live = getLivePositionPnl(data, markPrices[data.symbol]);
  const liveMarkPrice = live.mark;
  const liveUnrealizedPnl = live.markToMarket;
  const { cancelStopLoss } = useTransactionBuilder();
  const [cancellingLeg, setCancellingLeg] = useState<"tp" | "sl" | null>(null);

  const handleCancelLeg = async (leg: "tp" | "sl") => {
    if (cancellingLeg) return; // block both while either in-flight
    setCancellingLeg(leg);
    try {
      await cancelStopLoss(data.symbol, leg, data.subaccount_index);
    } catch {
      // toast handles error display
    } finally {
      setCancellingLeg(null);
    }
  };

  // Derived values — use actual account collateral for leverage, not initial_margin
  // (initial_margin = notional / max_leverage, so it always yields max_leverage)
  const crossCollateral = useTraderStore((s) => s.collateral);
  const allAccounts = useTraderStore((s) => s.allAccounts);
  const isoAccount = data.margin_mode === "isolated"
    ? allAccounts.find((a) => a.traderSubaccountIndex === data.subaccount_index)
    : null;
  const isoCollateral = isoAccount?.effectiveCollateral;
  const collateral = data.margin_mode === "isolated" && isoCollateral
    ? parseFloat(typeof isoCollateral === "object" && isoCollateral.ui != null ? isoCollateral.ui : String(isoCollateral)) || 0
    : crossCollateral;
  const notional = live.notional;
  const effLeverage = collateral > 0 ? notional / collateral : 0;
  const roi = collateral > 0 ? (liveUnrealizedPnl / collateral) * 100 : 0;
  const liqDistPct = data.liquidation_price != null && liveMarkPrice > 0
    ? Math.abs((liveMarkPrice - data.liquidation_price) / liveMarkPrice) * 100
    : null;
  const pnlPct = data.entry_price > 0
    ? ((liveMarkPrice - data.entry_price) / data.entry_price) * 100 * (isLong ? 1 : -1)
    : 0;

  return (
    <>
      {/* Core position info */}
      <DetailRow label="Symbol" tooltipTitle="Symbol" tooltip="The perpetual contract market for this position (e.g. SOL-PERP, BTC-PERP).">{data.symbol}-PERP</DetailRow>
      <DetailRow label="Side" tooltipTitle="Side" tooltip="Position direction. LONG profits when price rises; SHORT profits when price falls.">
        <span className={isLong ? "text-ember-green" : "text-ember-red"}>
          {data.side.toUpperCase()}
        </span>
      </DetailRow>
      <DetailRow label="Size" tooltipTitle="Size" tooltip="Position size denominated in the base asset (BTC, SOL, ETH, etc.). Independent of price.">{formatSize(data.size, 4)} {data.symbol}</DetailRow>
      <DetailRow label="Notional Value" tooltipTitle="Notional Value" tooltip="Position size in USD at the current mark price. Formula: Size × Mark. Updates live as mark moves.">${formatPrice(notional)}</DetailRow>
      <DetailRow
        label="Margin Mode"
        tooltipTitle="Margin Mode"
        tooltip="CROSS: this position shares collateral with all other cross-margin positions in subaccount 0. ISOLATED: dedicated subaccount with its own collateral; loss is capped at what you deposited there."
      >
        <span className={clsx(
          "inline-block px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
          data.margin_mode === "isolated"
            ? "text-ember-orange bg-ember-orange/10"
            : "text-text-secondary/60 bg-surface-l2"
        )}>
          {data.margin_mode === "isolated" ? "ISOLATED" : "CROSS"}
        </span>
      </DetailRow>
      <DetailRow
        label="Subaccount"
        tooltipTitle="Subaccount"
        tooltip="Phoenix subaccount index. 0 is your shared cross-margin account; 1–100 are isolated subaccounts (each one is a separate dedicated bucket of collateral)."
      >
        {data.subaccount_index === 0 ? "Cross (0)" : `Isolated #${data.subaccount_index}`}
      </DetailRow>

      {/* Pricing */}
      <SectionHeader title="Pricing" />
      <DetailRow label="Entry Price" tooltipTitle="Entry Price" tooltip="Volume-weighted average price (VWAP) at which this position was opened. If you added to the position, this re-averages.">${formatPrice(data.entry_price)}</DetailRow>
      <DetailRow label="Mark Price" tooltipTitle="Mark Price" tooltip="Current Phoenix oracle mark used for PnL, margin checks, and liquidation. Streamed live; not the same as the orderbook mid-price.">${formatPrice(liveMarkPrice)}</DetailRow>
      <DetailRow
        label="Price Change"
        tooltipTitle="Price Change Since Entry"
        tooltip="% move from entry to mark, signed by side. Long: positive when mark rose. Short: positive when mark fell. Roughly equals ROI without leverage."
      >
        <span className={pnlPct >= 0 ? "text-ember-green" : "text-ember-red"}>
          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
        </span>
      </DetailRow>

      {/* PnL & Returns */}
      <SectionHeader title="PnL & Returns" />
      <DetailRow
        label="Unrealized PnL"
        tooltipTitle="Unrealized PnL (Mark-to-Market)"
        tooltip="Live profit/loss if you closed at the current mark, before fees and funding. Long: (Mark − Entry) × Size. Short: (Entry − Mark) × Size. Funding is tracked separately below."
      >
        <span className={liveUnrealizedPnl >= 0 ? "text-ember-green" : "text-ember-red"}>
          {liveUnrealizedPnl >= 0 ? "+" : ""}{formatUsd(liveUnrealizedPnl)}
        </span>
      </DetailRow>
      <DetailRow
        label="Discounted PnL"
        tooltipTitle="Discounted PnL"
        tooltip="Risk-haircut version of Unrealized PnL that Phoenix uses for its margin and liquidation calculations. Stricter than the headline number when the asset is volatile."
      >
        <span className={data.discounted_unrealized_pnl >= 0 ? "text-ember-green" : "text-ember-red"}>
          {data.discounted_unrealized_pnl >= 0 ? "+" : ""}{formatUsd(data.discounted_unrealized_pnl)}
        </span>
      </DetailRow>
      <DetailRow
        label="ROI"
        tooltipTitle="Return on Capital"
        tooltip="Unrealized PnL ÷ Collateral × 100. Tells you what percentage of your remaining margin the position has earned (or lost). Bounded at −100%; if Phoenix's risk view says you're at the maintenance limit, liquidation triggers before this hits −100%."
      >
        <span className={roi >= 0 ? "text-ember-green" : "text-ember-red"}>
          {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
        </span>
      </DetailRow>
      {Math.abs(live.unsettledFunding) > 0.0001 && (
        <DetailRow
          label="Unsettled Funding"
          tooltipTitle="Unsettled Funding"
          tooltip="Funding accrued in the current 8-hour epoch but not yet paid. Folds into Lifetime Funding when the epoch boundary crosses. Negative = you'll pay; positive = you'll receive. Not included in the headline Unrealized PnL above."
        >
          <span className={live.unsettledFunding >= 0 ? "text-ember-green" : "text-ember-red"}>
            {live.unsettledFunding >= 0 ? "+" : ""}{formatUsd(live.unsettledFunding)}
          </span>
        </DetailRow>
      )}
      {Math.abs(live.accumulatedFunding) > 0.0001 && (
        <DetailRow
          label="Lifetime Funding"
          tooltipTitle="Lifetime Funding"
          tooltip="Total realized funding paid (negative) or received (positive) on this position since it was opened. Already counted in your wallet balance — not added to Unrealized PnL above."
        >
          <span className={live.accumulatedFunding >= 0 ? "text-ember-green" : "text-ember-red"}>
            {live.accumulatedFunding >= 0 ? "+" : ""}{formatUsd(live.accumulatedFunding)}
          </span>
        </DetailRow>
      )}

      {/* Margin & Risk */}
      <SectionHeader title="Margin & Risk" />
      <DetailRow
        label="Collateral"
        tooltipTitle="Collateral (Live, Effective)"
        tooltip="Current capital backing this position, post-PnL. Isolated: subaccount's effective collateral (deposit ± unrealized PnL). Cross: total cross-margin effective collateral. Updates live as mark moves."
      >${formatPrice(collateral)}</DetailRow>
      {data.allocated_collateral > 0 && data.allocated_collateral !== collateral && (
        <DetailRow
          label="Allocated Collateral"
          tooltipTitle="Allocated Collateral"
          tooltip="Phoenix-specific allocation field reported per-position. Usually matches Collateral; surfaces here only when they differ."
        >${formatPrice(data.allocated_collateral)}</DetailRow>
      )}
      <DetailRow
        label="Initial Margin"
        tooltipTitle="Initial Margin Requirement"
        tooltip="Minimum margin Phoenix requires to keep this position open at the current size and mark. Formula: Notional ÷ max leverage for this market. Note: this is the protocol's CURRENT requirement, not what you originally deposited."
      >${formatPrice(data.initial_margin)}</DetailRow>
      <DetailRow
        label="Eff. Leverage"
        tooltipTitle="Effective Leverage"
        tooltip="How leveraged this position is right now. Formula: Notional ÷ Collateral. Higher = larger move needed to liquidate, but a smaller adverse move wipes a bigger % of capital."
      >
        <span className="text-ember-orange">
          {effLeverage > 0 ? `${effLeverage.toFixed(2)}x` : "—"}
        </span>
      </DetailRow>
      <DetailRow
        label="Liquidation Price"
        tooltipTitle="Liquidation Price"
        tooltip="Mark price at which Phoenix's keeper closes this position to prevent insolvency. Computed from your collateral, position size, and the maintenance margin requirement for the market."
      >
        {data.liquidation_price != null
          ? <span className="text-ember-red">${formatPrice(data.liquidation_price)}</span>
          : <span className="text-text-secondary/30">—</span>}
      </DetailRow>
      <DetailRow
        label="Liq. Distance"
        tooltipTitle="Distance to Liquidation"
        tooltip="How far the current mark is from the liquidation price, as a %. Color: red < 5% (critical), yellow < 10% (warning), green > 10% (healthy)."
      >
        {liqDistPct != null
          ? <span className={liqDistPct < 5 ? "text-ember-red" : liqDistPct < 10 ? "text-yellow-500" : "text-ember-green"}>
              {liqDistPct.toFixed(2)}%
            </span>
          : <span className="text-text-secondary/30">—</span>}
      </DetailRow>

      {/* TP/SL */}
      <SectionHeader title={
        <span className="inline-flex items-center gap-1.5">
          Take Profit / Stop Loss
          {(data.tp_price != null) !== (data.sl_price != null) && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title="Partial bracket" />
          )}
        </span>
      } />
      <DetailRow
        label="Take Profit"
        tooltipTitle="Take-Profit Price"
        tooltip="Auto-close trigger that locks in gains. When mark crosses this price in your favor, Phoenix closes the position with a market order. Set when you opened the position; cancel below."
      >
        <span className="inline-flex items-center gap-2">
          {data.tp_price != null ? (
            <>
              <span className="text-ember-green">${formatPrice(data.tp_price)}</span>
              <button
                onClick={() => handleCancelLeg("tp")}
                disabled={cancellingLeg !== null}
                className={clsx(
                  "font-mono text-[9px] uppercase tracking-wider transition-colors",
                  cancellingLeg !== null
                    ? "text-text-secondary/40"
                    : "text-ember-red/60 hover:text-ember-red"
                )}
              >
                {cancellingLeg === "tp" ? "..." : "Cancel"}
              </button>
            </>
          ) : (
            <span className="text-text-secondary/30">{data.sl_price != null ? "—" : "Not set"}</span>
          )}
        </span>
      </DetailRow>
      <DetailRow
        label="Stop Loss"
        tooltipTitle="Stop-Loss Price"
        tooltip="Auto-close trigger that limits losses. When mark crosses this price against you, Phoenix closes the position with a market order. Slippage is possible in fast markets."
      >
        <span className="inline-flex items-center gap-2">
          {data.sl_price != null ? (
            <>
              <span className="text-ember-red">${formatPrice(data.sl_price)}</span>
              <button
                onClick={() => handleCancelLeg("sl")}
                disabled={cancellingLeg !== null}
                className={clsx(
                  "font-mono text-[9px] uppercase tracking-wider transition-colors",
                  cancellingLeg !== null
                    ? "text-text-secondary/40"
                    : "text-ember-red/60 hover:text-ember-red"
                )}
              >
                {cancellingLeg === "sl" ? "..." : "Cancel"}
              </button>
            </>
          ) : (
            <span className="text-text-secondary/30">{data.tp_price != null ? "—" : "Not set"}</span>
          )}
        </span>
      </DetailRow>
      {data.tp_price != null && (
        <DetailRow
          label="TP Distance"
          tooltipTitle="Distance to Take Profit"
          tooltip="How far the current mark is from your TP price, as a %. Smaller = closer to triggering."
        >
          <span className="text-ember-green">
            {liveMarkPrice > 0 ? `${(Math.abs((data.tp_price - liveMarkPrice) / liveMarkPrice) * 100).toFixed(2)}%` : "—"}
          </span>
        </DetailRow>
      )}
      {data.sl_price != null && (
        <DetailRow
          label="SL Distance"
          tooltipTitle="Distance to Stop Loss"
          tooltip="How far the current mark is from your SL price, as a %. Smaller = closer to triggering."
        >
          <span className="text-ember-red">
            {liveMarkPrice > 0 ? `${(Math.abs((data.sl_price - liveMarkPrice) / liveMarkPrice) * 100).toFixed(2)}%` : "—"}
          </span>
        </DetailRow>
      )}
      {data.tp_price != null && data.sl_price != null && (
        <DetailRow
          label="Risk/Reward"
          tooltipTitle="Risk/Reward Ratio"
          tooltip="Reward (TP distance) ÷ Risk (SL distance), expressed as 1:N. 1:2 means a winning leg pays twice the losing leg. ≥1:2 is conventional for a 'good' setup, but doesn't account for win probability."
        >
          {(() => {
            const risk = Math.abs(liveMarkPrice - data.sl_price);
            const reward = Math.abs(data.tp_price - liveMarkPrice);
            const rr = risk > 0 ? reward / risk : 0;
            return <span className="text-text-primary">1:{rr.toFixed(2)}</span>;
          })()}
        </DetailRow>
      )}
    </>
  );
}

function TradeHistoryDetail({ data }: { data: import("@/types/trader").TradeHistoryItem }) {
  const price = parseFloat(data.price);
  const baseQty = parseFloat(data.baseQty);
  const quoteQty = parseFloat(data.quoteQty);
  const notional = price * baseQty;
  const typeLabel = data.instructionType
    ?.replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim() || "Trade";

  return (
    <>
      <DetailRow label="Symbol" tooltipTitle="Symbol" tooltip="The perpetual contract market this fill traded on.">{data.marketSymbol}-PERP</DetailRow>
      <DetailRow
        label="Type"
        tooltipTitle="Instruction Type"
        tooltip="The Phoenix on-chain instruction that produced this fill (e.g. PlaceMarketOrder, PlaceLimitOrder, Liquidation)."
      >{typeLabel}</DetailRow>

      <SectionHeader title="Execution" />
      <DetailRow label="Price" tooltipTitle="Fill Price" tooltip="Price at which this fill executed. If the order matched against multiple orderbook levels, this is the volume-weighted average.">${formatPrice(price)}</DetailRow>
      <DetailRow label="Base Quantity" tooltipTitle="Base Quantity" tooltip="Amount filled in the base asset (BTC, SOL, etc.). Sign is implicit: buys add, sells reduce.">{formatSize(baseQty, 4)} {data.marketSymbol}</DetailRow>
      <DetailRow label="Quote Quantity" tooltipTitle="Quote Quantity" tooltip="USDC value moved by this fill (Price × Base Quantity, before fees).">${formatPrice(quoteQty)}</DetailRow>
      <DetailRow label="Notional Value" tooltipTitle="Notional Value" tooltip="USD size of this single fill. Same as Quote Quantity for an exact-price fill.">${formatPrice(notional)}</DetailRow>

      <SectionHeader title="Timing" />
      <DetailRow label="Executed At" tooltipTitle="Execution Time" tooltip="Solana block time when this fill landed on-chain (UTC).">
        {new Date(data.timestamp).toLocaleString("en-US", {
          year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        })}
      </DetailRow>

      <SectionHeader title="On-Chain" />
      <DetailRow label="Transaction" tooltipTitle="Transaction Signature" tooltip="The Solana transaction that contains this fill. Click to view the full instruction trace on Orb.">
        <a
          href={`https://orbmarkets.io/tx/${data.transactionSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-ember-orange hover:underline"
        >
          {data.transactionSignature.slice(0, 8)}...{data.transactionSignature.slice(-6)}
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 3H3v10h10v-3" />
            <path d="M9 2h5v5" />
            <path d="M14 2L7 9" />
          </svg>
        </a>
      </DetailRow>
    </>
  );
}

function RecentTradeDetail({ data }: { data: import("@/types/market").Trade }) {
  const ts = typeof data.timestamp === "string"
    ? new Date(data.timestamp)
    : new Date(data.timestamp * 1000);
  const isBuy = data.side === "bid";
  const notional = data.price * data.size;

  return (
    <>
      <DetailRow label="Side" tooltipTitle="Side" tooltip="Whether the taker side of this print was a buy (bid) or a sell (ask). The opposite side was the maker on the book.">
        <span className={isBuy ? "text-ember-green" : "text-ember-red"}>
          {isBuy ? "BUY" : "SELL"}
        </span>
      </DetailRow>
      <DetailRow label="Price" tooltipTitle="Trade Price" tooltip="Price at which the trade printed. VWAP if it crossed multiple orderbook levels.">${formatPrice(data.price)}</DetailRow>
      <DetailRow label="Size" tooltipTitle="Trade Size" tooltip="Size of the print, denominated in the base asset.">{formatSize(data.size, 4)}</DetailRow>
      <DetailRow label="Notional Value" tooltipTitle="Notional Value" tooltip="USD size of the trade (Price × Size).">${formatPrice(notional)}</DetailRow>
      <DetailRow label="Time" tooltipTitle="Trade Time" tooltip="When the trade printed on Phoenix (UTC).">
        {ts.toLocaleString("en-US", {
          month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        })}
      </DetailRow>
    </>
  );
}
