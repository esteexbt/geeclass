"use client";
import type { Connection, TransactionInstruction } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

/** Sends instructions with the connected wallet and waits for confirmation. */
export async function sendIxs(connection: Connection, wallet: WalletContextState, ixs: TransactionInstruction[]) {
  if (!wallet.publicKey) throw new Error("Connect a wallet first.");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
  const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
  return signature;
}

/** Turns wallet and program errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request/i.test(msg)) return "You cancelled in your wallet.";
  if (/insufficient lamports|Attempt to debit an account but found no record/i.test(msg))
    return "Your wallet needs a little devnet SOL for fees. Get some free on the Faucet page.";
  if (/insufficient funds/i.test(msg)) return "Not enough test USDC in your wallet. Grab some on the Faucet page.";
  const custom = msg.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const code = parseInt(custom[1], 16) - 6000;
    const known: Record<number, string> = {
      6006: "Joining has closed for this battle.",
      6007: "This battle is full.",
      6008: "The host and sponsor can't play in their own battle. Join from another wallet.",
      6012: "The payout window has closed. The sponsor can now cancel for a refund.",
    };
    if (known[code]) return known[code];
  }
  if (/already in use/i.test(msg)) return "You've already joined this battle.";
  return msg.length > 180 ? msg.slice(0, 180) + "…" : msg;
}
