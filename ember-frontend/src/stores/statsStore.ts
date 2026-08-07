import { create } from "zustand";
import { MarketStats } from "@/types/market";

interface StatsStore {
  stats: MarketStats | null;
  markPrices: Record<string, number>;
  open24h: number | null;
  setStats: (stats: MarketStats | null) => void;
  setMarkPrice: (symbol: string, price: number) => void;
  setOpen24h: (price: number) => void;
}

export const useStatsStore = create<StatsStore>((set) => ({
  stats: null,
  markPrices: {},
  open24h: null,
  setStats: (stats) => set({ stats }),
  setMarkPrice: (symbol, price) =>
    set((s) => ({ markPrices: { ...s.markPrices, [symbol]: price } })),
  setOpen24h: (price) => set({ open24h: price }),
}));
