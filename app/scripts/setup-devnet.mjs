// Creates a free "test USDC" mint on Solana devnet that the GeeClass faucet can hand out.
// Usage: npm run setup:devnet   (prints the env lines to paste into .env.local)
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";

const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");
const authority = process.env.FAUCET_SECRET_KEY
  ? Keypair.fromSecretKey(bs58.decode(process.env.FAUCET_SECRET_KEY))
  : Keypair.generate();

console.log("Faucet authority:", authority.publicKey.toBase58());
let bal = await conn.getBalance(authority.publicKey);
if (bal < 0.05 * LAMPORTS_PER_SOL) {
  try {
    const sig = await conn.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    bal = await conn.getBalance(authority.publicKey);
  } catch {
    console.log(`\nAirdrop was rate-limited. Send some devnet SOL to ${authority.publicKey.toBase58()}`);
    console.log("using https://faucet.solana.com, then run this again with:");
    console.log(`FAUCET_SECRET_KEY=${bs58.encode(authority.secretKey)} npm run setup:devnet\n`);
    process.exit(1);
  }
}
console.log("Authority balance:", bal / LAMPORTS_PER_SOL, "SOL");

const mint = await createMint(conn, authority, authority.publicKey, null, 6);
console.log("\nAdd these to app/.env.local:\n");
console.log(`NEXT_PUBLIC_PRIZE_MINT=${mint.toBase58()}`);
console.log("NEXT_PUBLIC_PRIZE_DECIMALS=6");
console.log("NEXT_PUBLIC_PRIZE_SYMBOL=USDC");
console.log(`FAUCET_SECRET_KEY=${bs58.encode(authority.secretKey)}`);
