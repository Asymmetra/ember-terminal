"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { api, type LeaderboardEntry, type LeaderboardStats } from "@/lib/api";
import { OpenPositions } from "@/components/profile/OpenPositions";
import { useSnsNames, cachedSnsName, resolveSolDomain } from "@/lib/sns";
import { requestEnrich, getEnrich, useEnrichVersion } from "@/lib/leaderboardEnrich";
import { shortAddr, accountUrl } from "@/lib/explorer";
import { formatUsd, compactUsd } from "@/lib/format";
import clsx from "clsx";

// First page is larger (the leaders people care about); subsequent pages load
// 50 at a time as the user scrolls, all the way through the active set.
const INITIAL_PAGE = 100;
const STEP = 50;

type SortKey =
  | "rank"
  | "accountValueUsd"
  | "equityUsd"
  | "unrealizedPnlUsd"
  | "openPositions"
  | "volumeUsd"
  | "subaccounts";

/**
 * Community leaderboard — every active Phoenix trader, ranked by account value,
 * read from a server-side on-chain scan (/api/leaderboard). The default view
 * pages through the active set (infinite scroll); the search box reaches the
 * full ~16k universe (incl. dormant accounts) by address or .sol handle.
 * Clicking a row expands full per-trader detail in place. Leaders (top N) carry
 * enriched equity / uPnL / position columns; everyone else shows account value.
 */
export function LeaderboardPanel() {
  const { connection } = useConnection();

  const [stats, setStats] = useState<LeaderboardStats | null>(null);
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const [search, setSearch] = useState("");
  const [searchRows, setSearchRows] = useState<LeaderboardEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadPage = useCallback(async (off: number, limit: number) => {
    const res = await api.getLeaderboard({ limit, offset: off });
    setStats(res.stats);
    setStale(res.stale);
    setError(res.error ?? null);
    setRows((prev) => (off === 0 ? res.traders : [...prev, ...res.traders]));
    // More remain whenever we got a full page AND haven't reached the active total.
    setHasMore(res.traders.length === limit && off + res.traders.length < res.total);
    setOffset(off + res.traders.length);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadPage(0, INITIAL_PAGE);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load leaderboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || searchRows) return;
    setLoadingMore(true);
    try {
      await loadPage(offset, STEP);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, searchRows, offset, loadPage]);

  // Infinite-scroll sentinel.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // Search across the full universe (debounced). `.sol` handles resolve to the
  // owner address first, then we search by that address.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchRows(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        let query = q;
        if (/\.sol$/i.test(q)) {
          const owner = await resolveSolDomain(connection, q);
          if (owner) query = owner;
        }
        const res = await api.getLeaderboard({ q: query });
        if (!cancelled) setSearchRows(res.traders);
      } catch {
        if (!cancelled) setSearchRows([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, connection]);

  const displayRows = searchRows ?? rows;

  // Fold lazily-enriched stats (fetched per-row as they scroll into view) over
  // rows the backend didn't pre-enrich, so equity / uPnL / positions fill in
  // beyond the top leaders.
  const enrichVersion = useEnrichVersion();
  const mergedRows = useMemo(() => {
    return displayRows.map((r) => {
      if (r.equityUsd != null) return r;
      const e = getEnrich(r.authority);
      return e
        ? { ...r, equityUsd: e.equityUsd, unrealizedPnlUsd: e.unrealizedPnlUsd, openPositions: e.openPositions, volumeUsd: e.volumeUsd }
        : r;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows, enrichVersion]);

  // Batch-resolve .sol names for the rows currently shown.
  const authorities = useMemo(() => displayRows.map((r) => r.authority), [displayRows]);
  const snsVersion = useSnsNames(authorities);
  const names = useMemo(() => {
    const m: Record<string, string | null | undefined> = {};
    for (const a of authorities) m[a] = cachedSnsName(a);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorities, snsVersion]);

  // Client-side sort over the loaded rows. The board loads in rank order
  // (= account value desc), so sorting by value matches the global order;
  // enriched-only columns sort the leaders and push un-enriched rows to the end.
  const sorted = useMemo(() => {
    if (sortKey === "rank" && sortDir === "asc") return mergedRows;
    const dir = sortDir === "asc" ? 1 : -1;
    const fallback = sortDir === "asc" ? Infinity : -Infinity;
    return [...mergedRows].sort((a, b) => {
      const av = (a[sortKey] ?? fallback) as number;
      const bv = (b[sortKey] ?? fallback) as number;
      return (av - bv) * dir;
    });
  }, [mergedRows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "rank" || k === "subaccounts" ? "asc" : "desc");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <StatsHeader stats={stats} loading={loading} />

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search any wallet or .sol handle (incl. inactive)…"
          className="w-full max-w-md border border-ember-border bg-ember-black/60 px-2.5 py-1.5 font-mono text-[11px] text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-ember-orange/60"
        />
        {searching && <span className="font-mono text-[10px] text-text-secondary/40 animate-pulse">searching…</span>}
        {searchRows && !searching && (
          <span className="font-mono text-[10px] text-text-secondary/50">
            {searchRows.length} match{searchRows.length === 1 ? "" : "es"} (full universe)
          </span>
        )}
      </div>

      {error && displayRows.length === 0 && (
        <div className="border border-ember-red/40 bg-ember-red/10 px-3 py-2 font-mono text-[10px] text-ember-red">
          Leaderboard scan failed: {error}. The backend needs a getProgramAccounts-capable SOLANA_RPC_URL.
        </div>
      )}
      {error && displayRows.length > 0 && (
        <div className="px-1 font-mono text-[10px] text-text-secondary/40">
          Showing the last good scan — the latest on-chain refresh didn&apos;t complete.
        </div>
      )}
      {stale && !loading && !error && (
        <div className="border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 font-mono text-[10px] text-yellow-500/90">
          First on-chain scan still running — data will populate shortly.
        </div>
      )}

      {/* Table — scrolls horizontally on mobile (the 9 columns don't fit a
          phone); reverts to a normal block on ≥md so the sticky header works. */}
      <div className="overflow-x-auto border border-ember-border bg-surface-l1 md:overflow-visible">
        <table className="w-full min-w-[680px] font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-surface-l1">
            <tr className="border-b border-ember-border/60 text-[9px] uppercase tracking-wider text-text-secondary/50">
              <Th label="#" k="rank" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="left" title="Rank by account value across all active traders." />
              <th className="px-3 py-2 text-left font-normal" title="Wallet address, or its primary .sol handle if it has one.">Trader</th>
              <Th label="Account value" k="accountValueUsd" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="On-chain collateral (USDC) deposited across all of this wallet's subaccounts — the ranking metric." />
              <Th label="Equity" k="equityUsd" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Portfolio value = collateral + unrealized PnL of open positions, summed across subaccounts." />
              <Th label="uPnL" k="unrealizedPnlUsd" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Unrealized profit/loss on currently-open positions (not realized/lifetime PnL)." />
              <Th label="Volume" k="volumeUsd" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Estimated LIFETIME trading volume (rough) — backed out of cumulative taker fees ÷ a flat fee rate, so it's approximate and taker-side only." />
              <Th label="Pos" k="openPositions" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Number of positions currently open (live), not lifetime positions opened." />
              <Th label="Subs" k="subaccounts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Phoenix subaccounts this wallet owns (1 cross-margin + one per isolated position)." />
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-10 text-center text-text-secondary/40 animate-pulse">Scanning Phoenix trader universe…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={9} className="py-10 text-center text-text-secondary/40">{searchRows ? "No matching wallet." : "No active traders."}</td></tr>
            ) : (
              sorted.map((t) => (
                <Row
                  key={t.authority}
                  entry={t}
                  name={names[t.authority]}
                  expanded={expanded === t.authority}
                  onToggle={() => setExpanded((e) => (e === t.authority ? null : t.authority))}
                />
              ))
            )}
          </tbody>
        </table>

        {/* Infinite-scroll sentinel (default board only) */}
        {!searchRows && hasMore && !loading && (
          <div ref={sentinel} className="py-3 text-center font-mono text-[10px] text-text-secondary/40">
            {loadingMore ? "loading…" : "scroll for more"}
          </div>
        )}
      </div>

      <p className="px-1 font-mono text-[10px] leading-relaxed text-text-secondary/45">
        Ranked by on-chain account value across all subaccounts. &ldquo;Active&rdquo; means account
        value over $1 (dust accounts are excluded from the ranking but still searchable). Equity /
        uPnL / positions are enriched for the top leaders; click any row for full live detail.
        Search reaches every registered wallet, active or not.
      </p>
    </div>
  );
}

function StatsHeader({ stats, loading }: { stats: LeaderboardStats | null; loading: boolean }) {
  const tiles = [
    { label: "Active traders", value: stats ? stats.activeTraders.toLocaleString() : "—", sub: stats ? `of ${stats.totalTraders.toLocaleString()} registered · >$1` : "", title: "Active = on-chain account value over $1 (filters out dust accounts that registered but never funded). Lower-value and dormant wallets are still reachable via search." },
    { label: "Total accounts", value: stats ? stats.totalAccounts.toLocaleString() : "—", sub: "trader subaccounts", title: "Total Phoenix trader PDAs (cross + isolated subaccounts) across all registered wallets." },
    { label: "Total collateral", value: stats ? compactUsd(stats.totalCollateralUsd) : "—", sub: "across active traders", title: undefined },
    { label: "Avg account value", value: stats ? compactUsd(stats.avgAccountValueUsd) : "—", sub: stats ? `median ${compactUsd(stats.medianAccountValueUsd)}` : "", title: undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border border-ember-border bg-ember-border/40 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} title={t.title} className={clsx("flex flex-col gap-1 bg-surface-l1 px-4 py-3", t.title && "cursor-help")}>
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">{t.label}{t.title ? " ⓘ" : ""}</span>
          <span className="font-mono text-base font-semibold tabular-nums text-text-primary">{loading ? "…" : t.value}</span>
          {t.sub && <span className="font-mono text-[10px] text-text-secondary/50">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function Th({
  label, k, sortKey, sortDir, onSort, align, title,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void; align: "left" | "right"; title?: string;
}) {
  const active = sortKey === k;
  return (
    <th className={clsx("px-3 py-2 font-normal", align === "right" ? "text-right" : "text-left")}>
      <button
        onClick={() => onSort(k)}
        title={title}
        className={clsx("uppercase tracking-wider transition-colors hover:text-text-primary", active ? "text-ember-orange" : "text-text-secondary/50", title && "cursor-help")}
      >
        {label}{title ? " ⓘ" : ""}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function Row({
  entry, name, expanded, onToggle,
}: {
  entry: LeaderboardEntry; name: string | null | undefined; expanded: boolean; onToggle: () => void;
}) {
  const upnl = entry.unrealizedPnlUsd;

  // Lazy-enrich this row when it scrolls into view, if the backend didn't
  // pre-enrich it (equity missing). One fetch per wallet, cached.
  const rowRef = useRef<HTMLTableRowElement>(null);
  const needsEnrich = entry.equityUsd == null;
  useEffect(() => {
    if (!needsEnrich) return;
    const el = rowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          requestEnrich(entry.authority);
          io.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [entry.authority, needsEnrich]);

  return (
    <>
      <tr
        ref={rowRef}
        onClick={onToggle}
        className={clsx("cursor-pointer border-b border-ember-border/20 hover:bg-surface-l2/40", expanded && "bg-surface-l2/60")}
      >
        <td className="px-3 py-1.5 text-text-secondary/60 tabular-nums">{entry.rank}</td>
        <td className="px-3 py-1.5">
          {name ? (
            <span className="text-ember-orange">{name}</span>
          ) : (
            <span className="text-text-primary">{shortAddr(entry.authority, 4, 4)}</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-text-primary">{formatUsd(entry.accountValueUsd)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary/80">{entry.equityUsd != null ? formatUsd(entry.equityUsd) : "—"}</td>
        <td className={clsx("px-3 py-1.5 text-right tabular-nums", upnl == null ? "text-text-secondary/40" : upnl >= 0 ? "text-ember-green" : "text-ember-red")}>
          {upnl != null ? `${upnl >= 0 ? "+" : ""}${formatUsd(upnl)}` : "—"}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary/80">{entry.volumeUsd != null ? formatUsd(entry.volumeUsd) : "—"}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary/70">{entry.openPositions ?? "—"}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary/50">{entry.subaccounts}</td>
        <td className="px-2 py-1.5 text-right text-text-secondary/40">{expanded ? "▾" : "▸"}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-ember-border/30 bg-ember-black/30">
          <td colSpan={9} className="px-4 py-3">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              {name && <span className="font-mono text-[12px] text-ember-orange">{name}</span>}
              <span className="font-mono text-[11px] text-text-secondary/80">{entry.authority}</span>
              <a href={accountUrl(entry.authority)} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] uppercase tracking-wider text-ember-orange/80 hover:text-ember-orange">Solscan ↗</a>
              <Link href={`/profile?trader=${entry.authority}`} className="font-mono text-[10px] uppercase tracking-wider text-ember-orange/80 hover:text-ember-orange">Full profile →</Link>
            </div>
            <OpenPositions authority={entry.authority} />
          </td>
        </tr>
      )}
    </>
  );
}
