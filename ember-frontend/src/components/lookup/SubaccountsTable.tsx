"use client";

import { useState } from "react";
import type { SubaccountRow } from "@/hooks/useLookupData";
import { asArray, toNum } from "@/lib/normalize";
import { LookupErrorBoundary } from "./LookupErrorBoundary";
import clsx from "clsx";

interface Props {
  accounts: SubaccountRow[];
  /** Filter the activity timeline to a single subaccount index. */
  onFilterSubaccount?: (idx: number) => void;
}

/**
 * One row per Phoenix subaccount for the looked-up wallet. Rows
 * expand inline to reveal the full set of positions + open orders
 * on that subaccount — keeps the at-a-glance view compact but lets
 * a support user drill in on a specific account without leaving the
 * page.
 */
export function SubaccountsTable({ accounts, onFilterSubaccount }: Props) {
  if (accounts.length === 0) {
    return (
      <div className="border border-ember-border bg-surface-l1 px-4 py-4 font-mono text-[11px] text-text-secondary/50">
        No Phoenix subaccounts found for this wallet.
      </div>
    );
  }

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="border-b border-ember-border/60 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
        Subaccounts <span className="ml-2 text-text-secondary/40">({accounts.length} total)</span>
      </div>
      <table className="w-full font-mono text-[11px]" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "60px" }} />
          <col style={{ width: "100px" }} />
          <col style={{ width: "120px" }} />
          <col style={{ width: "120px" }} />
          <col style={{ width: "100px" }} />
          <col style={{ width: "100px" }} />
          <col style={{ width: "120px" }} />
        </colgroup>
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-text-secondary/40">
            <Th>Idx</Th>
            <Th>Type</Th>
            <Th align="right">Collateral</Th>
            <Th align="right">Eff. Coll.</Th>
            <Th align="right">Positions</Th>
            <Th align="right">Orders</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => <SubaccountTr key={`${a.traderPdaIndex}-${a.traderSubaccountIndex}`} account={a} onFilter={onFilterSubaccount} />)}
        </tbody>
      </table>
    </div>
  );
}

function SubaccountTr({ account: a, onFilter }: { account: SubaccountRow; onFilter?: (idx: number) => void }) {
  const [open, setOpen] = useState(false);
  // Phoenix returns `limitOrders` as an OBJECT keyed by order id (and
  // as `{}` when empty), not an array — calling `.map` on it crashes
  // the page. `asArray` normalizes both shapes.
  const positions = asArray<Record<string, unknown>>(a.positions);
  const orders = asArray<Record<string, unknown>>(a.limitOrders);
  const isCross = a.traderSubaccountIndex === 0;
  const symbol = isolatedMarketFor(positions, orders);
  const typeLabel = isCross ? "Cross" : `Iso · ${symbol ? `${symbol} #${a.traderSubaccountIndex}` : `#${a.traderSubaccountIndex}`}`;
  const status = computeStatus(a);
  const collateral = toNum(a.collateralBalance);
  const effective = toNum(a.effectiveCollateral);

  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-b border-ember-border/20 hover:bg-surface-l2/40 transition-colors"
      >
        <td className="px-3 py-1.5">
          <span className="text-text-secondary/40">{open ? "▾" : "▸"}</span>{" "}
          <span className="text-text-primary">{a.traderSubaccountIndex}</span>
        </td>
        <td className="px-3 py-1.5 text-text-secondary/80">{typeLabel}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">${formatUsd(collateral)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">${formatUsd(effective)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{positions.length}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{orders.length}</td>
        <td className={clsx("px-3 py-1.5", status.cls)}>
          <span className="inline-flex items-center gap-2">
            {status.label}
            {onFilter && (
              <button
                onClick={(ev) => { ev.stopPropagation(); onFilter(a.traderSubaccountIndex); }}
                className="text-text-secondary/35 hover:text-ember-orange transition-colors"
                title={`Filter activity to ${isCross ? "cross" : `iso·${a.traderSubaccountIndex}`}`}
                aria-label="Filter activity to this subaccount"
              >
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                  <path d="M2 3h12l-4.5 5.5V13L6.5 11.5V8.5L2 3z" />
                </svg>
              </button>
            )}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-ember-border/30 bg-surface-l2/20">
          <td colSpan={7} className="px-4 py-3">
            <LookupErrorBoundary label={`Subaccount #${a.traderSubaccountIndex} detail`}>
              <SubaccountDetail account={a} />
            </LookupErrorBoundary>
          </td>
        </tr>
      )}
    </>
  );
}

function SubaccountDetail({ account: a }: { account: SubaccountRow }) {
  // Phoenix returns `limitOrders` as an OBJECT keyed by order id (and
  // as `{}` when empty), not an array — calling `.map` on it crashes
  // the page. `asArray` normalizes both shapes.
  const positions = asArray<Record<string, unknown>>(a.positions);
  const orders = asArray<Record<string, unknown>>(a.limitOrders);
  const unrPnl = toNum(a.unrealizedPnl);
  const initMargin = toNum(a.initialMargin);
  const maintMargin = toNum(a.maintenanceMargin);
  const accFunding = toNum(a.accumulatedFunding);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px bg-ember-border/30 sm:grid-cols-4">
        <Stat label="Unrealized PnL" value={`${unrPnl >= 0 ? "+" : ""}$${formatUsd(unrPnl)}`} tone={unrPnl >= 0 ? "green" : "red"} />
        <Stat label="Initial margin"    value={`$${formatUsd(initMargin)}`} />
        <Stat label="Maint. margin"     value={`$${formatUsd(maintMargin)}`} />
        <Stat label="Accum. funding"    value={`${accFunding >= 0 ? "+" : ""}$${formatUsd(accFunding)}`} />
      </div>

      <div>
        <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">Positions ({positions.length})</div>
        {positions.length === 0 ? (
          <div className="px-1 py-1 font-mono text-[10px] text-text-secondary/40">no open positions</div>
        ) : (
          <table className="w-full font-mono text-[10px] tabular-nums">
            <thead>
              <tr className="text-[8px] uppercase tracking-wider text-text-secondary/40">
                <Th>Market</Th><Th>Side</Th><Th align="right">Size</Th><Th align="right">Entry</Th><Th align="right">Liq.</Th><Th align="right">Unr. PnL</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => <PositionRow key={i} p={p as Record<string, unknown>} />)}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">Open orders ({orders.length})</div>
        {orders.length === 0 ? (
          <div className="px-1 py-1 font-mono text-[10px] text-text-secondary/40">no open orders</div>
        ) : (
          <table className="w-full font-mono text-[10px] tabular-nums">
            <thead>
              <tr className="text-[8px] uppercase tracking-wider text-text-secondary/40">
                <Th>Market</Th><Th>Side</Th><Th align="right">Size</Th><Th align="right">Price</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => <OrderRow key={i} o={o as Record<string, unknown>} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PositionRow({ p }: { p: Record<string, unknown> }) {
  const symbol = String(p.marketSymbol ?? p.symbol ?? "—");
  const baseLots = toNum(p.baseLots ?? p.baseLotsSigned ?? 0);
  const side = baseLots >= 0 ? "LONG" : "SHORT";
  const sideColor = baseLots >= 0 ? "text-ember-green" : "text-ember-red";
  const size = Math.abs(toNum(p.baseSize ?? p.size ?? baseLots));
  const entry = toNum(p.entryPrice ?? p.averageEntryPrice ?? 0);
  const liq = toNum(p.liquidationPrice ?? p.liqPrice ?? 0);
  const unrPnl = toNum(p.unrealizedPnl ?? 0);
  return (
    <tr className="border-t border-ember-border/15">
      <td className="px-1 py-0.5 text-text-secondary/80">{symbol}</td>
      <td className={clsx("px-1 py-0.5", sideColor)}>{side}</td>
      <td className="px-1 py-0.5 text-right">{size.toFixed(4)}</td>
      <td className="px-1 py-0.5 text-right">${formatUsd(entry)}</td>
      <td className="px-1 py-0.5 text-right text-ember-red/80">{liq > 0 ? `$${formatUsd(liq)}` : "—"}</td>
      <td className={clsx("px-1 py-0.5 text-right", unrPnl >= 0 ? "text-ember-green" : "text-ember-red")}>{unrPnl >= 0 ? "+" : ""}${formatUsd(unrPnl)}</td>
    </tr>
  );
}

function OrderRow({ o }: { o: Record<string, unknown> }) {
  const symbol = String(o.marketSymbol ?? "—");
  const side = String(o.side ?? "—").toLowerCase();
  const sideColor = side === "buy" || side === "long" ? "text-ember-green" : "text-ember-red";
  const size = toNum(o.remainingBaseQty ?? o.baseQty ?? 0);
  const price = toNum(o.price ?? 0);
  return (
    <tr className="border-t border-ember-border/15">
      <td className="px-1 py-0.5 text-text-secondary/80">{symbol}</td>
      <td className={clsx("px-1 py-0.5 uppercase", sideColor)}>{side}</td>
      <td className="px-1 py-0.5 text-right">{size.toFixed(4)}</td>
      <td className="px-1 py-0.5 text-right">${formatUsd(price)}</td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-ember-green" : tone === "red" ? "text-ember-red" : "text-text-primary";
  return (
    <div className="flex flex-col gap-0.5 bg-surface-l1 px-3 py-2">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">{label}</span>
      <span className={clsx("font-mono text-xs tabular-nums", color)}>{value}</span>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={clsx("px-3 py-1 font-normal", align === "right" ? "text-right" : "text-left")}>{children}</th>;
}

/**
 * Best-effort market symbol for an isolated subaccount label. An
 * isolated subaccount tracks a single market, so the symbol on any
 * open position (or, failing that, any resting order) identifies it —
 * we no longer require exactly one position to infer it.
 */
function isolatedMarketFor(
  positions: Array<Record<string, unknown>>,
  orders: Array<Record<string, unknown>> = [],
): string | null {
  for (const p of positions) {
    const s = String(p.marketSymbol ?? p.symbol ?? "");
    if (s) return s;
  }
  for (const o of orders) {
    const s = String(o.marketSymbol ?? "");
    if (s) return s;
  }
  return null;
}

function computeStatus(a: SubaccountRow): { label: string; cls: string } {
  const risk = String(a.riskState ?? "").toLowerCase();
  if (risk.includes("liquid")) return { label: "liquidatable", cls: "text-ember-red" };
  if (risk.includes("warn"))   return { label: "warning",      cls: "text-yellow-500" };
  const collat = toNum(a.collateralBalance);
  // limitOrders is an object map (asArray normalizes both shapes); a bare
  // `.length` on it is `undefined`, so the empty check never fired before.
  if (asArray(a.positions).length === 0 && asArray(a.limitOrders).length === 0 && collat < 0.01) {
    return { label: "empty", cls: "text-text-secondary/40" };
  }
  return { label: "healthy", cls: "text-ember-green" };
}

function formatUsd(n: unknown): string {
  const v = toNum(n);
  return Math.abs(v) >= 1000
    ? v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : v.toFixed(2);
}
