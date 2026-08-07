"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice, formatUsd, formatUsdPrecise } from "@/lib/format";
import {
  normalizeTrade,
  sdkNum,
  type NormalizedTrade,
} from "@/lib/tradeStats";
import { useProfileDetailStore } from "@/stores/profileDetailStore";
import clsx from "clsx";

type Tab = "trades" | "orders" | "funding" | "collateral";
const TABS: { key: Tab; label: string }[] = [
  { key: "trades", label: "Trades" },
  { key: "orders", label: "Orders" },
  { key: "funding", label: "Funding" },
  { key: "collateral", label: "Collateral" },
];

interface Props {
  authority: string;
}

export function HistoryTabs({ authority }: Props) {
  const [tab, setTab] = useState<Tab>("trades");

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center border-b border-ember-border/60 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "px-4 py-2 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap transition-colors",
              tab === t.key
                ? "border-b border-ember-orange text-ember-orange"
                : "text-text-secondary/60 hover:text-text-secondary"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[200px]">
        {tab === "trades" && <TradesTable authority={authority} />}
        {tab === "orders" && <OrdersTable authority={authority} />}
        {tab === "funding" && <FundingTable authority={authority} />}
        {tab === "collateral" && <CollateralTable authority={authority} />}
      </div>
    </div>
  );
}

function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((v) => {
        if (!cancelled) {
          setData(v);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading };
}

/* ─── Trades (cursor-paginated journal) ─── */

function TradesTable({ authority }: { authority: string }) {
  const [rows, setRows] = useState<NormalizedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const openDetail = useProfileDetailStore((s) => s.openTrade);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    api
      .getTraderTrades(authority, { limit: 100 })
      .then((r: any) => {
        if (cancelled) return;
        setRows((r?.trades ?? []).map(normalizeTrade));
        setCursor(r?.next_cursor ?? r?.cursor);
        setHasMore(!!r?.has_more && !!(r?.next_cursor ?? r?.cursor));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [authority]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r: any = await api.getTraderTrades(authority, { cursor, limit: 100 });
      setRows((prev) => [...prev, ...((r?.trades ?? []).map(normalizeTrade) as NormalizedTrade[])]);
      setCursor(r?.next_cursor ?? r?.cursor);
      setHasMore(!!r?.has_more && !!(r?.next_cursor ?? r?.cursor));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [authority, cursor, loadingMore]);

  return (
    <>
      <TableFrame loading={loading} empty={!loading && rows.length === 0} emptyMsg="No trades yet.">
        <thead>
          <tr className="text-text-secondary/50">
            <Th>Time</Th>
            <Th>Market</Th>
            <Th>Side</Th>
            <Th right>Size</Th>
            <Th right>Price</Th>
            <Th right>Realized PnL</Th>
            <Th right>Fee</Th>
            <Th>Type</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const buy = t.delta > 0;
            const pnlPos = t.realizedPnl >= 0;
            const liq = t.tradeType === "liquidation";
            return (
              <tr
                key={`${t.signature ?? t.time}-${i}`}
                onClick={() => openDetail(t)}
                className="cursor-pointer border-t border-ember-border/40 font-mono transition-colors hover:bg-surface-l2/40"
              >
                <Td>{timeAgo(t.time)}</Td>
                <Td>{t.symbol}-PERP</Td>
                <Td colored={buy ? "green" : "red"}>{buy ? "BUY" : "SELL"}</Td>
                <Td right>{Math.abs(t.delta).toFixed(4)}</Td>
                <Td right>${formatPrice(t.price)}</Td>
                <Td right colored={pnlPos ? "green" : t.realizedPnl < 0 ? "red" : undefined}>
                  {t.realizedPnl === 0 ? "—" : `${pnlPos ? "+" : ""}${formatUsdPrecise(t.realizedPnl)}`}
                </Td>
                <Td right>{t.fees === 0 ? "—" : formatUsdPrecise(t.fees)}</Td>
                <Td>
                  <span
                    className={clsx(
                      "px-1 py-0.5 text-[9px] uppercase tracking-wider",
                      liq ? "bg-ember-red/15 text-ember-red" : "bg-surface-l2 text-text-secondary/70",
                    )}
                  >
                    {t.tradeType}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableFrame>
      {!loading && hasMore && (
        <div className="border-t border-ember-border/40 px-3 py-2 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="font-mono text-[10px] uppercase tracking-wider text-ember-orange/70 hover:text-ember-orange transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : `Load more (${rows.length} shown)`}
          </button>
        </div>
      )}
    </>
  );
}

/* ─── Orders ─── */

function OrdersTable({ authority }: { authority: string }) {
  const { data, loading } = useFetch<any[]>(
    () => api.getTraderOrders(authority, { limit: 200 }).then((r: any) => r?.orders ?? []),
    [authority]
  );
  const openDetail = useProfileDetailStore((s) => s.openOrder);
  const rows = (data ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
  return (
    <TableFrame loading={loading} empty={!loading && rows.length === 0} emptyMsg="No orders.">
      <thead>
        <tr className="text-text-secondary/50">
          <Th>Placed</Th>
          <Th>Market</Th>
          <Th>Side</Th>
          <Th right>Price</Th>
          <Th right>Size</Th>
          <Th right>Filled</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o: any, i: number) => {
          const buy = String(o.side).toLowerCase() === "bid";
          const filled = sdkNum(o.filledBaseQty);
          const base = sdkNum(o.baseQty);
          const pct = base > 0 ? (filled / base) * 100 : 0;
          const status = String(o.status ?? "").toLowerCase();
          return (
            <tr
              key={i}
              onClick={() => openDetail(o)}
              className="cursor-pointer border-t border-ember-border/40 font-mono transition-colors hover:bg-surface-l2/40"
            >
              <Td>{timeAgoIso(o.placedAt)}</Td>
              <Td>{String(o.marketSymbol ?? "")}-PERP</Td>
              <Td colored={buy ? "green" : "red"}>{buy ? "BUY" : "SELL"}</Td>
              <Td right>${formatPrice(sdkNum(o.price))}</Td>
              <Td right>{base.toFixed(4)}</Td>
              <Td right>
                {filled.toFixed(4)}{" "}
                <span className="text-text-secondary/40">({pct.toFixed(0)}%)</span>
              </Td>
              <Td>
                <span
                  className={clsx(
                    "px-1 py-0.5 text-[9px] uppercase tracking-wider",
                    status.includes("fill")
                      ? "bg-ember-green/15 text-ember-green"
                      : status.includes("cancel")
                        ? "bg-surface-l2 text-text-secondary/60"
                        : "bg-ember-orange/15 text-ember-orange"
                  )}
                >
                  {status || "—"}
                </span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

/* ─── Funding ─── */

function FundingTable({ authority }: { authority: string }) {
  const { data, loading } = useFetch<any[]>(
    () =>
      api.getTraderFunding(authority, { limit: 200 }).then((r: any) => {
        const f = r?.funding;
        if (Array.isArray(f)) return f;
        return f?.data ?? f?.events ?? [];
      }),
    [authority]
  );
  const openDetail = useProfileDetailStore((s) => s.openFunding);
  const rows = (data ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return (
    <TableFrame loading={loading} empty={!loading && rows.length === 0} emptyMsg="No funding events.">
      <thead>
        <tr className="text-text-secondary/50">
          <Th>Time</Th>
          <Th>Market</Th>
          <Th>Side</Th>
          <Th right>Position size</Th>
          <Th right>Rate</Th>
          <Th right>Payment</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f: any, i: number) => {
          const payment = sdkNum(f.fundingPayment ?? f.funding_amount ?? f.fundingAmount);
          const received = payment < 0; // payment < 0 means the trader received funding
          const sideStr = String(f.positionSide ?? "").toLowerCase();
          const long = sideStr.includes("long");
          const short = sideStr.includes("short");
          return (
            <tr
              key={i}
              onClick={() => openDetail(f)}
              className="cursor-pointer border-t border-ember-border/40 font-mono transition-colors hover:bg-surface-l2/40"
            >
              <Td>{timeAgoIso(f.timestamp)}</Td>
              <Td>{String(f.symbol ?? "")}-PERP</Td>
              <Td colored={long ? "green" : short ? "red" : undefined}>
                {long ? "LONG" : short ? "SHORT" : "—"}
              </Td>
              <Td right>{sdkNum(f.positionSize).toFixed(4)}</Td>
              <Td right>{(sdkNum(f.fundingRatePercentage ?? f.fundingRate) * 100).toFixed(4)}%</Td>
              <Td right colored={received ? "green" : payment > 0 ? "red" : undefined}>
                {payment === 0
                  ? "—"
                  : received
                    ? `+${formatUsdPrecise(Math.abs(payment))}`
                    : `-${formatUsdPrecise(payment)}`}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

/* ─── Collateral ─── */

function CollateralTable({ authority }: { authority: string }) {
  const { data, loading } = useFetch<any[]>(
    () => api.getTraderCollateralHistory(authority, 200).then((r: any) => r?.data ?? []),
    [authority]
  );
  const openDetail = useProfileDetailStore((s) => s.openCollateral);
  const rows = (data ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return (
    <TableFrame loading={loading} empty={!loading && rows.length === 0} emptyMsg="No collateral movements.">
      <thead>
        <tr className="text-text-secondary/50">
          <Th>Time</Th>
          <Th>Event</Th>
          <Th>Subaccount</Th>
          <Th right>Amount</Th>
          <Th right>Balance after</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e: any, i: number) => {
          // Backend returns raw lamport-style integers for amount/collateralAfter.
          // USDC has 6 decimals on Solana; divide by 1e6 for display.
          const raw = typeof e.amount === "number" ? e.amount : sdkNum(e.amount);
          const amount = raw / 1_000_000;
          const after = (typeof e.collateralAfter === "number" ? e.collateralAfter : sdkNum(e.collateralAfter)) / 1_000_000;
          const type = String(e.eventType ?? "").toLowerCase();
          const positive = type === "deposit" || (type === "transfer" && amount > 0);
          const tone =
            type === "deposit" ? "green" :
            type === "withdraw" ? "red" :
            undefined;
          return (
            <tr
              key={i}
              onClick={() => openDetail(e)}
              className="cursor-pointer border-t border-ember-border/40 font-mono transition-colors hover:bg-surface-l2/40"
            >
              <Td>{timeAgoIso(e.timestamp)}</Td>
              <Td>
                <span
                  className={clsx(
                    "px-1 py-0.5 text-[9px] uppercase tracking-wider",
                    type === "deposit"
                      ? "bg-ember-green/15 text-ember-green"
                      : type === "withdraw"
                        ? "bg-ember-red/15 text-ember-red"
                        : "bg-surface-l2 text-text-secondary/70"
                  )}
                >
                  {type}
                </span>
              </Td>
              <Td>
                {e.traderSubaccountIndex === 0
                  ? "cross"
                  : `iso #${e.traderSubaccountIndex}`}
              </Td>
              <Td right colored={tone as any}>
                {positive ? "+" : ""}{formatUsd(amount)}
              </Td>
              <Td right>{formatUsd(after)}</Td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

/* ─── Shared table primitives ─── */

function TableFrame({
  loading,
  empty,
  emptyMsg,
  children,
}: {
  loading: boolean;
  empty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="py-8 text-center font-mono text-[10px] text-text-secondary/40">
        Loading…
      </div>
    );
  }
  if (empty) {
    return (
      <div className="py-8 text-center font-mono text-[10px] text-text-secondary/40">
        {emptyMsg}
      </div>
    );
  }
  return (
    <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
      <table className="w-full text-[10px]">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={clsx(
        "bg-surface-l1 px-4 py-1.5 font-mono font-normal uppercase tracking-wider",
        right ? "text-right" : "text-left"
      )}
      style={{ position: "sticky", top: 0 }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  colored,
}: {
  children: React.ReactNode;
  right?: boolean;
  colored?: "green" | "red";
}) {
  return (
    <td
      className={clsx(
        "px-4 py-1.5",
        right ? "text-right tabular-nums" : "",
        colored === "green" && "text-ember-green",
        colored === "red" && "text-ember-red",
        !colored && "text-text-secondary/80"
      )}
    >
      {children}
    </td>
  );
}

function timeAgoIso(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime() / 1000;
  if (!Number.isFinite(t)) return "—";
  return timeAgo(t);
}

function timeAgo(seconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = Math.floor(diff / 86400);
  if (d < 14) return `${d}d ago`;
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
