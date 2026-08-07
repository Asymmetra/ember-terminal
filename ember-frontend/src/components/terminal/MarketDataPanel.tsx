"use client";

import { ReactNode, useState } from "react";
import clsx from "clsx";

type MarketDataTab = "book" | "trades" | "depth";

const TABS: { key: MarketDataTab; label: string }[] = [
  { key: "book", label: "Book" },
  { key: "trades", label: "Trades" },
  { key: "depth", label: "Depth" },
];

interface MarketDataPanelProps {
  orderbook: ReactNode;
  tradeHistory: ReactNode;
  depthChart: ReactNode;
}

export function MarketDataPanel({ orderbook, tradeHistory, depthChart }: MarketDataPanelProps) {
  const [activeTab, setActiveTab] = useState<MarketDataTab>("book");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-ember-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              "relative px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
              activeTab === tab.key
                ? "text-text-primary"
                : "text-text-secondary/60 hover:text-text-secondary"
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-px bg-ember-orange" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "book" && orderbook}
        {activeTab === "trades" && tradeHistory}
        {activeTab === "depth" && depthChart}
      </div>
    </div>
  );
}
