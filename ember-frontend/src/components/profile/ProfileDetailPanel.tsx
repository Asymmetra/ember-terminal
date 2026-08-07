"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProfileDetailStore, type ProfilePositionRow } from "@/stores/profileDetailStore";
import { formatPrice, formatUsd, formatUsdPrecise } from "@/lib/format";
import { sdkNum, type NormalizedTrade, type PerMarketStats, type Period } from "@/lib/tradeStats";
import clsx from "clsx";

// Right-side drawer for profile row details. Shares the visual vocabulary of
// the terminal's TradeDetailPanel but is scoped to profile entity shapes:
// trades, orders, funding events, collateral movements, per-market rollups,
// and open positions. Narrower type surface = simpler store + components.

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">{label}</span>
      <span className="font-mono text-[11px] text-text-primary">{children}</span>
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

export function ProfileDetailPanel() {
  const open = useProfileDetailStore((s) => s.open);
  const detail = useProfileDetailStore((s) => s.detail);
  const close = useProfileDetailStore((s) => s.close);

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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={close}
            className="fixed inset-0 z-[90] bg-black/40"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[90] w-full max-w-[380px] sm:w-[380px] border-l border-ember-border bg-surface-l1 shadow-[-16px_0_64px_rgba(0,0,0,0.4)] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-ember-border px-4 py-3">
              <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-primary">
                {titleFor(detail)}
              </span>
              <button
                onClick={close}
                className="text-text-secondary/60 transition-colors hover:text-text-primary"
                aria-label="Close"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-px p-4">
              {detail.type === "trade" && <TradeDetail t={detail.data} />}
              {detail.type === "order" && <OrderDetail o={detail.data} />}
              {detail.type === "funding" && <FundingDetail f={detail.data} />}
              {detail.type === "collateral" && <CollateralDetail c={detail.data} />}
              {detail.type === "perMarket" && (
                <PerMarketDetail r={detail.data} period={detail.period} />
              )}
              {detail.type === "position" && <PositionDetail p={detail.data} />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function titleFor(d: NonNullable<ReturnType<typeof useProfileDetailStore.getState>["detail"]>): string {
  switch (d.type) {
    case "trade":
      return `${d.data.symbol}-PERP Trade`;
    case "order":
      return `${String((d.data as any).marketSymbol ?? "")}-PERP Order`;
    case "funding":
      return `${String((d.data as any).symbol ?? "")}-PERP Funding`;
    case "collateral":
      return `Collateral ${String((d.data as any).eventType ?? "")}`;
    case "perMarket":
      return `${d.data.symbol}-PERP Rollup`;
    case "position":
      return `${d.data.symbol}-PERP Position`;
  }
}

/* ─── Trade ─── */

function TradeDetail({ t }: { t: NormalizedTrade }) {
  const buy = t.delta > 0;
  const notional = Math.abs(t.delta) * t.price;
  const net = t.realizedPnl - t.fees;
  return (
    <>
      <DetailRow label="Market">{t.symbol}-PERP</DetailRow>
      <DetailRow label="Side">
        <span className={buy ? "text-ember-green" : "text-ember-red"}>
          {buy ? "BUY" : "SELL"}
        </span>
      </DetailRow>
      <DetailRow label="Type">
        <span className={clsx(
          "px-1 py-0.5 text-[9px] uppercase tracking-wider",
          t.tradeType === "liquidation"
            ? "bg-ember-red/15 text-ember-red"
            : "bg-surface-l2 text-text-secondary/70"
        )}>
          {t.tradeType}
        </span>
      </DetailRow>
      <DetailRow label="Liquidity">
        <span className="uppercase text-text-secondary/80">{t.liquidity}</span>
      </DetailRow>

      <SectionHeader title="Execution" />
      <DetailRow label="Price">${formatPrice(t.price)}</DetailRow>
      <DetailRow label="Size">
        {Math.abs(t.delta).toFixed(4)} {t.symbol}
      </DetailRow>
      <DetailRow label="Notional">${formatPrice(notional)}</DetailRow>

      <SectionHeader title="Position change" />
      <DetailRow label="Before">{t.baseBefore.toFixed(4)}</DetailRow>
      <DetailRow label="After">{t.baseAfter.toFixed(4)}</DetailRow>
      <DetailRow label="Delta">
        <span className={buy ? "text-ember-green" : "text-ember-red"}>
          {buy ? "+" : ""}{t.delta.toFixed(4)}
        </span>
      </DetailRow>

      <SectionHeader title="PnL" />
      <DetailRow label="Realized PnL">
        {t.realizedPnl === 0 ? (
          <span className="text-text-secondary/40">—</span>
        ) : (
          <span className={t.realizedPnl > 0 ? "text-ember-green" : "text-ember-red"}>
            {t.realizedPnl > 0 ? "+" : ""}{formatUsdPrecise(t.realizedPnl)}
          </span>
        )}
      </DetailRow>
      <DetailRow label="Fees">
        {t.fees === 0 ? (
          <span className="text-text-secondary/40">—</span>
        ) : (
          formatUsdPrecise(t.fees)
        )}
      </DetailRow>
      <DetailRow label="Net">
        {net === 0 ? (
          <span className="text-text-secondary/40">—</span>
        ) : (
          <span className={net > 0 ? "text-ember-green" : "text-ember-red"}>
            {net > 0 ? "+" : ""}{formatUsdPrecise(net)}
          </span>
        )}
      </DetailRow>

      <SectionHeader title="Timing" />
      <DetailRow label="Executed">
        {new Date(t.time * 1000).toLocaleString(undefined, {
          year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        })}
      </DetailRow>

      {t.signature && (
        <>
          <SectionHeader title="On-chain" />
          <DetailRow label="Transaction">
            <a
              href={`https://solscan.io/tx/${t.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ember-orange hover:underline"
            >
              {t.signature.slice(0, 8)}…{t.signature.slice(-6)}
            </a>
          </DetailRow>
        </>
      )}
    </>
  );
}

/* ─── Order ─── */

function OrderDetail({ o }: { o: Record<string, unknown> }) {
  const buy = String((o as any).side).toLowerCase() === "bid";
  const base = sdkNum((o as any).baseQty);
  const filled = sdkNum((o as any).filledBaseQty);
  const pct = base > 0 ? (filled / base) * 100 : 0;
  const price = sdkNum((o as any).price);
  const status = String((o as any).status ?? "");
  return (
    <>
      <DetailRow label="Market">{String((o as any).marketSymbol ?? "—")}-PERP</DetailRow>
      <DetailRow label="Side">
        <span className={buy ? "text-ember-green" : "text-ember-red"}>
          {buy ? "BUY" : "SELL"}
        </span>
      </DetailRow>
      <DetailRow label="Status">
        <span className={clsx(
          "px-1 py-0.5 text-[9px] uppercase tracking-wider",
          status.toLowerCase().includes("fill")
            ? "bg-ember-green/15 text-ember-green"
            : status.toLowerCase().includes("cancel")
              ? "bg-surface-l2 text-text-secondary/60"
              : "bg-ember-orange/15 text-ember-orange"
        )}>
          {status || "—"}
        </span>
      </DetailRow>
      <DetailRow label="Type">
        {String((o as any).orderType ?? (o as any).instructionType ?? "—")}
      </DetailRow>

      <SectionHeader title="Fill" />
      <DetailRow label="Price">${formatPrice(price)}</DetailRow>
      <DetailRow label="Base Qty">{base.toFixed(4)}</DetailRow>
      <DetailRow label="Filled">
        {filled.toFixed(4)} <span className="text-text-secondary/40">({pct.toFixed(0)}%)</span>
      </DetailRow>
      <DetailRow label="Notional">${formatPrice(price * base)}</DetailRow>

      <SectionHeader title="Timing" />
      {(o as any).placedAt && (
        <DetailRow label="Placed">
          {new Date(String((o as any).placedAt)).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          })}
        </DetailRow>
      )}
      {(o as any).lastUpdatedAt && (
        <DetailRow label="Last updated">
          {new Date(String((o as any).lastUpdatedAt)).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false,
          })}
        </DetailRow>
      )}
    </>
  );
}

/* ─── Funding ─── */

function FundingDetail({ f }: { f: Record<string, unknown> }) {
  const payment = sdkNum((f as any).fundingPayment ?? (f as any).fundingAmount);
  const received = payment < 0;
  const sideStr = String((f as any).positionSide ?? "").toLowerCase();
  const long = sideStr.includes("long");
  const short = sideStr.includes("short");
  const rate = sdkNum((f as any).fundingRatePercentage ?? (f as any).fundingRate);
  const positionSize = sdkNum((f as any).positionSize);
  const mark = sdkNum((f as any).markPrice ?? (f as any).mark_price);
  return (
    <>
      <DetailRow label="Market">{String((f as any).symbol ?? "")}-PERP</DetailRow>
      <DetailRow label="Position">
        <span className={long ? "text-ember-green" : short ? "text-ember-red" : undefined}>
          {long ? "LONG" : short ? "SHORT" : "—"}
        </span>
      </DetailRow>

      <SectionHeader title="Payment" />
      <DetailRow label="Amount">
        {payment === 0 ? (
          <span className="text-text-secondary/40">$0.00</span>
        ) : received ? (
          <span className="text-ember-green">+{formatUsdPrecise(Math.abs(payment))}</span>
        ) : (
          <span className="text-ember-red">-{formatUsdPrecise(payment)}</span>
        )}
      </DetailRow>
      <DetailRow label="Direction">
        {payment === 0 ? "—" : received ? "Received" : "Paid"}
      </DetailRow>

      <SectionHeader title="State at event" />
      <DetailRow label="Position size">{positionSize.toFixed(4)}</DetailRow>
      {mark > 0 && <DetailRow label="Mark price">${formatPrice(mark)}</DetailRow>}
      <DetailRow label="Funding rate">{(rate * 100).toFixed(4)}%</DetailRow>

      <SectionHeader title="Timing" />
      {(f as any).timestamp && (
        <DetailRow label="Time">
          {new Date(String((f as any).timestamp)).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          })}
        </DetailRow>
      )}
    </>
  );
}

/* ─── Collateral ─── */

function CollateralDetail({ c }: { c: Record<string, unknown> }) {
  const raw = typeof (c as any).amount === "number" ? (c as any).amount : sdkNum((c as any).amount);
  const amount = raw / 1_000_000;
  const after = (typeof (c as any).collateralAfter === "number"
    ? (c as any).collateralAfter
    : sdkNum((c as any).collateralAfter)) / 1_000_000;
  const type = String((c as any).eventType ?? "").toLowerCase();
  const subaccount = (c as any).traderSubaccountIndex ?? 0;
  const isIso = subaccount !== 0;
  return (
    <>
      <DetailRow label="Type">
        <span className={clsx(
          "px-1 py-0.5 text-[9px] uppercase tracking-wider",
          type === "deposit"
            ? "bg-ember-green/15 text-ember-green"
            : type === "withdraw"
              ? "bg-ember-red/15 text-ember-red"
              : "bg-surface-l2 text-text-secondary/70"
        )}>
          {type || "—"}
        </span>
      </DetailRow>
      <DetailRow label="Subaccount">
        {isIso ? `Isolated #${subaccount}` : "Cross (0)"}
      </DetailRow>

      <SectionHeader title="Amount" />
      <DetailRow label="Amount">
        <span className={amount > 0 ? "text-ember-green" : amount < 0 ? "text-ember-red" : ""}>
          {amount > 0 ? "+" : ""}{formatUsd(amount)}
        </span>
      </DetailRow>
      <DetailRow label="Balance after">${formatPrice(after)}</DetailRow>

      <SectionHeader title="Timing" />
      {(c as any).timestamp && (
        <DetailRow label="Time">
          {new Date(String((c as any).timestamp)).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          })}
        </DetailRow>
      )}

      {(c as any).signature && (
        <>
          <SectionHeader title="On-chain" />
          <DetailRow label="Transaction">
            <a
              href={`https://solscan.io/tx/${String((c as any).signature)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ember-orange hover:underline"
            >
              {String((c as any).signature).slice(0, 8)}…{String((c as any).signature).slice(-6)}
            </a>
          </DetailRow>
        </>
      )}
    </>
  );
}

/* ─── Per-market ─── */

function PerMarketDetail({ r, period }: { r: PerMarketStats; period: Period }) {
  const net = r.realizedPnl - r.fees;
  const netPos = net >= 0;
  const pnlPos = r.realizedPnl >= 0;
  const avgSize = r.trades > 0 ? r.volume / r.trades : 0;
  return (
    <>
      <DetailRow label="Market">{r.symbol}-PERP</DetailRow>
      <DetailRow label="Window">{period === "all" ? "All time" : period}</DetailRow>

      <SectionHeader title="Activity" />
      <DetailRow label="Trades">{r.trades}</DetailRow>
      <DetailRow label="Volume">{formatUsd(r.volume)}</DetailRow>
      <DetailRow label="Avg trade size">${formatPrice(avgSize)}</DetailRow>
      <DetailRow label="Win rate">{(r.winRate * 100).toFixed(0)}%</DetailRow>

      <SectionHeader title="PnL" />
      <DetailRow label="Realized PnL">
        <span className={pnlPos ? "text-ember-green" : "text-ember-red"}>
          {pnlPos ? "+" : ""}{formatUsdPrecise(r.realizedPnl)}
        </span>
      </DetailRow>
      <DetailRow label="Fees">{formatUsdPrecise(r.fees)}</DetailRow>
      <DetailRow label="Net">
        <span className={netPos ? "text-ember-green" : "text-ember-red"}>
          {netPos ? "+" : ""}{formatUsdPrecise(net)}
        </span>
      </DetailRow>
    </>
  );
}

/* ─── Position ─── */

function PositionDetail({ p }: { p: ProfilePositionRow }) {
  const isLong = p.size >= 0;
  const effLeverage = p.initialMargin > 0 ? Math.abs(p.positionValue) / p.initialMargin : 0;
  const upnlPositive = p.unrealizedPnl >= 0;
  return (
    <>
      <DetailRow label="Market">{p.symbol}-PERP</DetailRow>
      <DetailRow label="Side">
        <span className={isLong ? "text-ember-green" : "text-ember-red"}>
          {isLong ? "LONG" : "SHORT"}
        </span>
      </DetailRow>
      <DetailRow label="Subaccount">
        {p.isolated ? `Isolated #${p.subaccountIndex}` : "Cross (0)"}
      </DetailRow>

      <SectionHeader title="Size & pricing" />
      <DetailRow label="Size">{Math.abs(p.size).toFixed(4)} {p.symbol}</DetailRow>
      <DetailRow label="Entry">${formatPrice(p.entry)}</DetailRow>
      <DetailRow label="Notional">${formatPrice(Math.abs(p.positionValue))}</DetailRow>

      <SectionHeader title="PnL & margin" />
      <DetailRow label="Unrealized PnL">
        <span className={upnlPositive ? "text-ember-green" : "text-ember-red"}>
          {upnlPositive ? "+" : ""}{formatUsd(p.unrealizedPnl)}
        </span>
      </DetailRow>
      <DetailRow label="Initial margin">${formatPrice(p.initialMargin)}</DetailRow>
      <DetailRow label="Eff. Leverage">
        <span className="text-ember-orange">
          {effLeverage > 0 ? `${effLeverage.toFixed(2)}x` : "—"}
        </span>
      </DetailRow>
      <DetailRow label="Liquidation Price">
        {p.liqPrice != null ? (
          <span className="text-ember-red">${formatPrice(p.liqPrice)}</span>
        ) : (
          <span className="text-text-secondary/40">—</span>
        )}
      </DetailRow>

      <SectionHeader title="Brackets" />
      <DetailRow label="Take Profit">
        {p.tp != null ? (
          <span className="text-ember-green">${formatPrice(p.tp)}</span>
        ) : (
          <span className="text-text-secondary/40">—</span>
        )}
      </DetailRow>
      <DetailRow label="Stop Loss">
        {p.sl != null ? (
          <span className="text-ember-red">${formatPrice(p.sl)}</span>
        ) : (
          <span className="text-text-secondary/40">—</span>
        )}
      </DetailRow>
    </>
  );
}
