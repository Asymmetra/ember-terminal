"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useMarketStore } from "@/stores/marketStore";

export function useMarkets() {
  const setMarkets = useMarketStore((s) => s.setMarkets);

  useEffect(() => {
    api.getMarkets().then(setMarkets).catch(console.error);
  }, [setMarkets]);
}
