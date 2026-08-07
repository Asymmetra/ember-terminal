"use client";

/**
 * Unified activity timeline for /lookup.
 *
 * Merges three Phoenix data streams into one chronological feed:
 *   1. Fills    — /api/trader/{pk}/trades              (has tx signature)
 *   2. Collateral movements — /api/trader/{pk}/collateral-history  (slot-only)
 *   3. Funding payments — /api/trader/{pk}/funding     (slot-only typically)
 *
 * Each row is clickable; the row's onClick raises a UnifiedEvent to
 * the page so the right-side detail panel can render the full
 * breakdown. Every row also has a direct explorer link — to the tx
 * for fills (we have the signature), to the slot or wallet account
 * for the others.
 */

import { useEffect, useMemo, useState } from "react";
import { api, isTraderNotFoundError } from "@/lib/api";
import { shortAddr, slotUrl, txUrl } from "@/lib/explorer";
import { rawMicroToUsd, toNum } from "@/lib/normalize";
import { RelativeTime } from "./RelativeTime";
import clsx from "clsx";

export type EventKind = "fill" | "deposit" | "withdraw" | "transfer" | "funding" | "collateral";

export interface UnifiedEvent {
  id: string;
  kind: EventKind;
  timestamp: number;    // unix ms (frontend will normalize)
  slot: number;
  signature: string | null;
  marketSymbol: string | null;
  subaccountIndex: number;
  /** Per-kind detail blob for the detail panel. */
  detail: Record<string, unknown>;
}

interface Props {
  wallet: string;
  /** Bumped whenever the parent wants a forced reload (e.g. after refresh button). */
  refreshKey?: number;
  onSelectEvent?: (e: UnifiedEvent) => void;
  selectedEventId?: string | null;
  /** When set, only events on this subaccount index are shown. */
  filterSub?: number | null;
  /** Clears the active subaccount filter (chip ✕). */
  onClearFilterSub?: () => void;
}

const PAGE = 50;
type Tab = "all" | "fills" | "collateral" | "funding";

export function ActivityTimeline({ wallet, refreshKey, onSelectEvent, selectedEventId, filterSub, onClearFilterSub }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Wallet has no Phoenix activity at all (no fills AND no collateral/funding).
  // Not an error — render a clean explainer instead of raw SDK text.
  const [noAccount, setNoAccount] = useState(false);
  // Wallet HAS Phoenix activity (collateral/funding) but Phoenix's
  // trade-history API has no fills indexed for it (returns 404 "Trader not
  // found"). Distinct from a wallet that never traded — don't conflate them.
  const [fillsUnavailable, setFillsUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null); setEvents([]); setNoAccount(false); setFillsUnavailable(false);
    Promise.allSettled([
      api.getTraderTrades(wallet,    { limit: PAGE }),
      api.getTraderCollateralHistory(wallet, PAGE),
      api.getTraderFunding(wallet,   { limit: PAGE }),
    ]).then((results) => {
      if (cancelled) return;
      const [tradesRes, collRes, fundingRes] = results;
      const out: UnifiedEvent[] = [];
      let tradesNotFound = false;
      if (tradesRes.status === "fulfilled") {
        for (const t of (tradesRes.value as { trades?: Record<string, unknown>[] }).trades ?? []) {
          out.push(eventFromTrade(t));
        }
      } else if (tradesRes.reason) {
        // 404 / "Trader not found" on the trades endpoint only means Phoenix
        // has no *fills* indexed for this wallet — NOT that it never touched
        // Phoenix. Collateral/funding may still be present. Defer the verdict
        // until all three streams have resolved.
        if (isTraderNotFoundError(tradesRes.reason)) {
          tradesNotFound = true;
        } else {
          setErr((prev) => prev ?? `trades: ${String(tradesRes.reason)}`);
        }
      }
      if (collRes.status === "fulfilled") {
        for (const c of (collRes.value as { data?: Record<string, unknown>[] }).data ?? []) {
          out.push(eventFromCollateral(c));
        }
      }
      if (fundingRes.status === "fulfilled") {
        // Funding shape: { authority, funding: { events: [...] } } — NOT a
        // flat array. Empirical: against EqcK...P5 the events array is
        // populated; the outer "funding" wrap is consistent across wallets.
        const fundingResponse = fundingRes.value as { funding?: { events?: Record<string, unknown>[] } | Record<string, unknown>[] };
        const fundingEvents = Array.isArray(fundingResponse.funding)
          ? fundingResponse.funding
          : (fundingResponse.funding as { events?: Record<string, unknown>[] })?.events ?? [];
        for (const f of fundingEvents) {
          out.push(eventFromFunding(f));
        }
      }
      out.sort((a, b) => b.timestamp - a.timestamp);
      setEvents(out);
      // Resolve the empty-state verdict only now that all three streams are in:
      //   • truly virgin wallet  → trades 404'd AND nothing else came back
      //   • fills-unavailable     → trades 404'd but collateral/funding exist
      // Anything else falls through to the per-tab "No {tab}" message.
      setNoAccount(tradesNotFound && out.length === 0);
      setFillsUnavailable(tradesNotFound && out.length > 0);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [wallet, refreshKey]);

  const filtered = useMemo(() => {
    let out = events;
    if (tab === "fills")          out = out.filter((e) => e.kind === "fill");
    else if (tab === "funding")   out = out.filter((e) => e.kind === "funding");
    else if (tab === "collateral") out = out.filter((e) => e.kind === "deposit" || e.kind === "withdraw" || e.kind === "transfer" || e.kind === "collateral");
    if (filterSub != null) out = out.filter((e) => e.subaccountIndex === filterSub);
    return out;
  }, [events, tab, filterSub]);

  // Map of slot → isolated subaccount index for slots that contain an
  // isolated fill. Lets us caption the cross→iso TRANSFER rows that
  // accompany every isolated order ("for iso #N") so the feed reads
  // cleanly instead of looking like stray withdrawals.
  const isoFillSlots = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of events) {
      if (e.kind === "fill" && e.subaccountIndex > 0) m.set(e.slot, e.subaccountIndex);
    }
    return m;
  }, [events]);

  // 24h notional volume + lifetime fees from the loaded fills. Cheap to
  // derive here since we already have the trades in memory.
  const summary = useMemo(() => {
    const dayAgo = Date.now() - 86_400_000;
    let vol24h = 0;
    let totalFees = 0;
    for (const e of events) {
      if (e.kind !== "fill") continue;
      totalFees += toNum(e.detail.fees);
      if (e.timestamp >= dayAgo) {
        vol24h += Math.abs(toNum(e.detail.baseLotsDelta)) * toNum(e.detail.price);
      }
    }
    return { vol24h, totalFees };
  }, [events]);

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex flex-wrap items-center gap-3 border-b border-ember-border/60 px-4 py-2">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
          Activity
          <IsoTransferHelp />
        </span>
        <TabBar tab={tab} setTab={setTab} counts={countByTab(events)} />
        {filterSub != null && (
          <button
            onClick={onClearFilterSub}
            className="inline-flex items-center gap-1 border border-ember-orange/50 bg-ember-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ember-orange hover:bg-ember-orange/20 transition-colors"
            title="Clear subaccount filter"
          >
            only {filterSub === 0 ? "cross" : `iso·${filterSub}`} <span className="text-ember-orange/70">✕</span>
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {(summary.vol24h > 0 || summary.totalFees > 0) && (
            <span className="font-mono text-[10px] tabular-nums text-text-secondary/50">
              24h vol <span className="text-text-primary/80">${fmtUsd(summary.vol24h)}</span>
              <span className="mx-1 text-text-secondary/25">·</span>
              fees <span className="text-text-primary/80">${fmtUsd(summary.totalFees)}</span>
            </span>
          )}
          {loading && <span className="font-mono text-[10px] text-text-secondary/40">loading…</span>}
          {err && <span className="font-mono text-[10px] text-ember-red/80">{err}</span>}
        </div>
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="px-4 py-6 font-mono text-[11px] text-text-secondary/50">
          {noAccount ? (
            <span>
              This wallet has never traded on Phoenix — no fills, deposits,
              transfers, or funding to show.
            </span>
          ) : fillsUnavailable && (tab === "all" || tab === "fills") ? (
            <span>
              Phoenix&rsquo;s trade-history API has no fills indexed for this
              wallet (it returned &ldquo;Trader not found&rdquo;), even though it has
              other activity. Deposits / withdraws and funding are shown in
              their tabs.
            </span>
          ) : (
            <span>No {tab === "all" ? "activity" : tab} for this wallet.</span>
          )}
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full font-mono text-[11px]" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "120px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "70px" }} />
              <col />
              <col style={{ width: "110px" }} />
              <col style={{ width: "100px" }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-l1">
              <tr className="border-b border-ember-border/40 text-[9px] uppercase tracking-wider text-text-secondary/40">
                <Th>Time</Th>
                <Th>Action</Th>
                <Th>Acct</Th>
                <Th>Detail</Th>
                <Th align="right">Outcome</Th>
                <Th align="right">Tx</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <EventRow
                  key={e.id}
                  e={e}
                  wallet={wallet}
                  selected={selectedEventId === e.id}
                  onClick={() => onSelectEvent?.(e)}
                  forIso={e.kind === "transfer" ? isoFillSlots.get(e.slot) ?? null : null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabBar({ tab, setTab, counts }: { tab: Tab; setTab: (t: Tab) => void; counts: Record<Tab, number> }) {
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "all",        label: "All" },
    { key: "fills",      label: "Fills" },
    { key: "collateral", label: "Deposits / Withdraws" },
    { key: "funding",    label: "Funding" },
  ];
  return (
    <div className="inline-flex border border-ember-border">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={clsx(
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
            tab === t.key
              ? "bg-ember-orange/15 text-ember-orange"
              : "text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary",
          )}
        >
          {t.label} <span className="ml-1 text-text-secondary/40">{counts[t.key]}</span>
        </button>
      ))}
    </div>
  );
}

function EventRow({ e, wallet, selected, onClick, forIso }: { e: UnifiedEvent; wallet: string; selected: boolean; onClick: () => void; forIso?: number | null }) {
  const meta = renderEvent(e);
  return (
    <tr
      onClick={onClick}
      className={clsx(
        "cursor-pointer border-b border-ember-border/20 transition-colors",
        selected ? "bg-ember-orange/10" : "hover:bg-surface-l2/40",
        forIso != null && !selected && "opacity-60",
      )}
    >
      <td className="px-3 py-1.5 font-mono text-[10px] tabular-nums text-text-secondary/70">
        <RelativeTime timestampMs={e.timestamp} />
      </td>
      <td className={clsx("px-3 py-1.5 text-[10px] uppercase tracking-wider", meta.actionColor)}>
        {meta.action}
      </td>
      <td className="px-3 py-1.5 text-[10px] tabular-nums text-text-secondary/60">
        {e.subaccountIndex === 0 ? "cross" : `iso·${e.subaccountIndex}`}
      </td>
      <td className="px-3 py-1.5 text-[10px] text-text-primary/85 truncate" title={meta.detailFull}>
        {meta.detail}
        {forIso != null && (
          <span className="ml-2 text-text-secondary/45">for iso·{forIso}</span>
        )}
      </td>
      <td className={clsx("px-3 py-1.5 text-right text-[10px] tabular-nums", meta.outcomeColor)}>
        {meta.outcome}
      </td>
      <td className="px-3 py-1.5 text-right text-[10px]">
        {e.signature ? (
          <a
            href={txUrl(e.signature)} target="_blank" rel="noopener noreferrer"
            onClick={(ev) => ev.stopPropagation()}
            className="text-text-secondary/60 hover:text-ember-orange transition-colors"
            title={e.signature}
          >
            {shortAddr(e.signature, 4, 4)} ↗
          </a>
        ) : (
          <a
            href={slotUrl(e.slot)} target="_blank" rel="noopener noreferrer"
            onClick={(ev) => ev.stopPropagation()}
            className="text-text-secondary/40 hover:text-ember-orange/70 transition-colors"
            title={`slot ${e.slot} · wallet ${shortAddr(wallet, 4, 4)}`}
          >
            slot {e.slot} ↗
          </a>
        )}
      </td>
    </tr>
  );
}

// ────────────────────── Event normalization ──────────────────────

function eventFromTrade(t: Record<string, unknown>): UnifiedEvent {
  const ts = parseTs(t.timestamp);
  const slot = toNum(t.slot);
  const sig = (t.signature as string) ?? null;
  const sub = toNum(t.subaccountIndex);
  const market = (t.marketSymbol as string) ?? null;
  return {
    id: `fill:${sig ?? `${slot}:${t.eventIndex ?? 0}`}`,
    kind: "fill",
    timestamp: ts,
    slot,
    signature: sig,
    marketSymbol: market,
    subaccountIndex: sub,
    detail: t,
  };
}

function eventFromCollateral(c: Record<string, unknown>): UnifiedEvent {
  const ts = parseTs(c.timestamp);
  const slot = toNum(c.slot);
  const sub = toNum(c.traderSubaccountIndex);
  const eventType = String(c.eventType ?? "").toLowerCase();
  let kind: EventKind = "collateral";
  if (eventType.includes("deposit"))       kind = "deposit";
  else if (eventType.includes("withdraw")) kind = "withdraw";
  else if (eventType.includes("transfer")) kind = "transfer";
  return {
    id: `${kind}:${slot}:${c.eventIndex ?? 0}:${sub}`,
    kind,
    timestamp: ts,
    slot,
    signature: null,
    marketSymbol: null,
    subaccountIndex: sub,
    detail: c,
  };
}

function eventFromFunding(f: Record<string, unknown>): UnifiedEvent {
  const ts = parseTs(f.timestamp);
  const slot = toNum(f.slot);
  const sub = toNum(f.traderSubaccountIndex ?? f.subaccountIndex);
  return {
    id: `funding:${slot}:${f.eventIndex ?? 0}:${sub}:${ts}:${String(f.symbol ?? "")}`,
    kind: "funding",
    timestamp: ts,
    slot,
    signature: (f.signature as string) ?? null,
    marketSymbol: (f.marketSymbol as string) ?? (f.symbol as string) ?? null,
    subaccountIndex: sub,
    detail: f,
  };
}

// ────────────────────── Row presentation ──────────────────────

function renderEvent(e: UnifiedEvent): {
  action: string;
  actionColor: string;
  detail: string;
  detailFull: string;
  outcome: string;
  outcomeColor: string;
} {
  const d = e.detail;
  if (e.kind === "fill") {
    const symbol = String(d.marketSymbol ?? "?");
    const delta = toNum(d.baseLotsDelta);
    const side = delta < 0 ? "SELL" : "BUY";
    const sideColor = delta < 0 ? "text-ember-red" : "text-ember-green";
    const tradeType = String(d.tradeType ?? "").toLowerCase();
    const opensClose = tradeType.includes("open") ? "OPEN" : tradeType.includes("close") ? "CLOSE" : tradeType.includes("liq") ? "LIQ" : "";
    const liq = String(d.liquidity ?? "").toLowerCase();
    const size = Math.abs(delta);
    const price = toNum(d.price);
    const fee = toNum(d.fees);
    const realized = toNum(d.realizedPnl);
    const detail = `${symbol} ${size} @ $${price.toFixed(price >= 1 ? 2 : 4)}${liq ? ` · ${liq}` : ""}`;
    const outcomeParts: string[] = [];
    if (realized !== 0) outcomeParts.push(`${realized >= 0 ? "+" : ""}$${realized.toFixed(2)}`);
    if (fee > 0)        outcomeParts.push(`fee $${fee.toFixed(2)}`);
    return {
      action: `${opensClose ? opensClose + " " : ""}${side}`.trim(),
      actionColor: sideColor,
      detail,
      detailFull: detail,
      outcome: outcomeParts.join(" · "),
      outcomeColor: realized >= 0 ? "text-ember-green" : "text-ember-red",
    };
  }
  if (e.kind === "deposit" || e.kind === "withdraw" || e.kind === "transfer" || e.kind === "collateral") {
    // collateral-history.amount is raw micro-USDC (6 decimals) per
    // the API contract. Same for collateralAfter.
    const amount = rawMicroToUsd(d.amount);
    const after = rawMicroToUsd(d.collateralAfter);
    const sign = e.kind === "deposit" ? "+" : e.kind === "withdraw" ? "-" : (amount >= 0 ? "+" : "-");
    const outcomeColor = e.kind === "deposit" || amount >= 0 ? "text-ember-green" : "text-ember-red";
    const detail = `${sign}$${Math.abs(amount).toFixed(2)} USDC`;
    return {
      action: e.kind.toUpperCase(),
      actionColor: "text-text-primary",
      detail,
      detailFull: detail,
      outcome: `bal $${after.toFixed(2)}`,
      outcomeColor,
    };
  }
  if (e.kind === "funding") {
    // Funding payload uses fundingPayment as the dollar amount per epoch.
    const amount = toNum(d.fundingPayment ?? d.amount ?? d.funding);
    const sign = amount >= 0 ? "+" : "-";
    const symbol = String(d.symbol ?? d.marketSymbol ?? "?");
    const positionSide = String(d.positionSide ?? "");
    return {
      action: "FUNDING",
      actionColor: "text-text-secondary/70",
      detail: `${symbol}${positionSide ? ` ${positionSide.toLowerCase()}` : ""} · ${sign}$${Math.abs(amount).toFixed(4)}`,
      detailFull: `${symbol} ${positionSide} funding payment ${sign}$${Math.abs(amount).toFixed(4)}`,
      outcome: "",
      outcomeColor: amount >= 0 ? "text-ember-green" : "text-ember-red",
    };
  }
  return { action: e.kind, actionColor: "text-text-secondary", detail: "", detailFull: "", outcome: "", outcomeColor: "" };
}

function countByTab(events: UnifiedEvent[]): Record<Tab, number> {
  return {
    all:        events.length,
    fills:      events.filter((e) => e.kind === "fill").length,
    collateral: events.filter((e) => e.kind === "deposit" || e.kind === "withdraw" || e.kind === "transfer" || e.kind === "collateral").length,
    funding:    events.filter((e) => e.kind === "funding").length,
  };
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={clsx("px-3 py-1 font-normal", align === "right" ? "text-right" : "text-left")}>{children}</th>;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.abs(n) >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toFixed(2);
}

/**
 * Small "?" pill explaining why isolated orders show an accompanying
 * TRANSFER row. Instant CSS popover, same pattern as RelativeTime.
 */
function IsoTransferHelp() {
  return (
    <span className="group relative inline-flex">
      <span className="flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-text-secondary/30 text-[8px] leading-none text-text-secondary/50">
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none hidden absolute left-0 top-full z-50 mt-1 w-[280px] rounded border border-ember-border bg-surface-l3/95 px-2 py-1.5 font-mono text-[10px] normal-case leading-snug tracking-normal text-text-secondary shadow-xl backdrop-blur-sm group-hover:block"
      >
        Isolated orders need collateral physically moved from the cross
        account to the target subaccount before each trade, so every
        isolated fill is paired with a TRANSFER row in the same on-chain
        transaction.
      </span>
    </span>
  );
}

function parseTs(raw: unknown): number {
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;  // sec → ms
  if (typeof raw === "string") {
    const n = Date.parse(raw);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}
