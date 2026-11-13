import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { connection, fail, ok, readJson } from "@/lib/server";

// Devnet only: hands out free test USDC so anyone can sponsor a demo battle.
const AMOUNT = 100;
const lastDrip = new Map<string, number>();

export async function POST(req: Request) {
  const secret = process.env.FAUCET_SECRET_KEY;
  const mintAddr = process.env.NEXT_PUBLIC_PRIZE_MINT;
  if (process.env.NEXT_PUBLIC_OWN_FAUCET !== "1") return fail("Get devnet USDC at faucet.circle.com.", 503);
  if (!secret || !mintAddr) return fail("The test-USDC faucet isn't set up on this server.", 503);
  if (!(process.env.NEXT_PUBLIC_RPC_URL ?? "devnet").includes("devnet")) return fail("Faucet is devnet only.", 403);

  const body = await readJson<{ wallet?: string }>(req);
  let owner: PublicKey;
  try {
    owner = new PublicKey(body?.wallet ?? "");
  } catch {
    return fail("Connect a wallet first.");
  }
  const key = owner.toBase58();
  if (Date.now() - (lastDrip.get(key) ?? 0) < 60_000) return fail("One drip per minute. Try again shortly.", 429);

  const authority = Keypair.fromSecretKey(bs58.decode(secret));
  const mint = new PublicKey(mintAddr);
  const decimals = Number(process.env.NEXT_PUBLIC_PRIZE_DECIMALS || 6);
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const conn = connection();
  try {
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, mint),
      createMintToCheckedInstruction(mint, ata, authority.publicKey, BigInt(AMOUNT) * 10n ** BigInt(decimals), decimals),
    );
    const sig = await conn.sendTransaction(tx, [authority]);
    await conn.confirmTransaction(sig, "confirmed");
    lastDrip.set(key, Date.now());
    return ok({ amount: AMOUNT, signature: sig });
  } catch (e) {
    return fail(`Faucet transaction failed: ${e instanceof Error ? e.message : e}`, 502);
  }
}
