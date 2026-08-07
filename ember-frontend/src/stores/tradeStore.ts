import { create } from "zustand";
import { Trade } from "@/types/market";

const STORAGE_KEY = "ember-trades";
const MAX_TRADES = 500;
const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function loadPersistedTrades(): Record<string, Trade[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function persistTrades(symbol: string, trades: Trade[]) {
  if (typeof window === "undefined") return;
  try {
    const all = loadPersistedTrades();
    all[symbol] = trades.slice(0, MAX_TRADES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Returns timestamp in ms for a trade */
export function tradeTimestampMs(trade: Trade): number {
  if (typeof trade.timestamp === "string") return new Date(trade.timestamp).getTime();
  // If seconds (before 2100), convert to ms
  return trade.timestamp > 1e12 ? trade.timestamp : trade.timestamp * 1000;
}

/** Check if there's a time gap > threshold between two trades */
export function hasTimeGap(newer: Trade, older: Trade): boolean {
  const diff = tradeTimestampMs(newer) - tradeTimestampMs(older);
  return Math.abs(diff) > GAP_THRESHOLD_MS;
}

/** Format a time gap for display */
export function formatGap(newer: Trade, older: Trade): string {
  const diffMs = Math.abs(tradeTimestampMs(newer) - tradeTimestampMs(older));
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m gap`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m gap`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h gap`;
}

interface TradeStore {
  trades: Trade[];
  currentSymbol: string;
  addTrades: (newTrades: Trade[]) => void;
  setTrades: (trades: Trade[]) => void;
  loadForSymbol: (symbol: string) => void;
}

export const useTradeStore = create<TradeStore>((set, get) => ({
  trades: [],
  currentSymbol: "",
  addTrades: (newTrades) =>
    set((state) => {
      const merged = [...newTrades, ...state.trades].slice(0, MAX_TRADES);
      persistTrades(state.currentSymbol, merged);
      return { trades: merged };
    }),
  setTrades: (trades) => {
    const symbol = get().currentSymbol;
    persistTrades(symbol, trades);
    set({ trades });
  },
  loadForSymbol: (symbol) => {
    const persisted = loadPersistedTrades();
    const restored = persisted[symbol] || [];
    set({ trades: restored, currentSymbol: symbol });
  },
}));
