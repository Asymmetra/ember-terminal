"use client";

import { ReactNode } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";

interface TerminalGridProps {
  marketData: ReactNode;
  chart: ReactNode;
  orderEntry: ReactNode;
  positions: ReactNode;
}

function ResizeHandle({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) {
  return (
    <Separator
      className={
        direction === "vertical"
          ? "w-px bg-ember-border hover:bg-ember-orange/40 transition-colors data-[separator=active]:bg-ember-orange/60"
          : "h-px bg-ember-border hover:bg-ember-orange/40 transition-colors data-[separator=active]:bg-ember-orange/60"
      }
    />
  );
}

export function TerminalGrid({
  marketData,
  chart,
  orderEntry,
  positions,
}: TerminalGridProps) {
  return (
    <Group orientation="vertical" className="flex-1 overflow-hidden">
      {/* Top row: market data | chart | order entry */}
      <Panel defaultSize="70%" minSize="40%">
        <Group orientation="horizontal" className="h-full">
          {/* Left: Tabbed Book/Trades */}
          <Panel defaultSize="20%" minSize="12%" maxSize="35%">
            <div className="h-full bg-surface-l1 overflow-hidden">{marketData}</div>
          </Panel>

          <ResizeHandle direction="vertical" />

          {/* Center: Chart */}
          <Panel defaultSize="55%" minSize="30%">
            <div className="h-full bg-surface-l1 overflow-hidden">{chart}</div>
          </Panel>

          <ResizeHandle direction="vertical" />

          {/* Right: Order Entry */}
          <Panel defaultSize="25%" minSize="15%" maxSize="35%">
            <div className="h-full bg-surface-l1 overflow-auto">{orderEntry}</div>
          </Panel>
        </Group>
      </Panel>

      <ResizeHandle direction="horizontal" />

      {/* Bottom: Positions */}
      <Panel defaultSize="30%" minSize="15%" maxSize="50%">
        <div className="h-full bg-surface-l1 overflow-hidden">{positions}</div>
      </Panel>
    </Group>
  );
}
