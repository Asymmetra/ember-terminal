"use client";

import { useMemo } from "react";
import { useFlightEcosystem } from "@/lib/flightEcosystem";
import { shortAddr, accountUrl } from "@/lib/explorer";
import clsx from "clsx";

interface Props {
  /** The viewing wallet's fee (bps), to highlight it against the field. */
  yourFeeBps?: number | null;
  /** The viewing wallet authority, to mark "you" in the directory. */
  yourAuthority?: string;
}

/**
 * Flight ecosystem view — every registered builder code on Phoenix, read from
 * chain (getProgramAccounts on the Flight program). Shows adoption + fee
 * distribution + how your fee compares to the field. Per-builder VOLUME / fees
 * earned are NOT on-chain (the builder-state account has no cumulative
 * counters), so those would need a fills indexer — called out below.
 */
export function BuilderEcosystem({ yourFeeBps, yourAuthority }: Props) {
  const { data, loading, error } = useFlightEcosystem();

  const cheaperPct = useMemo(() => {
    if (!data || yourFeeBps == null || data.count === 0) return null;
    const cheaper = data.builders.filter((b) => b.feeBps < yourFeeBps).length;
    return Math.round((cheaper / data.count) * 100);
  }, [data, yourFeeBps]);

  const maxBar = useMemo(() => (data ? Math.max(1, ...data.distribution.map((d) => d.count)) : 1), [data]);

  // Most common fee (mode) — shown in the 4th tile when no wallet is connected,
  // so the ecosystem stays useful without a "your fee" prompt.
  const modeFee = useMemo(() => {
    if (!data || data.distribution.length === 0) return null;
    return data.distribution.reduce((a, b) => (b.count > a.count ? b : a)).bps;
  }, [data]);

  return (
    <div className="border border-ember-border bg-surface-l1">
      <div className="flex items-center justify-between border-b border-ember-border/60 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">Flight ecosystem</span>
        <span className="font-mono text-[9px] text-text-secondary/35">on-chain · all builders</span>
      </div>

      {loading ? (
        <div className="py-8 text-center font-mono text-[10px] text-text-secondary/40 animate-pulse">Scanning Flight program…</div>
      ) : error || !data ? (
        <div className="py-8 text-center font-mono text-[10px] text-text-secondary/40">Couldn&apos;t load ecosystem data.</div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-px bg-ember-border/40 sm:grid-cols-4">
            <Tile label="Builders" value={data.count.toString()} sub="registered codes" />
            <Tile label="Median fee" value={`${data.feeMedian} bps`} sub={`${(data.feeMedian / 100).toFixed(2)}%`} />
            <Tile label="Fee range" value={`${data.feeMin}–${data.feeMax}`} sub="bps" />
            {yourAuthority ? (
              <Tile
                label="Your fee"
                value={yourFeeBps != null ? `${yourFeeBps} bps` : "—"}
                sub={cheaperPct != null ? `${cheaperPct}% charge less` : "not registered"}
                tone={yourFeeBps != null ? "orange" : undefined}
              />
            ) : (
              <Tile
                label="Most common"
                value={modeFee != null ? `${modeFee} bps` : "—"}
                sub="across builders"
              />
            )}
          </div>

          {/* Fee distribution */}
          <div className="px-4 py-3">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">Fee distribution (builders per rate)</div>
            <div className="flex items-end gap-1.5" style={{ height: 80 }}>
              {data.distribution.map((d) => {
                const mine = yourFeeBps != null && d.bps === yourFeeBps;
                return (
                  <div key={d.bps} className="group relative flex flex-1 flex-col items-center justify-end">
                    <span className="mb-0.5 font-mono text-[8px] text-text-secondary/50">{d.count}</span>
                    <div
                      className={clsx("w-full", mine ? "bg-ember-orange/70" : "bg-text-secondary/25")}
                      style={{ height: `${(d.count / maxBar) * 60}px` }}
                      title={`${d.count} builder${d.count === 1 ? "" : "s"} at ${d.bps} bps`}
                    />
                    <span className={clsx("mt-1 font-mono text-[8px]", mine ? "text-ember-orange" : "text-text-secondary/40")}>{d.bps}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Directory */}
          <div className="max-h-[260px] overflow-y-auto border-t border-ember-border/40">
            <table className="w-full font-mono text-[10px]">
              <thead className="sticky top-0 bg-surface-l1">
                <tr className="border-b border-ember-border/40 text-[9px] uppercase tracking-wider text-text-secondary/40">
                  <th className="px-4 py-1.5 text-left font-normal">Builder</th>
                  <th className="px-4 py-1.5 text-right font-normal">Fee</th>
                  <th className="px-4 py-1.5 text-right font-normal">Fee account</th>
                </tr>
              </thead>
              <tbody>
                {data.builders.map((b) => {
                  const mine = yourAuthority && b.authority === yourAuthority;
                  return (
                    <tr key={b.authority} className={clsx("border-b border-ember-border/20", mine && "bg-ember-orange/10")}>
                      <td className="px-4 py-1.5">
                        <a href={accountUrl(b.authority)} target="_blank" rel="noopener noreferrer" className="text-text-secondary/80 hover:text-ember-orange">
                          {shortAddr(b.authority, 6, 6)}
                        </a>
                        {mine && <span className="ml-2 text-ember-orange">you</span>}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-text-primary">{b.feeBps} bps</td>
                      <td className="px-4 py-1.5 text-right">
                        <a href={accountUrl(b.traderAccount)} target="_blank" rel="noopener noreferrer" className="text-text-secondary/50 hover:text-ember-orange">
                          {shortAddr(b.traderAccount, 4, 4)} ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-ember-border/40 px-4 py-2 font-mono text-[9px] leading-relaxed text-text-secondary/40">
            Fee rates + adoption are read live from the Flight program. Per-builder volume and fees
            earned aren&apos;t recorded on-chain (no cumulative counters) — surfacing those would need
            a fills indexer that attributes Flight-routed volume per builder.
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "orange" }) {
  return (
    <div className="flex flex-col gap-1 bg-surface-l1 px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">{label}</span>
      <span className={clsx("font-mono text-base font-semibold tabular-nums", tone === "orange" ? "text-ember-orange" : "text-text-primary")}>{value}</span>
      {sub && <span className="font-mono text-[10px] text-text-secondary/50">{sub}</span>}
    </div>
  );
}
