import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { computeBudgetIxs, getPriorityFeeMicroLamports, writableAccounts } from "./priorityFee";

interface SerializedInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export function deserializeInstructions(
  serialized: SerializedInstruction[]
): TransactionInstruction[] {
  if (!Array.isArray(serialized) || serialized.length === 0) {
    throw new Error("Backend returned no instructions");
  }
  return serialized.map((ix, i) => {
    if (!ix.programId || !ix.accounts || !ix.data) {
      throw new Error(`Instruction ${i} missing required fields`);
    }
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map((a) => ({
        pubkey: new PublicKey(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
      data: Buffer.from(ix.data, "base64"),
    });
  });
}

export type TxStatus = "simulating" | "signing" | "submitting";

export interface TxResult {
  txid: string;
  confirmed: boolean;
}

async function getBlockhash(connection: Connection): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  try {
    return await connection.getLatestBlockhash();
  } catch (err: any) {
    if (err?.message?.includes("403")) {
      throw new Error(
        "Solana RPC rate limited (403). Set NEXT_PUBLIC_SOLANA_RPC to a dedicated RPC endpoint (e.g., Helius free tier)."
      );
    }
    throw new Error(`Failed to get recent blockhash: ${err?.message || err}`);
  }
}

const MAX_LIGHTHOUSE_RETRIES = 2;

export async function buildAndSignTransaction(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  sendTransaction: (tx: VersionedTransaction, connection: Connection, opts?: any) => Promise<string>,
  connection: Connection,
  onStatus?: (status: TxStatus) => void
): Promise<TxResult> {
  for (let attempt = 0; attempt <= MAX_LIGHTHOUSE_RETRIES; attempt++) {
    // Simulate with replaceRecentBlockhash so the RPC uses its own latest blockhash.
    onStatus?.("simulating");
    const simMsg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: "11111111111111111111111111111111",
      instructions,
    }).compileToV0Message();
    const simTx = new VersionedTransaction(simMsg);
    const simulation = await connection.simulateTransaction(simTx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (simulation.value.err) {
      const logs = simulation.value.logs?.join("\n") || "No logs";
      throw new Error(
        `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}\n${logs}`
      );
    }

    // Reuse the simulation's CU consumption to size an explicit compute-unit
    // limit, and attach a dynamic priority fee — improves landing during
    // congestion without overpaying. Wallets that broadcast the signed tx as-is
    // honor these; Phantom won't double-add a fee when one is already present.
    const microLamports = await getPriorityFeeMicroLamports(connection, writableAccounts(instructions));
    const budget = computeBudgetIxs(simulation.value.unitsConsumed, microLamports);

    // Fresh blockhash right before signing to maximize validity window.
    const { blockhash, lastValidBlockHeight } = await getBlockhash(connection);
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [...budget, ...instructions],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);

    // Sign + send atomically via wallet adapter's sendTransaction.
    // This uses Phantom's signAndSendTransaction internally, minimizing the gap
    // between signing (when Lighthouse snapshots state) and on-chain inclusion.
    onStatus?.("signing");
    const txid = await sendTransaction(transaction, connection, {
      skipPreflight: true,
      maxRetries: 5,
    });

    onStatus?.("submitting");
    try {
      const confirmation = await connection.confirmTransaction(
        { signature: txid, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      if (confirmation.value.err) {
        const errStr = JSON.stringify(confirmation.value.err);
        // Custom:6001 on-chain after simulation passed = Lighthouse anti-MEV rejection.
        // Retry with fresh blockhash + fresh Lighthouse hashes.
        if ((errStr.includes('"Custom":6001') || errStr.includes("Custom:6001")) && attempt < MAX_LIGHTHOUSE_RETRIES) {
          console.warn(`[solana] On-chain Custom:6001 (likely Lighthouse), retrying (${attempt + 1}/${MAX_LIGHTHOUSE_RETRIES})...`);
          continue;
        }
        throw new Error(`Transaction failed on-chain: ${errStr}`);
      }
      return { txid, confirmed: true };
    } catch (err: any) {
      if (err?.message?.includes("failed on-chain")) {
        throw err;
      }
      // confirmTransaction timed out — blockhash expired or RPC dropped the socket.
      // The TX may have landed. Poll once to check before returning unknown status.
      console.warn("[solana] confirmTransaction timed out for", txid, "— polling getTransaction");
      try {
        const txInfo = await connection.getTransaction(txid, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (txInfo && !txInfo.meta?.err) {
          console.info("[solana] getTransaction confirmed:", txid);
          return { txid, confirmed: true };
        }
      } catch {
        // getTransaction itself failed — fall through to unknown
      }
      return { txid, confirmed: false };
    }
  }

  throw new Error("Transaction failed after retries — exchange state kept changing during signing. Please try again.");
}
