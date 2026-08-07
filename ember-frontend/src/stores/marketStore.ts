import { create } from "zustand";
import { Market } from "@/types/market";

export interface MarketConfig {
  maxLeverage: number;
  baseLotsDecimals: number;
  tickSize: number;
  fundingIntervalSeconds: number;
  takerFee: number;
  makerFee: number;
}

interface MarketStore {
  markets: Market[];
  selectedSymbol: string;
  marketConfig: MarketConfig | null;
  setMarkets: (markets: Market[]) => void;
  setSelectedSymbol: (symbol: string) => void;
  setMarketConfig: (config: MarketConfig) => void;
}

export const useMarketStore = create<MarketStore>((set) => ({
  markets: [],
  selectedSymbol: "SOL",
  marketConfig: null,
  setMarkets: (markets) => set({ markets }),
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setMarketConfig: (config) => set({ marketConfig: config }),
}));
