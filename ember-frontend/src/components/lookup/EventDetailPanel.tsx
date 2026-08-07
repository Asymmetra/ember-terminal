"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { accountUrl, shortAddr, slotUrl, txUrl } from "@/lib/explorer";
import { rawMicroToUsd, toNum } from "@/lib/normalize";
import type { UnifiedEvent } from "./ActivityTimeline";
import { RelativeTime } from "./RelativeTime";
import clsx from "clsx";

interface Props {
  event: UnifiedEvent | null;
  wallet: string;
  onClose: () => void;
}

/**
 * Slide-out right panel showing the full normalized event detail for
 * whichever row is selected in the activity timeline. Mirrors the
 * /stats SourceDetailTray pattern so the page feels consistent.
 */
export function EventDetailPanel({ event, wallet, onClose }: Props) {
  useEffect(() => {
    if (!event) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [event, onClose]);

  return (
    <AnimatePresence>
      {event && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/40"
          />
          <motion.div
            key={event.id}
            initial={{ x: 560 }} animate={{ x: 0 }} exit={{ x: 560 }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed right-0 top-0 bottom-0 z-[91] w-[560px] overflow-y-auto border-l border-ember-border bg-surface-l1"
          >
            <Header event={event} onClose={onClose} />
            <Body event={event} wallet={wallet} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Header({ event, onClose }: { event: UnifiedEvent; onClose: () => void }) {
  return (
    <div className="border-b border-ember-border/70 px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ember-orange">{event.kind} event</span>
          <h2 className="flex items-center gap-1 font-mono text-sm uppercase tracking-wider text-text-primary">
            {event.marketSymbol ? `${event.marketSymbol} · ` : ""}
            <RelativeTime timestampMs={event.timestamp} className="normal-case" />
          </h2>
          <span className="font-mono text-[10px] text-text-secondary/50">
            slot {event.slot} · subaccount {event.subaccountIndex === 0 ? "0 (cross)" : event.subaccountIndex}
          </span>
        </div>
        <button onClick={onClose} className="text-text-secondary/60 hover:text-text-primary transition-colors" aria-label="Close">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </div>
  );
}

function Body({ event, wallet }: { event: UnifiedEvent; wallet: string }) {
  return (
    <div className="flex flex-col gap-4 p-5">
      <ExplorerLinks event={event} wallet={wallet} />
      <SummaryBlock event={event} />
      <RawJsonBlock label="Raw event payload" value={event.detail} />
    </div>
  );
}

function ExplorerLinks({ event, wallet }: { event: UnifiedEvent; wallet: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {event.signature ? (
        <a href={txUrl(event.signature)} target="_blank" rel="noopener noreferrer" className="border border-ember-orange/40 bg-ember-orange/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ember-orange hover:bg-ember-orange/20 transition-colors">
          tx {shortAddr(event.signature, 6, 6)} on Solscan ↗
        </a>
      ) : (
        <a href={slotUrl(event.slot)} target="_blank" rel="noopener noreferrer" className="border border-ember-border bg-surface-l2/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors">
          slot {event.slot} on Solscan ↗
        </a>
      )}
      <a href={accountUrl(wallet)} target="_blank" rel="noopener noreferrer" className="border border-ember-border bg-surface-l2/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary/70 hover:bg-surface-l2 hover:text-text-primary transition-colors">
        wallet on Solscan ↗
      </a>
    </div>
  );
}

/**
 * Per-kind structured summary above the raw payload — surfaces the
 * fields most likely to matter for debugging a particular event.
 * Fields the kind doesn't have are just omitted.
 */
function SummaryBlock({ event }: { event: UnifiedEvent }) {
  const d = event.detail;
  const rows: Array<[string, string]> = [];

  const push = (k: string, v: unknown) => {
    if (v == null || v === "" || (typeof v === "number" && !Number.isFinite(v))) return;
    rows.push([k, typeof v === "number" ? v.toString() : String(v)]);
  };

  if (event.kind === "fill") {
    push("market", d.marketSymbol);
    push("trade type", d.tradeType);
    push("liquidity", d.liquidity);
    push("instruction", d.instructionType);
    push("price", formatNumber(d.price));
    push("base lots delta", d.baseLotsDelta);
    push("realized PnL", formatUsdSigned(d.realizedPnl));
    push("fees", formatUsdSigned(d.fees));
    push("order seq", d.orderSequenceNumber);
    push("fill id", d.fillId);
  } else if (event.kind === "deposit" || event.kind === "withdraw" || event.kind === "transfer" || event.kind === "collateral") {
    push("event type", d.eventType);
    push("amount (USDC)", `$${rawMicroToUsd(d.amount).toFixed(2)}`);
    push("collateral after (USDC)", `$${rawMicroToUsd(d.collateralAfter).toFixed(2)}`);
  } else if (event.kind === "funding") {
    push("symbol", d.symbol ?? d.marketSymbol);
    push("position side", d.positionSide);
    push("position size", d.positionSize);
    push("funding rate %", d.fundingRatePercentage);
    push("funding payment", formatUsdSigned(d.fundingPayment ?? d.amount ?? d.funding));
  }

  if (rows.length === 0) return null;

  return (
    <div className="border border-ember-border bg-surface-l2/40">
      <div className="border-b border-ember-border/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
        Summary
      </div>
      <table className="w-full font-mono text-[10px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-ember-border/20 first:border-t-0">
              <td className="w-1/3 px-3 py-1 text-text-secondary/50">{k}</td>
              <td className={clsx("px-3 py-1 tabular-nums text-text-primary/90 break-all")}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawJsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="border border-ember-border bg-surface-l2/40">
      <div className="border-b border-ember-border/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
        {label}
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[10px] leading-relaxed text-text-primary/85 whitespace-pre">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function formatNumber(n: unknown): string {
  const v = toNum(n);
  return v === 0 && n == null ? "" : v.toString();
}
function formatUsdSigned(n: unknown): string {
  const v = toNum(n);
  if (v === 0 && n == null) return "";
  return `${v >= 0 ? "+" : ""}$${Math.abs(v).toFixed(Math.abs(v) >= 1 ? 2 : 4)}`;
}
