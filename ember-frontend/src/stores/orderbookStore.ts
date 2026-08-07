import { create } from "zustand";
import { OrderbookLevel } from "@/types/market";

interface OrderbookStore {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  fillPrice: number | null;
  fillMode: "single" | "multi";
  setBids: (bids: OrderbookLevel[]) => void;
  setAsks: (asks: OrderbookLevel[]) => void;
  setOrderbook: (bids: OrderbookLevel[], asks: OrderbookLevel[]) => void;
  setFillPrice: (price: number | null) => void;
  setFillMode: (mode: "single" | "multi") => void;
}

export const useOrderbookStore = create<OrderbookStore>((set) => ({
  bids: [],
  asks: [],
  fillPrice: null,
  fillMode: "single" as const,
  setBids: (bids) => set({ bids }),
  setAsks: (asks) => set({ asks }),
  setOrderbook: (bids, asks) => set({ bids, asks }),
  setFillPrice: (fillPrice) => set({ fillPrice }),
  setFillMode: (fillMode) => set({ fillMode }),
}));
