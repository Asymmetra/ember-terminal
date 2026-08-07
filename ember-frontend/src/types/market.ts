export interface Market {
  symbol: string;
  status: string;
  isolatedOnly?: boolean;
  maxLeverage?: number;
  // Per-market base-lot precision. BTC=4 (0.0001), SOL=2 (0.01), MON=0 (1).
  // Used to format position size in the UI so a small BTC position
  // (e.g. 0.0043) doesn't render as "0.00".
  baseLotsDecimals?: number;
  tickSize?: number;
  takerFee?: number;
  makerFee?: number;
  fundingIntervalSeconds?: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface OrderbookData {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  symbol: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketStats {
  mark_price: number;
  index_price: number;
  last_price: number;
  volume_24h: number;
  funding_rate: number;
  open_interest: number;
}

export interface Trade {
  price: number;
  size: number;
  side: "bid" | "ask";
  timestamp: number | string;
}
