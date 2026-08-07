"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useMarketStore } from "@/stores/marketStore";
import { useOrderbookStore } from "@/stores/orderbookStore";
import { useTraderStore } from "@/stores/traderStore";
import { useStatsStore } from "@/stores/statsStore";
import { useTransactionBuilder } from "@/hooks/useTransactionBuilder";
import { useMarginView } from "@/hooks/useMarginView";
import { useFlightConfig } from "@/hooks/useFlightConfig";
import { useToastStore } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { formatUsd, formatPrice } from "@/lib/format";
import { MarginMode } from "@/types/trader";
import { DepositWithdraw } from "@/components/terminal/DepositWithdraw";
import { MultiOrderPanel } from "@/components/terminal/MultiOrderPanel";
import { setLeveragePref } from "@/lib/leveragePref";
import clsx from "clsx";

export function OrderEntry() {
  const flight = useFlightConfig();
  const [orderType, setOrderType] = useState<"market" | "limit" | "multi">("limit");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [collateralInput, setCollateralInput] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [marginMode, setMarginMode] = useState<MarginMode>("cross");
  const [showTpSl, setShowTpSl] = useState(false);
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [txPhase, setTxPhase] = useState<"idle" | "building" | "simulating" | "signing" | "submitting">("idle");
  const [showDepositModal, setShowDepositModal] = useState(false);
  const submittingRef = useRef(false);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const marketConfig = useMarketStore((s) => s.marketConfig);
  const selectedMarket = useMarketStore((s) => s.markets.find((m) => m.symbol === s.selectedSymbol));
  const isIsolatedOnly = selectedMarket?.isolatedOnly ?? false;
  const markPrice = useStatsStore((s) => s.stats?.mark_price) ?? 0;
  const { submitOrder, submitIsolatedOrder, connected } = useTransactionBuilder();
  const addToast = useToastStore((s) => s.addToast);

  // Consume focusSide from keyboard shortcuts
  const focusSide = useUiStore((s) => s.focusSide);
  const setFocusSide = useUiStore((s) => s.setFocusSide);

  useEffect(() => {
    if (focusSide) {
      setSide(focusSide);
      setFocusSide(null);
    }
  }, [focusSide, setFocusSide]);

  // Listen for orderbook click-to-fill
  const fillPrice = useOrderbookStore((s) => s.fillPrice);
  const setFillPrice = useOrderbookStore((s) => s.setFillPrice);

  useEffect(() => {
    if (fillPrice !== null && orderType !== "multi") {
      setPrice(fillPrice.toString());
      if (orderType === "market") setOrderType("limit");
      setFillPrice(null);
    }
  }, [fillPrice, orderType, setFillPrice]);

  // Reset when market changes
  useEffect(() => {
    setPrice("");
    setLeverage(1);
    setMarginMode("cross");
    setCollateralInput("");
    setShowTpSl(false);
    setTpPrice("");
    setSlPrice("");
  }, [selectedSymbol]);

  // Force isolated mode for isolatedOnly markets
  useEffect(() => {
    if (isIsolatedOnly) setMarginMode("isolated");
  }, [selectedSymbol, isIsolatedOnly]);

  // Hide TP/SL when switching to limit/multi orders (architecturally unsupported)
  useEffect(() => {
    if (orderType === "limit" || orderType === "multi") {
      setShowTpSl(false);
      setTpPrice("");
      setSlPrice("");
    }
  }, [orderType]);

  // Trader account info
  const authority = useTraderStore((s) => s.authority);
  const collateral = useTraderStore((s) => s.collateral);
  const positions = useTraderStore((s) => s.positions);
  const initialMargin = useTraderStore((s) => s.initialMargin);
  const riskState = useTraderStore((s) => s.riskState);
  const fetchingAccount = useTraderStore((s) => s.fetchingAccount);
  const noAccount = useTraderStore((s) => s.noAccount);
  const activationState = useTraderStore((s) => s.activationState);
  const activationFlags = useTraderStore((s) => s.activationFlags);
  const markPricesForEntry = useStatsStore((s) => s.markPrices);

  // Subaccount this order targets: 0 for cross; the existing isolated
  // subaccount for this symbol (else 1) for isolated.
  const isoSubaccountIndex = useMemo(
    () =>
      positions.find((p) => p.symbol === selectedSymbol && p.margin_mode === "isolated")
        ?.subaccount_index ?? 1,
    [positions, selectedSymbol],
  );

  // Protocol-exact buying power from Hawkeye view_margin (read on-chain via
  // simulation — exact, and more reliable than the rate-limited REST trader
  // view). Re-pulled when the targeted subaccount or collateral changes. Falls
  // back to the off-chain estimate when unavailable so the form never blocks.
  const marginView = useMarginView(
    authority,
    marginMode === "isolated" ? isoSubaccountIndex : 0,
    collateral,
  );
  const freeCollateral = marginView.data
    ? marginView.data.freeCollateralUsd
    : Math.max(0, collateral - initialMargin);

  // Compute live unrealized PnL from current mark prices (not stale REST snapshot)
  const unrealizedPnl = useMemo(() => {
    let total = 0;
    for (const pos of positions) {
      const mark = markPricesForEntry[pos.symbol] ?? pos.mark_price;
      if (mark > 0 && pos.entry_price > 0) {
        const isLong = pos.side.toLowerCase() === "long";
        total += isLong
          ? (mark - pos.entry_price) * pos.size
          : (pos.entry_price - mark) * pos.size;
      } else {
        total += pos.unrealized_pnl;
      }
    }
    return total;
  }, [positions, markPricesForEntry]);
  const portfolioValue = collateral + unrealizedPnl;

  // TP/SL validation
  const tpValid = useMemo(() => {
    const tp = parseFloat(tpPrice);
    if (!tpPrice || isNaN(tp) || tp <= 0 || !markPrice) return true;
    return side === "buy" ? tp > markPrice : tp < markPrice;
  }, [tpPrice, markPrice, side]);

  const slValid = useMemo(() => {
    const sl = parseFloat(slPrice);
    if (!slPrice || isNaN(sl) || sl <= 0 || !markPrice) return true;
    return side === "buy" ? sl < markPrice : sl > markPrice;
  }, [slPrice, markPrice, side]);

  const lotSize = useMemo(() => 10 ** -(marketConfig?.baseLotsDecimals || 2), [marketConfig]);
  const maxLeverage = selectedMarket?.maxLeverage ?? marketConfig?.maxLeverage ?? 20;

  const POSITION_SAFETY_BUFFER = 0.97;

  // Derive order from collateral + leverage
  const derivedOrder = useMemo(() => {
    const col = parseFloat(collateralInput || "0");
    if (col <= 0 || !markPrice || markPrice <= 0) return null;

    const effectivePrice = (orderType === "limit" && price)
      ? parseFloat(price) : markPrice;
    if (!effectivePrice || effectivePrice <= 0 || isNaN(effectivePrice)) return null;

    const notional = col * leverage;
    const baseSize = notional / effectivePrice;
    const sizeLots = Math.floor(baseSize * POSITION_SAFETY_BUFFER / lotSize);
    if (sizeLots <= 0) return null;

    // Snap to lot grid
    const adjBaseSize = sizeLots * lotSize;
    const adjNotional = adjBaseSize * effectivePrice;

    // Approximate liquidation price (~2.5% maintenance margin ratio)
    const mmr = 0.025;
    const liqPrice = side === "buy"
      ? effectivePrice * (1 - 1 / leverage + mmr)
      : effectivePrice * (1 + 1 / leverage - mmr);

    return {
      collateral: col,
      notional: adjNotional,
      baseSize: adjBaseSize,
      sizeLots,
      effectivePrice,
      liqPrice: leverage > 1 ? liqPrice : null,
    };
  }, [collateralInput, leverage, markPrice, orderType, price, lotSize, side]);

  // Leverage breakpoints
  const leverageBreakpoints = useMemo(() => {
    const pts: number[] = [1];
    const step = Math.max(1, Math.floor(maxLeverage / 4));
    for (let i = step; i < maxLeverage; i += step) {
      if (!pts.includes(i)) pts.push(i);
    }
    if (!pts.includes(maxLeverage)) pts.push(maxLeverage);
    return pts;
  }, [maxLeverage]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!connected || !derivedOrder || orderType === "multi") return;
    if (orderType === "limit" && (!price || parseFloat(price) <= 0)) return;
    if (showTpSl && (!tpValid || !slValid)) return;

    if (collateral <= 0) {
      addToast("error", "No Collateral", "Deposit USDC before trading.");
      return;
    }
    if (derivedOrder.collateral > freeCollateral) {
      addToast("error", "Insufficient Margin", `Need $${derivedOrder.collateral.toFixed(2)} but only $${freeCollateral.toFixed(2)} free (${formatUsd(initialMargin)} locked by open positions). Reduce size or close positions.`);
      return;
    }

    submittingRef.current = true;
    setTxPhase("building");
    try {
      const params: any = {
        symbol: selectedSymbol,
        side: side === "buy" ? "bid" : "ask",
        size_lots: derivedOrder.sizeLots,
      };
      if (orderType === "limit") {
        params.price = parseFloat(price);
      }
      if (showTpSl) {
        const tp = parseFloat(tpPrice);
        const sl = parseFloat(slPrice);
        if (!isNaN(tp) && tp > 0) params.take_profit_price = tp;
        if (!isNaN(sl) && sl > 0) params.stop_loss_price = sl;
      }
      if (marginMode === "isolated") {
        params.collateral_usdc = derivedOrder.collateral;
        const existingIsolatedPos = positions.find(
          (p) => p.symbol === selectedSymbol && p.margin_mode === "isolated"
        );
        params.subaccount_index = existingIsolatedPos?.subaccount_index ?? 1;
        await submitIsolatedOrder(orderType, params, (status) => setTxPhase(status));
      } else {
        await submitOrder(orderType, params, (status) => setTxPhase(status));
        // Persist slider intent for cross-mode display — but ONLY when the
        // order opens or adds to a position in the slider's direction.
        // Reduces, closes, and flips leave the stored pref alone: the
        // slider often sits at its default (1x) when the user submits a
        // reduce, and overwriting would make the remaining position show
        // the wrong leverage until they next open something.
        const existingCrossPos = positions.find(
          (p) => p.symbol === selectedSymbol && p.margin_mode === "cross"
        );
        const existingSide = existingCrossPos?.side.toLowerCase();
        const openingOrAdding =
          !existingCrossPos ||
          (side === "buy" && existingSide === "long") ||
          (side === "sell" && existingSide === "short");
        if (openingOrAdding) {
          setLeveragePref(selectedSymbol, leverage);
        }
      }
      setCollateralInput("");
      setTpPrice("");
      setSlPrice("");
      setShowTpSl(false);
    } catch (e: any) {
      console.error("Order failed:", e);
    } finally {
      setTxPhase("idle");
      submittingRef.current = false;
    }
  };

  const baseDecimals = marketConfig?.baseLotsDecimals || 2;

  // ── Validation ──
  const collateralVal = parseFloat(collateralInput || "0");
  const priceVal = parseFloat(price || "0");
  const needsCollateral = connected && collateralVal <= 0;
  const needsPrice = connected && orderType === "limit" && collateralVal > 0 && (!price || priceVal <= 0);
  const isolatedCollateralExceeded = marginMode === "isolated" && collateralVal > 0 && collateralVal > freeCollateral;

  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!connected) return { ready: false, issues: ["Connect wallet"], buttonLabel: "CONNECT WALLET" };
    if (collateralVal <= 0) issues.push("Enter collateral amount");
    if (orderType === "limit" && (!price || priceVal <= 0)) issues.push("Enter limit price");
    if (collateral <= 0 && collateralVal > 0) issues.push("No deposited collateral");
    if (derivedOrder && derivedOrder.collateral > freeCollateral) issues.push("Insufficient margin");
    if (isolatedCollateralExceeded) issues.push("Collateral exceeds available");
    if (showTpSl && !tpValid) issues.push(`TP must be ${side === "buy" ? "above" : "below"} mark`);
    if (showTpSl && !slValid) issues.push(`SL must be ${side === "buy" ? "below" : "above"} mark`);
    if (!markPrice) issues.push("Waiting for market data");

    const ready = issues.length === 0 && !!derivedOrder;
    let buttonLabel: string;
    if (txPhase !== "idle") {
      buttonLabel = txPhase === "building" ? "BUILDING..." : txPhase === "simulating" ? "SIMULATING..." : txPhase === "signing" ? "SIGNING..." : "SUBMITTING...";
    } else if (ready && derivedOrder) {
      buttonLabel = `${side === "buy" ? "LONG" : "SHORT"} ${derivedOrder.baseSize.toFixed(baseDecimals)} ${selectedSymbol} ≈ $${formatPrice(derivedOrder.notional)}`;
    } else if (issues.length > 0) {
      buttonLabel = issues[0];
    } else {
      buttonLabel = side === "buy" ? `BUY ${selectedSymbol}` : `SELL ${selectedSymbol}`;
    }
    return { ready, issues, buttonLabel };
  }, [connected, collateralVal, priceVal, price, orderType, collateral, freeCollateral, derivedOrder, showTpSl, tpValid, slValid, side, markPrice, txPhase, baseDecimals, selectedSymbol, isolatedCollateralExceeded]);

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex flex-col gap-3 p-3">
          {/* Order type tabs */}
          <div className="flex border-b border-ember-border/50">
            {(["limit", "market", "multi"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={clsx(
                  "px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  orderType === t
                    ? "border-b border-ember-orange text-text-primary"
                    : "text-text-secondary/60 hover:text-text-secondary"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Multi-order panel */}
          {orderType === "multi" && <MultiOrderPanel />}

          {/* Side toggle */}
          {orderType !== "multi" && <><div className="grid grid-cols-2 gap-px bg-ember-border">
            <button
              onClick={() => setSide("buy")}
              className={clsx(
                "py-2 font-mono text-[11px] font-medium tracking-wider transition-all duration-150",
                side === "buy"
                  ? "bg-ember-green text-ember-black"
                  : "bg-surface-l2 text-text-secondary/60 hover:text-text-secondary"
              )}
            >
              BUY / LONG
            </button>
            <button
              onClick={() => setSide("sell")}
              className={clsx(
                "py-2 font-mono text-[11px] font-medium tracking-wider transition-all duration-150",
                side === "sell"
                  ? "bg-ember-red text-white"
                  : "bg-surface-l2 text-text-secondary/60 hover:text-text-secondary"
              )}
            >
              SELL / SHORT
            </button>
          </div>

          {/* Margin mode toggle — cross hidden for isolatedOnly markets */}
          <div className={clsx("gap-px bg-ember-border", isIsolatedOnly ? "grid grid-cols-1" : "grid grid-cols-2")}>
            {(["cross", "isolated"] as const).filter((mode) => !(mode === "cross" && isIsolatedOnly)).map((mode) => (
              <button
                key={mode}
                onClick={() => setMarginMode(mode)}
                className={clsx(
                  "py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all duration-150",
                  marginMode === mode
                    ? "bg-ember-orange text-white"
                    : "bg-surface-l2 text-text-secondary/60 hover:text-text-secondary"
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Collateral input (USDC) */}
          <div>
            <label className="mb-1 block text-[10px] tracking-wider text-text-secondary/70 uppercase">
              Collateral
            </label>
            <div className="relative">
              <input
                type="number"
                value={collateralInput}
                onChange={(e) => setCollateralInput(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className={clsx(
                  "w-full border bg-surface-l2 py-2 pl-3 pr-12 font-mono text-[11px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none transition-colors",
                  isolatedCollateralExceeded ? "border-ember-red ring-1 ring-ember-red/50 focus:border-ember-red" :
                  needsCollateral ? "border-ember-orange/50 focus:border-ember-orange" : "border-ember-border focus:border-ember-orange/60"
                )}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-secondary/60">
                USDC
              </span>
            </div>
            <div className="mt-1 flex gap-1">
              {[10, 25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => {
                    if (freeCollateral > 0) {
                      setCollateralInput(((freeCollateral * pct) / 100).toFixed(2));
                    }
                  }}
                  className="flex-1 py-1 font-mono text-[9px] text-text-secondary/60 bg-surface-l2 border border-ember-border/30 hover:text-ember-orange hover:border-ember-orange/40 transition-colors"
                >
                  {pct}%
                </button>
              ))}
            </div>
            {isolatedCollateralExceeded && (
              <span className="mt-0.5 block text-[9px] text-ember-red">
                Exceeds available collateral ({formatUsd(freeCollateral)})
              </span>
            )}
          </div>

          {/* Price input (limit only) */}
          {orderType === "limit" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={clsx(
                  "text-[10px] tracking-wider uppercase",
                  needsPrice ? "text-ember-orange" : "text-text-secondary/70"
                )}>
                  Price {needsPrice && <span className="normal-case text-ember-orange/80">— required</span>}
                </label>
                {markPrice > 0 && (
                  <button
                    onClick={() => setPrice(markPrice.toFixed(2))}
                    className="font-mono text-[9px] text-ember-orange/70 hover:text-ember-orange transition-colors"
                  >
                    Mark ${formatPrice(markPrice)}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={markPrice > 0 ? formatPrice(markPrice) : "0.00"}
                  min="0"
                  step="0.01"
                  className={clsx(
                    "w-full border bg-surface-l2 py-2 pl-3 pr-12 font-mono text-[11px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none transition-colors",
                    needsPrice ? "border-ember-orange/50 focus:border-ember-orange" : "border-ember-border focus:border-ember-orange/60"
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-secondary/60">
                  USD
                </span>
              </div>
            </div>
          )}

          {/* Leverage slider with +/- buttons and breakpoints */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] tracking-wider text-text-secondary/70 uppercase">
                Leverage
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setLeverage((l) => Math.max(1, l - 1))}
                  className="h-5 w-5 flex items-center justify-center border border-ember-border bg-surface-l2 font-mono text-[11px] text-text-secondary hover:text-ember-orange hover:border-ember-orange/40 transition-colors"
                >
                  -
                </button>
                <span className="font-mono text-[11px] text-ember-orange min-w-[28px] text-center">{leverage}x</span>
                <button
                  onClick={() => setLeverage((l) => Math.min(maxLeverage, l + 1))}
                  className="h-5 w-5 flex items-center justify-center border border-ember-border bg-surface-l2 font-mono text-[11px] text-text-secondary hover:text-ember-orange hover:border-ember-orange/40 transition-colors"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              min={1}
              max={maxLeverage}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full accent-ember-orange"
            />
            <div className="flex justify-between mt-0.5">
              {leverageBreakpoints.map((bp) => (
                <button
                  key={bp}
                  onClick={() => setLeverage(bp)}
                  className={clsx(
                    "text-[9px] font-mono transition-colors",
                    leverage === bp ? "text-ember-orange" : "text-text-secondary/50 hover:text-text-secondary"
                  )}
                >
                  {bp}x
                </button>
              ))}
            </div>
          </div>

          {/* TP/SL toggle + inputs — market orders only (limit+TP/SL unsupported by Phoenix) */}
          {orderType === "market" && <div>
            <button
              onClick={() => setShowTpSl(!showTpSl)}
              className="flex w-full items-center justify-between py-1"
            >
              <span className="text-[10px] tracking-wider text-text-secondary/70 uppercase">
                TP / SL
              </span>
              <div className={clsx(
                "h-3 w-6 rounded-full transition-colors",
                showTpSl ? "bg-ember-orange" : "bg-ember-border"
              )}>
                <div className={clsx(
                  "h-3 w-3 rounded-full bg-white transition-transform",
                  showTpSl ? "translate-x-3" : "translate-x-0"
                )} />
              </div>
            </button>

            {showTpSl && (
              <div className="mt-2 flex flex-col gap-2">
                {/* Take Profit */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] tracking-wider text-text-secondary/70 uppercase">
                      Take Profit
                    </label>
                    {tpPrice && markPrice > 0 && (
                      <span className="font-mono text-[10px] text-ember-green">
                        Est. PnL: +${formatPrice(Math.abs((parseFloat(tpPrice) - markPrice) * (derivedOrder?.baseSize || 0)))}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={tpPrice}
                      onChange={(e) => setTpPrice(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className={clsx(
                        "w-full border bg-surface-l2 py-2 pl-3 pr-12 font-mono text-[11px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none transition-colors",
                        !tpValid ? "border-ember-red focus:border-ember-red" : "border-ember-border focus:border-ember-orange/60"
                      )}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-secondary/60">
                      USD
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    {[2.5, 5, 10].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => {
                          if (markPrice > 0) {
                            const offset = markPrice * (pct / 100);
                            const tp = side === "buy" ? markPrice + offset : markPrice - offset;
                            setTpPrice(tp.toFixed(2));
                          }
                        }}
                        className="flex-1 py-1 font-mono text-[9px] text-text-secondary/60 bg-surface-l2 border border-ember-border/30 hover:text-ember-green hover:border-ember-green/40 transition-colors"
                      >
                        +{pct}%
                      </button>
                    ))}
                  </div>
                  {!tpValid && (
                    <span className="mt-0.5 text-[9px] text-ember-red">
                      TP must be {side === "buy" ? "above" : "below"} mark price
                    </span>
                  )}
                </div>

                {/* Stop Loss */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] tracking-wider text-text-secondary/70 uppercase">
                      Stop Loss
                    </label>
                    {slPrice && markPrice > 0 && (
                      <span className="font-mono text-[10px] text-ember-red">
                        Est. PnL: -${formatPrice(Math.abs((parseFloat(slPrice) - markPrice) * (derivedOrder?.baseSize || 0)))}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={slPrice}
                      onChange={(e) => setSlPrice(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className={clsx(
                        "w-full border bg-surface-l2 py-2 pl-3 pr-12 font-mono text-[11px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none transition-colors",
                        !slValid ? "border-ember-red focus:border-ember-red" : "border-ember-border focus:border-ember-orange/60"
                      )}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-secondary/60">
                      USD
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    {[2.5, 5, 10].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => {
                          if (markPrice > 0) {
                            const offset = markPrice * (pct / 100);
                            const sl = side === "buy" ? markPrice - offset : markPrice + offset;
                            setSlPrice(sl.toFixed(2));
                          }
                        }}
                        className="flex-1 py-1 font-mono text-[9px] text-text-secondary/60 bg-surface-l2 border border-ember-border/30 hover:text-ember-red hover:border-ember-red/40 transition-colors"
                      >
                        -{pct}%
                      </button>
                    ))}
                  </div>
                  {!slValid && (
                    <span className="mt-0.5 text-[9px] text-ember-red">
                      SL must be {side === "buy" ? "below" : "above"} mark price
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>}

          {/* Order summary */}
          {derivedOrder && (
            <div className="flex flex-col gap-1 border border-ember-border/30 bg-surface-l2/30 p-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-text-secondary/70">Position Size</span>
                <span className="font-mono text-[10px] text-text-primary">
                  {derivedOrder.baseSize.toFixed(baseDecimals)} {selectedSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-text-secondary/70">Notional Value</span>
                <span className="font-mono text-[10px] text-text-primary">${formatPrice(derivedOrder.notional)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-text-secondary/70">Est. Entry Price</span>
                <span className="font-mono text-[10px] text-text-primary">${formatPrice(derivedOrder.effectivePrice)}</span>
              </div>
              {derivedOrder.liqPrice !== null && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-text-secondary/70">Est. Liq. Price</span>
                  <span className="font-mono text-[10px] text-ember-red">${formatPrice(derivedOrder.liqPrice)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[10px] text-text-secondary/70">Collateral</span>
                <span className="font-mono text-[10px] text-text-primary">${formatPrice(derivedOrder.collateral)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-text-secondary/70">Eff. Leverage</span>
                <span className="font-mono text-[10px] text-ember-orange">
                  {(derivedOrder.notional / derivedOrder.collateral).toFixed(1)}x
                </span>
              </div>
              {marketConfig && (marketConfig.takerFee > 0 || marketConfig.makerFee > 0) && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-text-secondary/70">
                    Est. Fee ({orderType === "market" ? "Taker" : "Maker"})
                  </span>
                  <span className="font-mono text-[10px] text-text-secondary">
                    ${formatPrice(derivedOrder.notional * (orderType === "market" ? marketConfig.takerFee : marketConfig.makerFee))}
                    <span className="text-text-secondary/50 ml-1">
                      ({((orderType === "market" ? marketConfig.takerFee : marketConfig.makerFee) * 100).toFixed(2)}%)
                    </span>
                  </span>
                </div>
              )}
              {flight?.active && flight.feeBps > 0 && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-text-secondary/70">Builder Fee</span>
                  <span className="font-mono text-[10px] text-text-secondary">
                    ${formatPrice(derivedOrder.notional * (flight.feeBps / 10_000))}
                    <span className="text-text-secondary/50 ml-1">({(flight.feeBps / 100).toFixed(2)}%)</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[10px] text-text-secondary/70">Mode</span>
                <span className={clsx(
                  "font-mono text-[10px]",
                  marginMode === "isolated" ? "text-ember-orange" : "text-text-secondary"
                )}>
                  {marginMode.toUpperCase()}
                </span>
              </div>
              {showTpSl && tpPrice && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-text-secondary/70">TP</span>
                  <span className="font-mono text-[10px] text-ember-green">
                    ${formatPrice(parseFloat(tpPrice))}
                    {markPrice > 0 && (
                      <span className="text-text-secondary/50 ml-1">
                        ({side === "buy" ? "+" : "-"}{((Math.abs(parseFloat(tpPrice) - markPrice) / markPrice) * 100).toFixed(1)}%)
                      </span>
                    )}
                  </span>
                </div>
              )}
              {showTpSl && slPrice && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-text-secondary/70">SL</span>
                  <span className="font-mono text-[10px] text-ember-red">
                    ${formatPrice(parseFloat(slPrice))}
                    {markPrice > 0 && (
                      <span className="text-text-secondary/50 ml-1">
                        ({side === "buy" ? "-" : "+"}{((Math.abs(parseFloat(slPrice) - markPrice) / markPrice) * 100).toFixed(1)}%)
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Submit button */}
          {connected && activationState !== "active" && !fetchingAccount ? (
            activationState === "uninitialized" ? (
              <button
                onClick={() => setShowDepositModal(true)}
                className="flex w-full items-center justify-center py-2.5 font-mono text-[11px] font-medium tracking-wider bg-ember-orange text-white hover:brightness-110 active:brightness-95 transition-all duration-150"
              >
                DEPOSIT TO ACTIVATE
              </button>
            ) : (
              <button
                disabled
                className="flex w-full items-center justify-center py-2.5 font-mono text-[11px] font-medium tracking-wider bg-surface-l2 text-text-secondary/50 cursor-not-allowed"
              >
                ACCOUNT NOT ACTIVATED (flags={activationFlags})
              </button>
            )
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!validation.ready || txPhase !== "idle"}
              className={clsx(
                "flex w-full items-center justify-center gap-2 py-2.5 font-mono text-[11px] font-medium tracking-wider transition-all duration-150",
                !validation.ready
                  ? "bg-surface-l2 text-text-secondary/50 cursor-not-allowed"
                  : side === "buy"
                    ? "bg-ember-green text-ember-black hover:brightness-110 active:brightness-95"
                    : "bg-ember-red text-white hover:brightness-110 active:brightness-95",
                txPhase !== "idle" && "opacity-70 pointer-events-none"
              )}
            >
              {txPhase !== "idle" && (
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
                  <path d="M8 2a6 6 0 014.9 9.4" />
                </svg>
              )}
              {validation.buttonLabel}
            </button>
          )}
          </>}
        </div>

        {/* Account info — shown when wallet connected */}
        {connected && (
          <div className="mt-auto border-t border-ember-border/50 p-3">
            {activationState !== "active" && !fetchingAccount ? (
              <div className="flex items-center gap-2 rounded border border-ember-orange/30 bg-ember-orange/10 p-2">
                <svg className="h-3.5 w-3.5 flex-shrink-0 text-ember-orange" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 4v4M8 12h.01M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
                </svg>
                <span className="text-[10px] leading-tight text-ember-orange">
                  {activationState === "uninitialized"
                    ? "Connect wallet and deposit USDC to activate your Phoenix account."
                    : `Your Phoenix account is not fully activated (flags=${activationFlags}). Contact support or try depositing USDC.`}
                </span>
              </div>
            ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">Collateral</span>
                <span className="font-mono text-[11px] text-text-primary">{formatUsd(collateral)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-ember-orange/80">Available</span>
                <span className="font-mono text-[11px] text-ember-orange">{formatUsd(freeCollateral)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">Portfolio</span>
                <span className="font-mono text-[11px] text-text-secondary">{formatUsd(portfolioValue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">Init Margin</span>
                <span className="font-mono text-[11px] text-text-secondary">{formatUsd(initialMargin)}</span>
              </div>
              {collateral > 0 && (() => {
                const marginPct = (initialMargin / collateral) * 100;
                const barColor = marginPct > 80 ? "bg-ember-red" : marginPct > 50 ? "bg-ember-orange" : "bg-ember-green";
                return (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">Margin Used</span>
                      <span className={clsx(
                        "font-mono text-[11px]",
                        marginPct > 80 ? "text-ember-red" : marginPct > 50 ? "text-ember-orange" : "text-ember-green"
                      )}>
                        {marginPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1 w-full bg-surface-l2 overflow-hidden">
                      <div
                        className={clsx("h-full transition-all duration-300", barColor)}
                        style={{ width: `${Math.min(marginPct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">Unreal. PnL</span>
                <span className={clsx(
                  "font-mono text-[11px]",
                  unrealizedPnl >= 0 ? "text-ember-green" : "text-ember-red"
                )}>
                  {unrealizedPnl >= 0 ? "+" : ""}{formatUsd(unrealizedPnl)}
                </span>
              </div>
              {riskState && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-text-secondary/70">Risk</span>
                  <span className={clsx(
                    "font-mono text-[10px]",
                    riskState === "Healthy" || riskState === "Active" || riskState === "ZeroCollateralNoPositions"
                      ? "text-ember-green"
                      : riskState === "BeingLiquidated" || riskState === "Liquidatable"
                        ? "text-ember-red"
                        : "text-yellow-500"
                  )}>
                    {riskState === "ZeroCollateralNoPositions" ? "No Positions" : riskState}
                  </span>
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </div>
      {showDepositModal && <DepositWithdraw onClose={() => setShowDepositModal(false)} />}
    </>
  );
}
