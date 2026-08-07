"use client";

import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";
import { useMarketStore } from "@/stores/marketStore";

export function useKeyboardShortcuts() {
  const setFocusSide = useUiStore((s) => s.setFocusSide);
  const toggleShortcutOverlay = useUiStore((s) => s.toggleShortcutOverlay);
  const setShowShortcutOverlay = useUiStore((s) => s.setShowShortcutOverlay);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when user is typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key;

      switch (key) {
        case "b":
        case "B":
          e.preventDefault();
          setFocusSide("buy");
          break;
        case "s":
        case "S":
          e.preventDefault();
          setFocusSide("sell");
          break;
        case "Escape":
          setShowShortcutOverlay(false);
          break;
        case "?":
          e.preventDefault();
          toggleShortcutOverlay();
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5": {
          e.preventDefault();
          const idx = parseInt(key) - 1;
          const markets = useMarketStore.getState().markets;
          if (idx < markets.length) {
            useMarketStore.getState().setSelectedSymbol(markets[idx].symbol);
          }
          break;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [setFocusSide, toggleShortcutOverlay, setShowShortcutOverlay]);
}
