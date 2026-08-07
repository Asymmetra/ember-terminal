"use client";

import { useRef } from "react";
import { useUiStore } from "@/stores/uiStore";

const SHORTCUTS = [
  { key: "B", description: "Buy / Long" },
  { key: "S", description: "Sell / Short" },
  { key: "1–5", description: "Switch market" },
  { key: "?", description: "Toggle this overlay" },
  { key: "Esc", description: "Close overlay / modal" },
];

export function KeyboardShortcutOverlay() {
  const show = useUiStore((s) => s.showShortcutOverlay);
  const setShow = useUiStore((s) => s.setShowShortcutOverlay);
  const overlayRef = useRef<HTMLDivElement>(null);

  if (!show) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) setShow(false);
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="w-[320px] border border-ember-border bg-surface-l1 shadow-[0_16px_64px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ember-border px-4 py-3">
          <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-primary">
            Keyboard Shortcuts
          </span>
          <button
            onClick={() => setShow(false)}
            className="text-text-secondary/60 transition-colors hover:text-text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Shortcut grid */}
        <div className="flex flex-col gap-0 p-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between px-2 py-2 transition-colors hover:bg-surface-l2/30"
            >
              <span className="font-mono text-[11px] text-text-secondary/70">{s.description}</span>
              <kbd className="min-w-[36px] border border-ember-border/50 bg-surface-l2 px-2 py-0.5 text-center font-mono text-[10px] text-text-primary">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
