"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useMultiOrderStore, MultiOrderRow } from "@/stores/multiOrderStore";
import { useMarketStore } from "@/stores/marketStore";
import { useOrderbookStore } from "@/stores/orderbookStore";
import { useStatsStore } from "@/stores/statsStore";
import { useTraderStore } from "@/stores/traderStore";
import { useTransactionBuilder } from "@/hooks/useTransactionBuilder";
import { useToastStore } from "@/stores/toastStore";
import { formatPrice, formatUsd } from "@/lib/format";
import { TxStatus } from "@/lib/solana";
import clsx from "clsx";

const MAX_ORDERS = 10;

export function MultiOrderPanel() {
  const rows = useMultiOrderStore((s) => s.rows);
  const gridParams = useMultiOrderStore((s) => s.gridParams);
  const addRow = useMultiOrderStore((s) => s.addRow);
  const removeRow = useMultiOrderStore((s) => s.removeRow);
  const updateRow = useMultiOrderStore((s) => s.updateRow);
  const clearRows = useMultiOrderStore((s) => s.clearRows);
  const setFocusedRowId = useMultiOrderStore((s) => s.setFocusedRowId);
  const setGridParams = useMultiOrderStore((s) => s.setGridParams);
  const generateGrid = useMultiOrderStore((s) => s.generateGrid);
  const fillPrice = useMultiOrderStore((s) => s.fillPrice);

  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const marketConfig = useMarketStore((s) => s.marketConfig);
  const markPrice = useStatsStore((s) => s.stats?.mark_price) ?? 0;
  const collateral = useTraderStore((s) => s.collateral);
  const initialMargin = useTraderStore((s) => s.initialMargin);
  const freeCollateral = Math.max(0, collateral - initialMargin);
  const { submitMultiLimitOrders, connected } = useTransactionBuilder();
  const addToast = useToastStore((s) => s.addToast);

  const [mode, setMode] = useState<"manual" | "grid">("manual");
  const [txPhase, setTxPhase] = useState<"idle" | "building" | "simulating" | "signing" | "submitting">("idle");

  const lotSize = useMemo(() => 10 ** -(marketConfig?.baseLotsDecimals || 2), [marketConfig]);

  // Set fillMode on orderbookStore when this panel is mounted
  const setFillMode = useOrderbookStore((s) => s.setFillMode);
  useEffect(() => {
    setFillMode("multi");
    return () => setFillMode("single");
  }, [setFillMode]);

  // Listen for orderbook click-to-fill in multi mode
  const obFillPrice = useOrderbookStore((s) => s.fillPrice);
  const setObFillPrice = useOrderbookStore((s) => s.setFillPrice);
  useEffect(() => {
    if (obFillPrice !== null) {
      fillPrice(obFillPrice);
      setObFillPrice(null);
    }
  }, [obFillPrice, fillPrice, setObFillPrice]);

  // Clear rows when market changes
  useEffect(() => {
    clearRows();
  }, [selectedSymbol, clearRows]);

  // Pre-fill grid center price from mark price
  useEffect(() => {
    if (markPrice > 0 && !gridParams.centerPrice) {
      setGridParams({ centerPrice: markPrice.toFixed(2) });
    }
  }, [markPrice, gridParams.centerPrice, setGridParams]);

  // Summary stats
  const summary = useMemo(() => {
    let bidCount = 0, askCount = 0, totalSizeLots = 0, totalNotional = 0;
    const valid: MultiOrderRow[] = [];

    for (const row of rows) {
      const p = parseFloat(row.price);
      const s = parseInt(row.sizeLots, 10);
      if (!p || p <= 0 || !s || s <= 0) continue;
      valid.push(row);
      if (row.side === "bid") bidCount++;
      else askCount++;
      totalSizeLots += s;
      totalNotional += s * lotSize * p;
    }

    return { bidCount, askCount, totalSizeLots, totalNotional, valid, total: valid.length };
  }, [rows, lotSize]);

  const handleSubmit = useCallback(async () => {
    if (!connected || summary.total === 0 || txPhase !== "idle") return;

    if (collateral <= 0) {
      addToast("error", "No Collateral", "Deposit USDC before trading.");
      return;
    }

    const bids = summary.valid
      .filter((r) => r.side === "bid")
      .map((r) => ({ price: parseFloat(r.price), size_lots: parseInt(r.sizeLots, 10) }));
    const asks = summary.valid
      .filter((r) => r.side === "ask")
      .map((r) => ({ price: parseFloat(r.price), size_lots: parseInt(r.sizeLots, 10) }));

    setTxPhase("building");
    try {
      await submitMultiLimitOrders(selectedSymbol, bids, asks, (status: TxStatus) => setTxPhase(status));
      clearRows();
    } catch (e: any) {
      console.error("Multi-order failed:", e);
    } finally {
      setTxPhase("idle");
    }
  }, [connected, summary, txPhase, collateral, selectedSymbol, submitMultiLimitOrders, clearRows, addToast]);

  const handleGenerateGrid = useCallback(() => {
    generateGrid(markPrice, lotSize);
  }, [generateGrid, markPrice, lotSize]);

  return (
    <div className="flex flex-col gap-2">
      {/* Mode toggle */}
      <div className="flex border-b border-ember-border/30">
        {(["manual", "grid"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx(
              "flex-1 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors",
              mode === m
                ? "border-b border-ember-orange text-text-primary"
                : "text-text-secondary/50 hover:text-text-secondary"
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Grid mode controls */}
      {mode === "grid" && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-0.5 block text-[9px] tracking-wider text-text-secondary/60 uppercase">Center</label>
              <input
                type="number"
                value={gridParams.centerPrice}
                onChange={(e) => setGridParams({ centerPrice: e.target.value })}
                placeholder={markPrice > 0 ? markPrice.toFixed(2) : "0.00"}
                className="w-full border border-ember-border bg-surface-l2 py-1 px-2 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-ember-orange/60"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[9px] tracking-wider text-text-secondary/60 uppercase">Spread %</label>
              <input
                type="number"
                value={gridParams.spreadPct}
                onChange={(e) => setGridParams({ spreadPct: e.target.value })}
                placeholder="1"
                min="0.01"
                step="0.1"
                className="w-full border border-ember-border bg-surface-l2 py-1 px-2 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-ember-orange/60"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-0.5 block text-[9px] tracking-wider text-text-secondary/60 uppercase">Orders/Side</label>
              <input
                type="number"
                value={gridParams.ordersPerSide}
                onChange={(e) => setGridParams({ ordersPerSide: Math.max(1, Math.min(5, parseInt(e.target.value) || 1)) })}
                min={1}
                max={5}
                className="w-full border border-ember-border bg-surface-l2 py-1 px-2 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-ember-orange/60"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[9px] tracking-wider text-text-secondary/60 uppercase">Size (lots)</label>
              <input
                type="number"
                value={gridParams.sizePerOrder}
                onChange={(e) => setGridParams({ sizePerOrder: e.target.value })}
                placeholder="1"
                min={1}
                className="w-full border border-ember-border bg-surface-l2 py-1 px-2 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-ember-orange/60"
              />
            </div>
          </div>
          <button
            onClick={handleGenerateGrid}
            disabled={!gridParams.sizePerOrder || parseFloat(gridParams.sizePerOrder) <= 0}
            className={clsx(
              "w-full py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
              gridParams.sizePerOrder && parseFloat(gridParams.sizePerOrder) > 0
                ? "bg-ember-orange/20 text-ember-orange border border-ember-orange/40 hover:bg-ember-orange/30"
                : "bg-surface-l2 text-text-secondary/40 border border-ember-border cursor-not-allowed"
            )}
          >
            Generate Grid
          </button>
        </div>
      )}

      {/* Order rows */}
      <div className="flex flex-col gap-1">
        {rows.length === 0 && (
          <div className="py-4 text-center text-[10px] text-text-secondary/50">
            {mode === "manual" ? "Click + to add orders, or click orderbook prices" : "Configure grid and click Generate"}
          </div>
        )}
        {rows.map((row) => (
          <OrderRowInput
            key={row.id}
            row={row}
            lotSize={lotSize}
            onUpdate={updateRow}
            onRemove={removeRow}
            onFocus={() => setFocusedRowId(row.id)}
          />
        ))}
      </div>

      {/* Add row button (manual mode) */}
      {mode === "manual" && rows.length < MAX_ORDERS && (
        <button
          onClick={() => addRow()}
          className="w-full py-1 border border-dashed border-ember-border/50 text-[10px] text-text-secondary/50 hover:text-ember-orange hover:border-ember-orange/40 transition-colors"
        >
          + Add Order ({rows.length}/{MAX_ORDERS})
        </button>
      )}

      {/* Clear button */}
      {rows.length > 0 && (
        <button
          onClick={clearRows}
          className="w-full py-1 text-[9px] text-text-secondary/40 hover:text-ember-red transition-colors"
        >
          Clear All
        </button>
      )}

      {/* Summary */}
      {summary.total > 0 && (
        <div className="flex flex-col gap-1 border border-ember-border/30 bg-surface-l2/30 p-2">
          <div className="flex justify-between">
            <span className="text-[10px] text-text-secondary/70">Orders</span>
            <span className="font-mono text-[10px] text-text-primary">
              {summary.bidCount > 0 && <span className="text-ember-green">{summary.bidCount}B</span>}
              {summary.bidCount > 0 && summary.askCount > 0 && " / "}
              {summary.askCount > 0 && <span className="text-ember-red">{summary.askCount}S</span>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-text-secondary/70">Total Size</span>
            <span className="font-mono text-[10px] text-text-primary">
              {(summary.totalSizeLots * lotSize).toFixed(marketConfig?.baseLotsDecimals || 2)} {selectedSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-text-secondary/70">Est. Notional</span>
            <span className="font-mono text-[10px] text-text-primary">${formatPrice(summary.totalNotional)}</span>
          </div>
          {marketConfig && marketConfig.makerFee > 0 && (
            <div className="flex justify-between">
              <span className="text-[10px] text-text-secondary/70">Est. Fees (Maker)</span>
              <span className="font-mono text-[10px] text-text-secondary">
                ${formatPrice(summary.totalNotional * marketConfig.makerFee)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!connected || summary.total === 0 || txPhase !== "idle"}
        className={clsx(
          "flex w-full items-center justify-center gap-2 py-2.5 font-mono text-[11px] font-medium tracking-wider transition-all duration-150",
          !connected || summary.total === 0
            ? "bg-surface-l2 text-text-secondary/50 cursor-not-allowed"
            : "bg-ember-orange text-white hover:brightness-110 active:brightness-95",
          txPhase !== "idle" && "opacity-70 pointer-events-none"
        )}
      >
        {txPhase !== "idle" && (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
            <path d="M8 2a6 6 0 014.9 9.4" />
          </svg>
        )}
        {txPhase !== "idle"
          ? txPhase === "building" ? "BUILDING..." : txPhase === "simulating" ? "SIMULATING..." : txPhase === "signing" ? "SIGNING..." : "SUBMITTING..."
          : summary.total === 0
            ? "ADD ORDERS"
            : `SUBMIT ${summary.total} ORDER${summary.total !== 1 ? "S" : ""}`}
      </button>

      {/* Free collateral */}
      {connected && (
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-text-secondary/50">Available</span>
          <span className="font-mono text-[10px] text-ember-orange">{formatUsd(freeCollateral)}</span>
        </div>
      )}
    </div>
  );
}

// ── Individual order row ──

interface OrderRowInputProps {
  row: MultiOrderRow;
  lotSize: number;
  onUpdate: (id: string, updates: Partial<Omit<MultiOrderRow, "id">>) => void;
  onRemove: (id: string) => void;
  onFocus: () => void;
}

function OrderRowInput({ row, lotSize, onUpdate, onRemove, onFocus }: OrderRowInputProps) {
  const p = parseFloat(row.price);
  const s = parseInt(row.sizeLots, 10);
  const isValid = p > 0 && s > 0;

  return (
    <div className="flex items-center gap-1">
      {/* Side toggle */}
      <button
        onClick={() => onUpdate(row.id, { side: row.side === "bid" ? "ask" : "bid" })}
        className={clsx(
          "flex-shrink-0 w-6 h-6 flex items-center justify-center font-mono text-[10px] font-bold transition-colors",
          row.side === "bid"
            ? "bg-ember-green/20 text-ember-green border border-ember-green/30"
            : "bg-ember-red/20 text-ember-red border border-ember-red/30"
        )}
      >
        {row.side === "bid" ? "B" : "S"}
      </button>

      {/* Price input */}
      <input
        type="number"
        value={row.price}
        onChange={(e) => onUpdate(row.id, { price: e.target.value })}
        onFocus={onFocus}
        placeholder="Price"
        min="0"
        step="0.01"
        className="w-0 flex-1 border border-ember-border bg-surface-l2 py-1 px-1.5 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-ember-orange/60"
      />

      {/* Size input */}
      <input
        type="number"
        value={row.sizeLots}
        onChange={(e) => onUpdate(row.id, { sizeLots: e.target.value })}
        onFocus={onFocus}
        placeholder="Lots"
        min="1"
        step="1"
        className="w-0 flex-[0.6] border border-ember-border bg-surface-l2 py-1 px-1.5 font-mono text-[10px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-ember-orange/60"
      />

      {/* Remove button */}
      <button
        onClick={() => onRemove(row.id)}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-text-secondary/40 hover:text-ember-red transition-colors"
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
