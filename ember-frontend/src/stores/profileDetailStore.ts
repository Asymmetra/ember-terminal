import { create } from "zustand";
import type { NormalizedTrade, PerMarketStats, Period } from "@/lib/tradeStats";

export type ProfilePositionRow = {
  symbol: string;
  size: number; // signed
  entry: number;
  positionValue: number;
  unrealizedPnl: number;
  liqPrice: number | null;
  initialMargin: number;
  tp: number | null;
  sl: number | null;
  subaccountIndex: number;
  isolated: boolean;
};

type Detail =
  | { type: "trade"; data: NormalizedTrade }
  | { type: "order"; data: Record<string, unknown> }
  | { type: "funding"; data: Record<string, unknown> }
  | { type: "collateral"; data: Record<string, unknown> }
  | { type: "perMarket"; data: PerMarketStats; period: Period }
  | { type: "position"; data: ProfilePositionRow };

interface ProfileDetailStore {
  open: boolean;
  detail: Detail | null;
  openTrade: (t: NormalizedTrade) => void;
  openOrder: (o: Record<string, unknown>) => void;
  openFunding: (f: Record<string, unknown>) => void;
  openCollateral: (c: Record<string, unknown>) => void;
  openPerMarket: (r: PerMarketStats, period: Period) => void;
  openPosition: (p: ProfilePositionRow) => void;
  close: () => void;
}

export const useProfileDetailStore = create<ProfileDetailStore>((set) => ({
  open: false,
  detail: null,
  openTrade: (t) => set({ open: true, detail: { type: "trade", data: t } }),
  openOrder: (o) => set({ open: true, detail: { type: "order", data: o } }),
  openFunding: (f) => set({ open: true, detail: { type: "funding", data: f } }),
  openCollateral: (c) => set({ open: true, detail: { type: "collateral", data: c } }),
  openPerMarket: (r, period) =>
    set({ open: true, detail: { type: "perMarket", data: r, period } }),
  openPosition: (p) => set({ open: true, detail: { type: "position", data: p } }),
  close: () => set({ open: false, detail: null }),
}));
