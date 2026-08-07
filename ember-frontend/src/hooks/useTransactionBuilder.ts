"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { api } from "@/lib/api";
import { deserializeInstructions, buildAndSignTransaction, TxStatus, TxResult } from "@/lib/solana";
import { useTraderStore } from "@/stores/traderStore";
import { useToastStore } from "@/stores/toastStore";

const TX_TIMEOUT_MS = 30_000;

const STATUS_LABELS: Record<TxStatus, string> = {
  simulating: "Simulating...",
  signing: "Waiting for Signature...",
  submitting: "Submitting to Solana...",
};

function decodeOrderError(raw: string): string {
  const is6001 = raw.includes("Custom:6001") || raw.includes('"Custom":6001');
  if (is6001 && raw.includes("simulation failed")) {
    return "Insufficient margin for this position size. Reduce size or add collateral.";
  }
  if (is6001 && raw.includes("failed on-chain")) {
    return "Transaction was blocked because exchange prices updated during signing. Please retry.";
  }
  if (is6001) {
    return "Transaction rejected (Custom:6001). This may be a margin issue or a signing conflict — please retry.";
  }
  if (raw.includes("InsufficientFunds")) {
    return "Insufficient funds: deposit more USDC before trading.";
  }
  return raw;
}

function formatOrderSummary(type: "market" | "limit", params: any): string {
  const side = params.side === "bid" ? "Long" : "Short";
  const symbol = params.symbol || "?";
  const parts: string[] = [side, symbol];
  if (params.collateral_usdc) parts.push(`$${params.collateral_usdc.toFixed(2)} collateral`);
  if (type === "limit" && params.price) parts.push(`@ $${Number(params.price).toLocaleString()}`);
  return parts.join(" · ");
}

// Trade-attempt guard for the pre-warm onboarding flow: if the connected wallet
// has no Phoenix account yet, an order can't land. Returns a user-facing message
// (so the caller surfaces it and aborts) or null when the account is ready.
// Provisioning runs automatically on connect (useOnboardingProvision); this just
// covers the case where the user tries to trade before it finishes.
function accountSetupBlock(): string | null {
  const { noAccount, provisioning } = useTraderStore.getState();
  if (!noAccount) return null;
  switch (provisioning) {
    case "signing":
    case "activating":
    case "waiting":
      return "Your Phoenix account is still being set up (~15s) — your order will go through once it's ready.";
    case "ready":
      return "Your account is finalizing on-chain — try again in a few seconds.";
    case "error":
      return "Account setup didn't finish. Retry it from the prompt, then place your order.";
    default:
      return "Setting up your Phoenix account… one moment.";
  }
}

export function useTransactionBuilder() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const addToast = useToastStore((s) => s.addToast);
  const updateToast = useToastStore((s) => s.updateToast);
  const [isPending, setIsPending] = useState(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acquireLock = useCallback((): boolean => {
    if (isPending) return false;
    setIsPending(true);
    pendingTimerRef.current = setTimeout(() => {
      setIsPending(false);
      pendingTimerRef.current = null;
    }, TX_TIMEOUT_MS);
    return true;
  }, [isPending]);

  const releaseLock = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setIsPending(false);
  }, []);

  // Refresh trader data from REST after a confirmed transaction
  const refreshTraderData = useCallback(async () => {
    if (!publicKey) return;
    try {
      const data = await api.getTrader(publicKey.toBase58());
      if (data?.accounts?.length > 0) {
        useTraderStore.getState().setAccounts(data.accounts);
      }
    } catch (e) {
      console.debug("Post-tx trader refresh failed:", e);
    }
  }, [publicKey]);

  const submitOrder = useCallback(
    async (type: "market" | "limit", params: any, onStatus?: (status: TxStatus) => void): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");
      const setupBlock = accountSetupBlock();
      if (setupBlock) {
        addToast("info", "Setting up your account", setupBlock);
        throw new Error(setupBlock);
      }
      if (!acquireLock()) throw new Error("Transaction already in progress");

      const label = type === "market" ? "Market Order" : "Limit Order";
      const summary = formatOrderSummary(type, params);
      const toastId = addToast("loading", `Building ${label}`, summary);

      try {
        const builder = type === "market" ? api.buildMarketOrder : api.buildLimitOrder;
        const response = await builder({ ...params, authority: publicKey.toBase58() });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => {
            onStatus?.(status);
            updateToast(toastId, { title: STATUS_LABELS[status] });
          }
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: `${label} Confirmed`, detail: summary, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: `${label} Expired`, detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: `${label} Failed`, detail: decodeOrderError(e?.message ?? "") });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const cancelOrders = useCallback(
    async (symbol: string, orderIds: { price: number; order_sequence_number: number }[], subaccountIndex?: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      if (!acquireLock()) throw new Error("Transaction already in progress");

      const toastId = addToast("loading", "Building Cancel", `${orderIds.length} order${orderIds.length !== 1 ? "s" : ""} on ${symbol}`);

      try {
        const response = await api.buildCancelOrders({
          authority: publicKey.toBase58(),
          symbol,
          order_ids: orderIds,
          ...(subaccountIndex !== undefined && { subaccount_index: subaccountIndex }),
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Order Cancelled", detail: `${orderIds.length} order${orderIds.length !== 1 ? "s" : ""} on ${symbol}`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Cancel Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Cancel Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const deposit = useCallback(
    async (amountUsdc: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      if (!acquireLock()) throw new Error("Transaction already in progress");

      const toastId = addToast("loading", "Building Deposit", `$${amountUsdc.toFixed(2)} USDC`);

      try {
        const response = await api.buildDeposit({
          authority: publicKey.toBase58(),
          amount_usdc: amountUsdc,
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Deposit Confirmed", detail: `$${amountUsdc.toFixed(2)} USDC deposited`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Deposit Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Deposit Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const withdraw = useCallback(
    async (amountUsdc: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      if (!acquireLock()) throw new Error("Transaction already in progress");

      const toastId = addToast("loading", "Building Withdrawal", `$${amountUsdc.toFixed(2)} USDC`);

      try {
        const response = await api.buildWithdraw({
          authority: publicKey.toBase58(),
          amount_usdc: amountUsdc,
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Withdrawal Confirmed", detail: `$${amountUsdc.toFixed(2)} USDC withdrawn`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Withdrawal Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Withdrawal Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const submitIsolatedOrder = useCallback(
    async (type: "market" | "limit", params: any, onStatus?: (status: TxStatus) => void): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");
      const setupBlock = accountSetupBlock();
      if (setupBlock) {
        addToast("info", "Setting up your account", setupBlock);
        throw new Error(setupBlock);
      }
      if (!acquireLock()) throw new Error("Transaction already in progress");

      const label = type === "market" ? "Isolated Market Order" : "Isolated Limit Order";
      const summary = formatOrderSummary(type, params) + " · Isolated";
      const toastId = addToast("loading", `Building ${label}`, summary);

      try {
        const builder = type === "market" ? api.buildIsolatedMarketOrder : api.buildIsolatedLimitOrder;
        const response = await builder({ ...params, authority: publicKey.toBase58() });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => {
            onStatus?.(status);
            updateToast(toastId, { title: STATUS_LABELS[status] });
          }
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: `${label} Confirmed`, detail: summary, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: `${label} Expired`, detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: `${label} Failed`, detail: decodeOrderError(e?.message ?? "") });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const transferCollateral = useCallback(
    async (fromSubaccountIndex: number, toSubaccountIndex: number, amountUsdc: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      const fromLabel = fromSubaccountIndex === 0 ? "Cross" : `Isolated #${fromSubaccountIndex}`;
      const toLabel = toSubaccountIndex === 0 ? "Cross" : `Isolated #${toSubaccountIndex}`;
      if (!acquireLock()) throw new Error("Transaction already in progress");

      const transferSummary = `$${amountUsdc.toFixed(2)} USDC · ${fromLabel} → ${toLabel}`;
      const toastId = addToast("loading", "Building Transfer", transferSummary);

      try {
        const response = await api.buildTransferCollateral({
          authority: publicKey.toBase58(),
          from_subaccount_index: fromSubaccountIndex,
          to_subaccount_index: toSubaccountIndex,
          amount_usdc: amountUsdc,
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Transfer Confirmed", detail: transferSummary, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Transfer Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Transfer Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const closeAllPositions = useCallback(
    async (positions: Array<{ symbol: string; side: string; size_lots: number; margin_mode: string; subaccount_index: number }>): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      if (!acquireLock()) throw new Error("Transaction already in progress");

      const toastId = addToast("loading", "Building Close All", `${positions.length} position${positions.length !== 1 ? "s" : ""}`);

      try {
        const response = await api.buildCloseAllPositions({
          authority: publicKey.toBase58(),
          positions,
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Close All Confirmed", detail: `${positions.length} position${positions.length !== 1 ? "s" : ""} closed`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Close All Expired", detail: "Transaction status unknown — check explorer and verify positions before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Close All Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const submitMultiLimitOrders = useCallback(
    async (
      symbol: string,
      bids: Array<{ price: number; size_lots: number }>,
      asks: Array<{ price: number; size_lots: number }>,
      onStatus?: (status: TxStatus) => void,
    ): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      if (!acquireLock()) throw new Error("Transaction already in progress");

      const total = bids.length + asks.length;
      const bidRange = bids.length > 0 ? `${bids.length} bid${bids.length !== 1 ? "s" : ""}` : "";
      const askRange = asks.length > 0 ? `${asks.length} ask${asks.length !== 1 ? "s" : ""}` : "";
      const detail = [bidRange, askRange].filter(Boolean).join(" + ") + ` on ${symbol}`;
      const toastId = addToast("loading", `Building ${total} Orders`, detail);

      try {
        const response = await api.buildMultiLimitOrders({
          authority: publicKey.toBase58(),
          symbol,
          bids,
          asks,
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => {
            onStatus?.(status);
            updateToast(toastId, { title: STATUS_LABELS[status] });
          }
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: `${total} Orders Confirmed`, detail, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Multi-Order Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Multi-Order Failed", detail: decodeOrderError(e?.message ?? "") });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  const cancelStopLoss = useCallback(
    async (symbol: string, leg: "tp" | "sl", subaccountIndex?: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");

      if (!acquireLock()) throw new Error("Transaction already in progress");

      const isTP = leg === "tp";
      const label = isTP ? "Take Profit" : "Stop Loss";
      const direction = isTP ? "greater_than" : "less_than";
      const toastId = addToast("loading", `Cancelling ${label}`, `${symbol}-PERP`);

      try {
        const response = await api.buildCancelStopLoss({
          authority: publicKey.toBase58(),
          symbol,
          direction,
          ...(subaccountIndex !== undefined && { subaccount_index: subaccountIndex }),
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          const riskDetail = isTP
            ? "Position now has no profit target"
            : "Position now unprotected on downside";
          updateToast(toastId, { type: "success", title: `${label} Cancelled`, detail: `${symbol}-PERP · ${riskDetail}`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: `Cancel ${label} Expired`, detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: `Cancel ${label} Failed`, detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  // ── Flight builder-code ops (same sign/notify flow as every trade) ──
  const registerBuilder = useCallback(
    async (feeBps: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");
      if (!acquireLock()) throw new Error("Transaction already in progress");
      const toastId = addToast("loading", "Building Builder Registration", `${feeBps} bps`);
      try {
        const response = await api.buildRegisterFlightBuilder(publicKey.toBase58(), feeBps);
        const instructions = deserializeInstructions(response.instructions);
        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );
        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Builder Registered", detail: `Fee ${feeBps} bps · routed orders now earn fees`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Registration Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Registration Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, addToast, updateToast, acquireLock, releaseLock]
  );

  const updateBuilderFee = useCallback(
    async (feeBps: number): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");
      if (!acquireLock()) throw new Error("Transaction already in progress");
      const toastId = addToast("loading", "Building Fee Update", `${feeBps} bps`);
      try {
        const response = await api.buildUpdateFlightFee(publicKey.toBase58(), feeBps);
        const instructions = deserializeInstructions(response.instructions);
        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );
        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: "Builder Fee Updated", detail: `Now ${feeBps} bps`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: "Fee Update Expired", detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: "Fee Update Failed", detail: e?.message });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, addToast, updateToast, acquireLock, releaseLock]
  );

  // Set / replace SL and/or TP triggers on an ALREADY-OPEN position (the same
  // position-conditional-order mechanism entry-time TP/SL uses).
  const setPositionSlTp = useCallback(
    async (params: {
      symbol: string;
      side: "long" | "short";
      stopLossPrice?: number;
      takeProfitPrice?: number;
      subaccountIndex?: number;
    }): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");
      if (!acquireLock()) throw new Error("Transaction already in progress");

      const hasSl = params.stopLossPrice != null;
      const hasTp = params.takeProfitPrice != null;
      const which = hasSl && hasTp ? "SL/TP" : hasSl ? "Stop Loss" : "Take Profit";
      const toastId = addToast("loading", `Setting ${which}`, `${params.symbol}-PERP`);

      try {
        const response = await api.buildSetPositionSlTp({
          authority: publicKey.toBase58(),
          symbol: params.symbol,
          side: params.side,
          ...(hasSl && { stop_loss_price: params.stopLossPrice }),
          ...(hasTp && { take_profit_price: params.takeProfitPrice }),
          ...(params.subaccountIndex !== undefined && { subaccount_index: params.subaccountIndex }),
        });
        const instructions = deserializeInstructions(response.instructions);

        const result = await buildAndSignTransaction(
          instructions, publicKey, sendTransaction, connection,
          (status) => updateToast(toastId, { title: STATUS_LABELS[status] })
        );

        if (result.confirmed) {
          updateToast(toastId, { type: "success", title: `${which} Set`, detail: `${params.symbol}-PERP`, txid: result.txid });
        } else {
          updateToast(toastId, { type: "error", title: `Set ${which} Expired`, detail: "Transaction status unknown — check the explorer before retrying.", txid: result.txid });
        }

        await refreshTraderData();
        return result;
      } catch (e: any) {
        updateToast(toastId, { type: "error", title: `Set ${which} Failed`, detail: decodeOrderError(String(e?.message ?? e)) });
        throw e;
      } finally {
        releaseLock();
      }
    },
    [publicKey, sendTransaction, connection, refreshTraderData, addToast, updateToast, acquireLock, releaseLock]
  );

  return { submitOrder, submitIsolatedOrder, cancelOrders, deposit, withdraw, transferCollateral, closeAllPositions, submitMultiLimitOrders, cancelStopLoss, setPositionSlTp, registerBuilder, updateBuilderFee, isPending, connected: !!publicKey };
}
