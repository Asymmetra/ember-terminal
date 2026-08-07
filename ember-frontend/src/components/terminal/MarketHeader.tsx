"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "@/components/shared/PageNav";
import { MobileNav } from "@/components/shared/MobileNav";
import { useMarketStore } from "@/stores/marketStore";
import { useStatsStore } from "@/stores/statsStore";
import { useTraderStore } from "@/stores/traderStore";
import { formatPrice, formatPercent, formatUsd, abbreviateNumber } from "@/lib/format";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useMarkets } from "@/hooks/useMarkets";
import { getLivePositionPnl } from "@/hooks/useLivePositionPnl";
import { WalletButton } from "@/components/shared/WalletButton";
import { DepositWithdraw } from "@/components/terminal/DepositWithdraw";
import { useIsMobile } from "@/hooks/useIsMobile";
import { wsClient } from "@/lib/ws";
import { API_BASE_URL } from "@/lib/constants";
import clsx from "clsx";

function HealthDot() {
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected" | "reconnecting">("disconnected");
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [apiLatency, setApiLatency] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    return wsClient.onStatus(setWsStatus);
  }, []);

  const checkApi = useCallback(() => {
    const start = performance.now();
    fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => {
        setApiLatency(Math.round(performance.now() - start));
        setApiOk(r.ok);
      })
      .catch(() => {
        setApiLatency(null);
        setApiOk(false);
      });
  }, []);

  useEffect(() => {
    checkApi();
    const interval = setInterval(checkApi, 30000);
    return () => clearInterval(interval);
  }, [checkApi]);

  // Tick every second when hovering to update freshness values
  useEffect(() => {
    if (!hover) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hover]);

  const allGood = wsStatus === "connected" && apiOk === true;
  const partial = wsStatus === "connected" || apiOk === true;

  const color = allGood ? "bg-ember-green" : partial ? "bg-yellow-500" : "bg-ember-red";
  const pulse = allGood ? "" : "animate-pulse";

  // Freshness helper — uses `now` state (updated every second while hovering)
  const freshness = (lastMs: number) => {
    if (!lastMs) return null;
    const ago = Math.floor((now - lastMs) / 1000);
    if (ago < 2) return "<1s ago";
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    return `${Math.floor(ago / 3600)}h ago`;
  };

  const latencyColor = (ms: number | null) => {
    if (ms === null) return "text-ember-red";
    if (ms < 200) return "text-ember-green";
    if (ms < 500) return "text-yellow-500";
    return "text-ember-red";
  };

  // Force read wsClient fields on each tick
  void now;
  const obFresh = freshness(wsClient.lastMessageAt["orderbook"]);
  const statsFresh = freshness(wsClient.lastMessageAt["stats"]);
  const tradesFresh = freshness(wsClient.lastMessageAt["trades"]);
  const candlesFresh = freshness(wsClient.lastMessageAt["candles"]);
  const lastAnyFresh = freshness(wsClient.lastAnyMessageAt);

  return (
    <div
      className="group relative flex items-center gap-1.5 cursor-default"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${color} ${pulse}`} />
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">
        {allGood ? "Live" : wsStatus === "reconnecting" ? "Reconnecting" : "Degraded"}
      </span>

      {/* Rich hover panel */}
      {hover && (
        <div className="absolute right-0 top-full z-[200] mt-1 w-[260px] border border-ember-border bg-[#1A1B20] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
          <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-text-primary">
            System Health
          </div>

          {/* REST API */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${apiOk ? "bg-ember-green" : apiOk === false ? "bg-ember-red" : "bg-yellow-500"}`} />
              <span className="font-mono text-[10px] text-text-secondary">REST API</span>
            </div>
            <span className={clsx("font-mono text-[10px]", latencyColor(apiLatency))}>
              {apiOk === null ? "checking..." : apiOk ? `${apiLatency}ms` : "DOWN"}
            </span>
          </div>

          {/* WebSocket */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${wsStatus === "connected" ? "bg-ember-green" : wsStatus === "reconnecting" ? "bg-yellow-500" : "bg-ember-red"}`} />
              <span className="font-mono text-[10px] text-text-secondary">WebSocket</span>
            </div>
            <span className={clsx("font-mono text-[10px]", wsStatus === "connected" ? "text-ember-green" : "text-ember-red")}>
              {wsStatus === "connected" ? (lastAnyFresh || "connected") : wsStatus}
            </span>
          </div>

          {/* Divider */}
          <div className="my-1.5 h-px bg-ember-border/50" />

          {/* Channel freshness */}
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-secondary/50">
            Data Feeds
          </div>

          {[
            { label: "Orderbook", fresh: obFresh },
            { label: "Stats / Price", fresh: statsFresh },
            { label: "Trades", fresh: tradesFresh },
            { label: "Candles", fresh: candlesFresh },
          ].map(({ label, fresh }) => (
            <div key={label} className="flex items-center justify-between py-0.5">
              <span className="font-mono text-[10px] text-text-secondary/70">{label}</span>
              <div className="flex items-center gap-1.5">
                <span className={`inline-block h-1 w-1 rounded-full ${fresh ? "bg-ember-green" : "bg-ember-red/50"}`} />
                <span className={clsx("font-mono text-[10px]", fresh ? "text-text-secondary" : "text-text-secondary/40")}>
                  {fresh || "no data"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const markets = useMarketStore((s) => s.markets);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 border border-ember-border bg-surface-l2 px-3 py-1.5 transition-colors hover:border-ember-orange/40"
      >
        <span className="font-mono text-sm font-medium text-text-primary">
          {selectedSymbol}-PERP
        </span>
        <svg
          className={clsx("h-3 w-3 text-text-secondary transition-transform", open && "rotate-180")}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-px min-w-[160px] border border-ember-border bg-surface-l1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {markets.map((m) => (
            <button
              key={m.symbol}
              onClick={() => {
                setSelectedSymbol(m.symbol);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center px-3 py-1.5 font-mono text-xs transition-colors",
                m.symbol === selectedSymbol
                  ? "bg-ember-orange/10 text-ember-orange"
                  : "text-text-secondary hover:bg-surface-l2 hover:text-text-primary"
              )}
            >
              {m.symbol}-PERP
            </button>
          ))}
          {markets.length === 0 && (
            <div className="px-3 py-1.5 font-mono text-xs text-text-secondary/70">
              Loading markets...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  colorClass?: string;
}

function Stat({ label, value, colorClass }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] leading-none text-text-secondary/60">{label}</span>
      <span className={clsx("font-mono text-xs leading-none", colorClass || "text-text-secondary")}>
        {value}
      </span>
    </div>
  );
}

function StatSeparator() {
  return <div className="h-6 w-px bg-ember-border/60" />;
}

function FundingCountdown({ intervalSeconds }: { intervalSeconds: number }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const now = Math.floor(Date.now() / 1000);
      const next = Math.ceil(now / intervalSeconds) * intervalSeconds;
      const diff = next - now;
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setRemaining(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [intervalSeconds]);

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] leading-none text-text-secondary/60">Next Funding</span>
      <span className="font-mono text-xs leading-none text-text-secondary">{remaining}</span>
    </div>
  );
}

// Combined Funding-rate + countdown — paired stats that only make sense together.
function FundingStat({
  rate,
  intervalSeconds,
}: {
  rate: number;
  intervalSeconds: number | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] leading-none text-text-secondary/60">Funding / 1h</span>
      <span className="font-mono text-xs leading-none">
        <span className={rate >= 0 ? "text-ember-green" : "text-ember-red"}>
          {formatPercent(rate)}
        </span>
        {intervalSeconds != null && (
          <>
            <span className="text-text-secondary/40"> · </span>
            <FundingCountdownInline intervalSeconds={intervalSeconds} />
          </>
        )}
      </span>
    </div>
  );
}

function FundingCountdownInline({ intervalSeconds }: { intervalSeconds: number }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    function update() {
      const now = Math.floor(Date.now() / 1000);
      const next = Math.ceil(now / intervalSeconds) * intervalSeconds;
      const diff = next - now;
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setRemaining(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [intervalSeconds]);
  return <span className="text-text-secondary/70">{remaining}</span>;
}

// Mark price + 24h change as a single hover group. Hovering the whole block
// reveals secondary market stats (Last / Index / OI / Volume). Matches the
// HealthDot pattern — the value IS the affordance, no dedicated icon.
function PriceBlock({
  markPrice,
  open24h,
  lastPrice,
  indexPrice,
  openInterest,
  volume24h,
}: {
  markPrice: number;
  open24h: number | null;
  lastPrice: number;
  indexPrice: number;
  openInterest: number;
  volume24h: number;
}) {
  const [hover, setHover] = useState(false);
  const change = open24h != null && open24h > 0 ? markPrice - open24h : 0;
  const changePct = open24h != null && open24h > 0 ? (change / open24h) * 100 : 0;
  const positive = change >= 0;
  const showChange = open24h != null && open24h > 0;
  return (
    <div
      className="relative flex items-center gap-2"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className={clsx(
          "cursor-help font-mono text-lg font-semibold transition-colors",
          hover ? "text-ember-orange" : "text-text-primary"
        )}
        style={{ letterSpacing: "-0.02em" }}
      >
        ${formatPrice(markPrice)}
      </span>
      {showChange && (
        <span
          className={clsx(
            "cursor-help font-mono text-xs",
            positive ? "text-ember-green" : "text-ember-red"
          )}
        >
          {positive ? "+" : ""}{changePct.toFixed(2)}%
        </span>
      )}
      {hover && (
        <div className="absolute left-0 top-full z-[200] mt-1 min-w-[180px] border border-ember-border bg-[#1A1B20] p-2 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
          <PopoverRow label="Last" value={`$${formatPrice(lastPrice)}`} />
          <PopoverRow label="Index" value={`$${formatPrice(indexPrice)}`} />
          <PopoverRow label="Open Int." value={`$${abbreviateNumber(openInterest)}`} />
          <PopoverRow label="24h Vol." value={`$${abbreviateNumber(volume24h)}`} />
        </div>
      )}
    </div>
  );
}

function PopoverRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary/60">
        {label}
      </span>
      <span className="font-mono text-[11px] text-text-secondary">{value}</span>
    </div>
  );
}

// Combined Portfolio + Unreal PnL into a single two-line stat.
function PortfolioStat({ portfolioValue, unrealizedPnl }: { portfolioValue: number; unrealizedPnl: number }) {
  const positive = unrealizedPnl >= 0;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] leading-none text-text-secondary/60">Portfolio</span>
      <span className="font-mono text-xs leading-none">
        <span className="text-text-primary">{formatUsd(portfolioValue)}</span>
        <span className={clsx("ml-1.5", positive ? "text-ember-green" : "text-ember-red")}>
          {positive ? "+" : ""}{formatUsd(unrealizedPnl)}
        </span>
      </span>
    </div>
  );
}

// Combined Available + total Collateral, with a single "0.65 / 12.00" display.
// Available is the actionable number, shown first; collateral is context.
function AvailableStat({
  available,
  collateral,
}: {
  available: number;
  collateral: number;
}) {
  const tight = collateral > 0 && available < collateral * 0.1;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] leading-none text-text-secondary/60">Available</span>
      <span className="font-mono text-xs leading-none">
        <span className={tight ? "text-ember-orange" : "text-text-secondary"}>
          {formatUsd(available)}
        </span>
        <span className="text-text-secondary/40"> / {formatUsd(collateral)}</span>
      </span>
    </div>
  );
}

export function MarketHeader() {
  useWebSocket();
  useMarkets();
  // useTraderSync() now runs in the root-layout <OnboardingGate />, so every
  // page (terminal, profile, stats) gets consistent trader state and
  // the invite-gate modal without each page wiring it in itself.

  const isMobile = useIsMobile();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const pathname = usePathname();

  const stats = useStatsStore((s) => s.stats);
  const open24h = useStatsStore((s) => s.open24h);
  const marketConfig = useMarketStore((s) => s.marketConfig);
  const traderConnected = useTraderStore((s) => s.connected);
  const account = useTraderStore((s) => s.account);
  const collateral = useTraderStore((s) => s.collateral);
  const initialMargin = useTraderStore((s) => s.initialMargin);
  const positions = useTraderStore((s) => s.positions);
  const availableCollateral = Math.max(0, collateral - initialMargin);
  const markPrices = useStatsStore((s) => s.markPrices);
  const hasAccount = account != null;

  // Single source of truth for live PnL — see hooks/useLivePositionPnl.ts.
  const unrealizedPnl = useMemo(
    () => positions.reduce((sum, pos) => sum + getLivePositionPnl(pos, markPrices[pos.symbol]).markToMarket, 0),
    [positions, markPrices],
  );
  const portfolioValue = collateral + unrealizedPnl;

  if (isMobile) {
    return (
      <div className="border-b border-ember-border bg-surface-l1">
        {/* Row 1: Market selector + price + deposit + wallet */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <MarketSelector />
            {stats && (
              <span
                className="font-mono text-base font-semibold text-text-primary"
                style={{ letterSpacing: "-0.02em" }}
              >
                ${formatPrice(stats.mark_price)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDepositModal(true)}
              className="border border-ember-orange/60 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ember-orange transition-colors hover:bg-ember-orange/10"
            >
              Deposit
            </button>
            <WalletButton />
            <MobileNav currentPath="/terminal" />
          </div>
        </div>

        {/* Row 2: Scrollable stats */}
        {stats && (
          <div className="scrollbar-hide flex items-center gap-3 overflow-x-auto border-t border-ember-border/50 px-3 py-1">
            {open24h != null && open24h > 0 && (() => {
              const change = stats.mark_price - open24h;
              const changePct = (change / open24h) * 100;
              const positive = change >= 0;
              return (
                <Stat
                  label="24h"
                  value={`${positive ? "+" : ""}${changePct.toFixed(2)}%`}
                  colorClass={positive ? "text-ember-green" : "text-ember-red"}
                />
              );
            })()}
            <Stat
              label="Funding"
              value={formatPercent(stats.funding_rate)}
              colorClass={stats.funding_rate >= 0 ? "text-ember-green" : "text-ember-red"}
            />
            {marketConfig && (
              <FundingCountdown intervalSeconds={marketConfig.fundingIntervalSeconds} />
            )}
            <Stat label="OI" value={`$${abbreviateNumber(stats.open_interest)}`} />
            <Stat label="Vol" value={`$${abbreviateNumber(stats.volume_24h)}`} />
          </div>
        )}

        {showDepositModal && <DepositWithdraw onClose={() => setShowDepositModal(false)} />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 border-b border-ember-border bg-surface-l1 px-3 py-1.5">
      {/* Market selector */}
      <MarketSelector />

      {/* Mark price + 24h change as one hover group — hovering reveals
         secondary market stats (Last / Index / OI / 24h Vol). No info icon;
         the value itself is the affordance. */}
      {stats && (
        <>
          <PriceBlock
            markPrice={stats.mark_price}
            open24h={open24h}
            lastPrice={stats.last_price}
            indexPrice={stats.index_price}
            openInterest={stats.open_interest}
            volume24h={stats.volume_24h}
          />

          <StatSeparator />

          <FundingStat
            rate={stats.funding_rate}
            intervalSeconds={marketConfig?.fundingIntervalSeconds ?? null}
          />
        </>
      )}

      {/* Account info (wallet connected) */}
      {traderConnected && (
        <>
          <StatSeparator />
          <PortfolioStat portfolioValue={portfolioValue} unrealizedPnl={unrealizedPnl} />
          <AvailableStat available={availableCollateral} collateral={collateral} />
        </>
      )}

      {/* Spacer */}
      <div className="ml-auto" />

      {/* Nav links — shares NAV_LINKS with the non-terminal PageNav so
          the link set + active styling stay in sync everywhere. */}
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={clsx(
            "font-mono text-[10px] uppercase tracking-wider transition-colors",
            pathname === link.href
              ? "text-ember-orange"
              : "text-text-secondary/60 hover:text-ember-orange"
          )}
        >
          {link.label}
        </Link>
      ))}

      <StatSeparator />

      {/* Health status */}
      <HealthDot />

      <StatSeparator />

      {/* Deposit button */}
      <button
        onClick={() => setShowDepositModal(true)}
        className="border border-ember-orange/60 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ember-orange transition-colors hover:bg-ember-orange/10"
      >
        Deposit
      </button>

      {/* Wallet */}
      <WalletButton />

      {showDepositModal && <DepositWithdraw onClose={() => setShowDepositModal(false)} />}
    </div>
  );
}
