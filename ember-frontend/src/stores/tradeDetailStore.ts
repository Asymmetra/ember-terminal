import { create } from "zustand";
import { Trade } from "@/types/market";
import { TradeHistoryItem, TraderPosition } from "@/types/trader";

type TradeDetailData =
  | { type: "recentTrade"; data: Trade }
  | { type: "tradeHistory"; data: TradeHistoryItem }
  | { type: "position"; data: TraderPosition };

interface TradeDetailStore {
  open: boolean;
  detail: TradeDetailData | null;
  openRecentTrade: (trade: Trade) => void;
  openTradeHistory: (trade: TradeHistoryItem) => void;
  openPosition: (pos: TraderPosition) => void;
  close: () => void;
}

export const useTradeDetailStore = create<TradeDetailStore>((set) => ({
  open: false,
  detail: null,
  openRecentTrade: (trade) =>
    set({ open: true, detail: { type: "recentTrade", data: trade } }),
  openTradeHistory: (trade) =>
    set({ open: true, detail: { type: "tradeHistory", data: trade } }),
  openPosition: (pos) =>
    set({ open: true, detail: { type: "position", data: pos } }),
  close: () => set({ open: false, detail: null }),
}));
