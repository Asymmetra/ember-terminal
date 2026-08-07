"use client";

import { useEffect } from "react";
import { wsClient } from "@/lib/ws";
import { api } from "@/lib/api";
import { useMarketStore } from "@/stores/marketStore";
import { useOrderbookStore } from "@/stores/orderbookStore";
import { useTradeStore } from "@/stores/tradeStore";
import { useStatsStore } from "@/stores/statsStore";

export function useWebSocket() {
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setMarketConfig = useMarketStore((s) => s.setMarketConfig);
  const setOrderbook = useOrderbookStore((s) => s.setOrderbook);
  const addTrades = useTradeStore((s) => s.addTrades);
  const loadForSymbol = useTradeStore((s) => s.loadForSymbol);
  const setStats = useStatsStore((s) => s.setStats);
  const setMarkPrice = useStatsStore((s) => s.setMarkPrice);

  useEffect(() => {
    // Clear stale data from previous market immediately
    setOrderbook([], []);
    // Restore persisted trades for this market (or empty if none)
    loadForSymbol(selectedSymbol);
    setStats(null);
    useStatsStore.getState().setOpen24h(0);

    const abortController = new AbortController();
    const { signal } = abortController;

    wsClient.connect();

    // Fetch market config (maxLeverage, baseLotsDecimals, tickSize)
    api.getMarket(selectedSymbol, signal)
      .then((data) => {
        setMarketConfig({
          maxLeverage: data.maxLeverage || 10,
          baseLotsDecimals: data.baseLotsDecimals || 2,
          tickSize: data.tickSize || 100,
          fundingIntervalSeconds: data.fundingIntervalSeconds || 3600,
          takerFee: data.takerFee || 0,
          makerFee: data.makerFee || 0,
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[REST] Market config fetch failed:", err);
      });

    // Fetch 1D candle for 24h open price
    api.getCandles(selectedSymbol, "1d", 1, signal)
      .then((candles) => {
        if (candles?.[0]) {
          useStatsStore.getState().setOpen24h(candles[0].open);
          wsClient.lastMessageAt["candles"] = Date.now();
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[REST] 1D candle fetch failed:", err);
      });

    // Fetch initial orderbook snapshot via REST (immediate data)
    api.getOrderbook(selectedSymbol, signal)
      .then((data) => {
        if (data.bids && data.asks) {
          setOrderbook(data.bids, data.asks);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[REST] Orderbook fetch failed:", err);
      });

    // Fetch initial recent trades via REST
    api.getRecentTrades(selectedSymbol, signal)
      .then((data) => {
        if (data.trades?.length) {
          addTrades(data.trades);
          wsClient.lastMessageAt["trades"] = Date.now();
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Endpoint may not exist on older backend — non-fatal
        console.debug("[REST] Recent trades fetch failed:", err);
      });

    const unsubOrderbook = wsClient.subscribe(
      "orderbook",
      selectedSymbol,
      (data) => {
        if (data.bids && data.asks) {
          setOrderbook(data.bids, data.asks);
        }
      }
    );

    const unsubTrades = wsClient.subscribe(
      "trades",
      selectedSymbol,
      (data) => {
        if (data.trades) {
          addTrades(data.trades);
        }
      }
    );

    const unsubStats = wsClient.subscribe(
      "stats",
      selectedSymbol,
      (data) => {
        setStats(data);
        if (data?.mark_price != null) {
          setMarkPrice(selectedSymbol, data.mark_price);
        }
      }
    );

    return () => {
      abortController.abort();
      unsubOrderbook();
      unsubTrades();
      unsubStats();
    };
  }, [selectedSymbol, setMarketConfig, setOrderbook, addTrades, loadForSymbol, setStats, setMarkPrice]);
}
