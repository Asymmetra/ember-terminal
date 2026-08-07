import { create } from "zustand";

export type MobileTab = "book" | "trade" | "positions";

interface UiStore {
  showShortcutOverlay: boolean;
  focusSide: "buy" | "sell" | null;
  mobileTab: MobileTab;
  setShowShortcutOverlay: (show: boolean) => void;
  toggleShortcutOverlay: () => void;
  setFocusSide: (side: "buy" | "sell" | null) => void;
  setMobileTab: (tab: MobileTab) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  showShortcutOverlay: false,
  focusSide: null,
  mobileTab: "trade",
  setShowShortcutOverlay: (show) => set({ showShortcutOverlay: show }),
  toggleShortcutOverlay: () => set((s) => ({ showShortcutOverlay: !s.showShortcutOverlay })),
  setFocusSide: (side) => set({ focusSide: side }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
}));
