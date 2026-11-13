import { Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { getStore } from "./store";
import type { BattleDoc } from "./game";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const connection = () => new Connection(RPC_URL, "confirmed");
export const skipChain = () => process.env.SKIP_CHAIN_VERIFY === "1";

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function loadBattle(code: string) {
  return getStore().getBattle(code.toUpperCase());
}

export async function isHost(doc: BattleDoc, hostKey: unknown) {
  return typeof hostKey === "string" && (await sha256Hex(hostKey)) === doc.hostKeyHash;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
