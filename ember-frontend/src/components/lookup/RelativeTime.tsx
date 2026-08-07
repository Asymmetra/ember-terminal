"use client";

import { useEffect, useState } from "react";
import { absoluteTimeTooltip, relativeTime } from "@/lib/relativeTime";

/**
 * Renders a relative timestamp ("5m ago") that auto-updates every
 * 30 seconds. Hovering reveals an instant CSS popover with the
 * full local + UTC time so you can disambiguate at any point.
 *
 * Uses a single shared ticker via a module-level counter that
 * components subscribe to via React state — one setInterval for
 * the whole page regardless of how many <RelativeTime> instances
 * are mounted.
 */

let tickListeners: Array<() => void> = [];
let tickInterval: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  tickListeners.push(cb);
  if (tickInterval == null) {
    tickInterval = setInterval(() => {
      for (const fn of tickListeners) fn();
    }, 30_000);
  }
  return () => {
    tickListeners = tickListeners.filter((f) => f !== cb);
    if (tickListeners.length === 0 && tickInterval != null) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };
}

interface Props {
  /** Unix milliseconds. */
  timestampMs: number;
  /** Optional className for the wrapper span. */
  className?: string;
}

export function RelativeTime({ timestampMs, className }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(timestampMs)) return;
    return subscribe(() => setTick((t) => t + 1));
  }, [timestampMs]);

  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return <span className={className}>—</span>;
  }

  return (
    <span className={`group relative inline-block ${className ?? ""}`}>
      <span className="tabular-nums underline decoration-dotted decoration-text-secondary/30 underline-offset-2">
        {relativeTime(timestampMs)}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none hidden absolute left-0 top-full z-50 mt-1 whitespace-pre rounded border border-ember-border bg-surface-l3/95 px-2 py-1.5 font-mono text-[10px] normal-case leading-snug tracking-normal text-text-primary shadow-xl backdrop-blur-sm group-hover:block"
        style={{ width: "max-content", maxWidth: "320px" }}
      >
        {absoluteTimeTooltip(timestampMs)}
      </span>
    </span>
  );
}
