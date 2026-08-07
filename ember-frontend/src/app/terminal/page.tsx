"use client";

import { useState } from "react";
import { TerminalGrid } from "@/components/layout/TerminalGrid";
import { MarketHeader } from "@/components/terminal/MarketHeader";
import { MarketDataPanel } from "@/components/terminal/MarketDataPanel";
import { Orderbook } from "@/components/terminal/Orderbook";
import { Chart } from "@/components/terminal/Chart";
import { TradeHistory } from "@/components/terminal/TradeHistory";
import { OrderEntry } from "@/components/terminal/OrderEntry";
import { Positions } from "@/components/terminal/Positions";
import { ConnectionStatus } from "@/components/shared/ConnectionStatus";
import { TradeDetailPanel } from "@/components/terminal/TradeDetailPanel";
import { KeyboardShortcutOverlay } from "@/components/terminal/KeyboardShortcutOverlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { DepthChart } from "@/components/terminal/DepthChart";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useUiStore } from "@/stores/uiStore";
import { useStatsStore } from "@/stores/statsStore";
import { formatPrice } from "@/lib/format";
import { useMarketStore } from "@/stores/marketStore";
import clsx from "clsx";

function MobileTerminal() {
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const mobileTab = useUiStore((s) => s.mobileTab);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const stats = useStatsStore((s) => s.stats);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);

  const tabs = [
    { key: "book" as const, label: "Book" },
    { key: "trade" as const, label: "Trade" },
    { key: "positions" as const, label: "Positions" },
  ];

  return (
    <div className="flex h-dvh flex-col">
      <ConnectionStatus />
      <MarketHeader />

      {/* Chart section — collapsible */}
      <div className={clsx(
        "relative border-b border-ember-border transition-[height] duration-200",
        chartCollapsed ? "h-12" : "h-[40vh]"
      )}>
        {chartCollapsed ? (
          <div className="flex h-full items-center justify-between px-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-medium text-text-primary">
                {selectedSymbol}-PERP
              </span>
              {stats && (
                <span className="font-mono text-xs text-text-secondary">
                  ${formatPrice(stats.mark_price)}
                </span>
              )}
            </div>
            <button
              onClick={() => setChartCollapsed(false)}
              className="p-1 text-text-secondary/60 transition-colors hover:text-text-primary"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 10l4-4 4 4" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div className="h-full">
              <Chart />
            </div>
            <button
              onClick={() => setChartCollapsed(true)}
              className="absolute right-2 top-2 z-10 bg-surface-l1/80 p-1 text-text-secondary/60 transition-colors hover:text-text-primary"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Tab content area */}
      <div className={clsx(
        "flex-1",
        mobileTab === "trade" ? "overflow-y-auto" : "overflow-hidden"
      )}>
        {mobileTab === "book" && (
          <ErrorBoundary name="Orderbook">
            <MarketDataPanel
              orderbook={<Orderbook />}
              tradeHistory={<TradeHistory />}
              depthChart={<DepthChart />}
            />
          </ErrorBoundary>
        )}
        {mobileTab === "trade" && <ErrorBoundary name="Order Entry"><OrderEntry /></ErrorBoundary>}
        {mobileTab === "positions" && <ErrorBoundary name="Positions"><Positions /></ErrorBoundary>}
      </div>

      {/* Bottom tab bar */}
      <div className="flex h-12 border-t border-ember-border bg-surface-l1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMobileTab(tab.key)}
            className={clsx(
              "relative flex flex-1 items-center justify-center font-mono text-[11px] uppercase tracking-wider transition-colors",
              mobileTab === tab.key
                ? "text-ember-orange"
                : "text-text-secondary/60"
            )}
          >
            {tab.label}
            {mobileTab === tab.key && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-ember-orange" />
            )}
          </button>
        ))}
      </div>

      <TradeDetailPanel />
    </div>
  );
}

function Terminal() {
  const isMobile = useIsMobile();
  useKeyboardShortcuts();

  if (isMobile) {
    return <MobileTerminal />;
  }

  return (
    <div className="flex h-full flex-col">
      <ConnectionStatus />
      <MarketHeader />
      <TerminalGrid
        marketData={
          <ErrorBoundary name="Orderbook">
            <MarketDataPanel
              orderbook={<Orderbook />}
              tradeHistory={<TradeHistory />}
              depthChart={<DepthChart />}
            />
          </ErrorBoundary>
        }
        chart={<ErrorBoundary name="Chart"><Chart /></ErrorBoundary>}
        orderEntry={<ErrorBoundary name="Order Entry"><OrderEntry /></ErrorBoundary>}
        positions={<ErrorBoundary name="Positions"><Positions /></ErrorBoundary>}
      />
      <TradeDetailPanel />
      <KeyboardShortcutOverlay />
    </div>
  );
}

export default function TerminalPage() {
  return <Terminal />;
}
